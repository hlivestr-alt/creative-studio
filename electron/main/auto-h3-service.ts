import { createHash, randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { advanceAutoCursor, autoRetryMs, isTransientTransport, safeOutputComponent, shuffled, type AutoH3Config, type AutoH3Job, type AutoH3Session, type AutoH3Snapshot } from '../../src/domain/auto-h3';
import { getProduct, products } from '../../src/domain/data';
import { buildH3ReferenceSlotMappings, h3ContentTypeOptions, h3WorkflowSettingsFromBrief } from '../../src/domain/h3';
import { buildH3GenerationBrief } from '../../src/domain/h3-generation-brief';
import { planCreativeGenome } from '../../src/domain/creative-diversity';
import { validateH3WorkflowSettings } from '../../src/domain/minimax-h3-workflow';
import type { AppSettings, ComputeJobState, RemoteH3GenerationRequest } from '../../src/domain/types';
import type { HistoryDatabase } from './database';
import type { ComputeService } from './compute-service';
import { findComfyVideoOutputs } from './compute-provider';
import { AmbiguousSubmissionError } from './auto-h3-transport';

const seed = () => randomInt(0, 4_294_967_296);
const now = () => new Date().toISOString();
const terminal = (state: ComputeJobState) => ['completed', 'failed', 'error'].includes(state.status);

/** Main-process scheduler: renderer lifetime never owns a generation. */
export class AutoH3Service {
  private sessions = new Map<string, AutoH3Session>();
  private jobs = new Map<string, AutoH3Job>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private generating = false;
  private downloading = false;
  private activeDownload: { id: string; controller: AbortController } | null = null;
  private starting = false;
  private archiving = new Map<string, Promise<void>>();
  private disposed = false;

  constructor(private db: HistoryDatabase, private compute: ComputeService, private settings: () => AppSettings) {
    for (const session of db.listAutoSessions()) {
      if (session.status !== 'STOPPED') session.status = 'INTERRUPTED';
      this.sessions.set(session.sessionId, session);
      db.saveAuto(session);
    }
    for (const job of db.listAutoJobs()) {
      if (job.state?.status === 'completed' && job.downloadStatus === 'WAITING_RENDER') job.downloadStatus = 'PENDING_DOWNLOAD';
      this.jobs.set(job.autoJobId, job);
      this.save(this.requireSession(job.sessionId), job);
    }
    compute.autoArchive = (request, state) => this.archiveBeforeRelease(request, state);
  }

  activate(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); void this.downloadTick(); }, autoRetryMs);
    void this.downloadTick(); // Downloads recover without resuming GPU work.
  }

  snapshot(): AutoH3Snapshot {
    return structuredClone({
      sessions: [...this.sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      jobs: [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    });
  }

  private save(session: AutoH3Session, job?: AutoH3Job): void {
    if (this.disposed) return;
    if (job) this.jobs.set(job.autoJobId, job);
    session.pendingLaptopDownloads = [...this.jobs.values()].filter(j => j.sessionId === session.sessionId && j.downloadStatus === 'PENDING_DOWNLOAD').length;
    this.sessions.set(session.sessionId, session);
    this.db.saveAuto(session, job);
    if (job?.request.promptRecordId && !job.state && job.status === 'FAILED') this.db.updateH3(job.request.promptRecordId, { generationStatus: 'failed' });
    if (job?.request.promptRecordId && job.state) this.db.updateH3(job.request.promptRecordId, {
      generationStatus: job.state.status === 'completed' ? 'completed' : job.status === 'FAILED' ? 'failed' : 'queued',
      remotePromptId: job.state.remotePromptId, pipelineStage: job.state.pipelineStage,
      prompt: job.state.finalEnhancedPrompt ?? '', finalEnhancedPrompt: job.state.finalEnhancedPrompt,
      validationReport: job.state.validationReport, enhancementManifest: job.state.enhancementManifest,
      rewriteDiagnostics: job.state.rewriteDiagnostics, timings: job.state.stageTimings,
      outputPath: job.laptopOutputPath ?? job.chinaArchivePath,
      llmInstanceId: job.state.llmInstanceId, llmModelId: job.state.llmModelId,
      llmUnloadSucceeded: job.state.llmUnloadSucceeded, llmUnloadDurationMs: job.state.llmUnloadDurationMs
    });
  }

  async start(config: AutoH3Config): Promise<AutoH3Snapshot> {
    if (this.starting || [...this.sessions.values()].some(s => s.status !== 'STOPPED')) throw new Error('Resume or stop the existing Auto Session first.');
    this.starting = true;
    try {
      if (!config.selectedProducts.length || !config.selectedContentTypes.length) throw new Error('Select at least one product and one content type.');
      if (new Set(config.selectedProducts).size !== config.selectedProducts.length || config.selectedProducts.some(id => !products.some(p => p.id === id))) throw new Error('Invalid product selection.');
      if (new Set(config.selectedContentTypes).size !== config.selectedContentTypes.length || config.selectedContentTypes.some(type => !h3ContentTypeOptions.includes(type))) throw new Error('Invalid content type selection.');
      if (!config.chinaRoot.trim() || !isAbsolute(config.laptopRoot)) throw new Error('Configure an absolute China archive root and Laptop Output Root.');
      validateH3WorkflowSettings(h3WorkflowSettingsFromBrief(config.brief));
      // Product reference is always rebound to each verified master; shared local product images are unsafe across products.
      if (Object.values(config.brief.references).some(ref => ref.source === 'local-file')) throw new Error('Auto Run uses verified product masters. Remove local-file references before starting Auto Run.');
      mkdirSync(config.laptopRoot, { recursive: true });
      const probe = join(config.laptopRoot, `.proya-write-${randomUUID()}`);
      writeFileSync(probe, 'ok'); unlinkSync(probe);
      await this.compute.autoProvider().testAutoArchive(config.chinaRoot);
      const session: AutoH3Session = {
        ...structuredClone(config), sessionId: randomUUID(), status: 'RUNNING', startedAt: now(), stoppedAt: null,
        productOrder: config.shuffleProducts ? shuffled(config.selectedProducts, Math.random) : [...config.selectedProducts],
        contentTypeOrder: config.shuffleContentTypes ? shuffled(config.selectedContentTypes, Math.random) : [...config.selectedContentTypes],
        cycleNumber: 1, cycleSeed: seed(), productIndex: 0, contentTypeIndex: 0,
        generatedCount: 0, completedCount: 0, failedCount: 0, pendingLaptopDownloads: 0,
        stopRequested: false, currentJobId: null, lastSuccessfulJobId: null, lastError: null
      };
      this.save(session);
      void this.tick();
      return this.snapshot();
    } finally { this.starting = false; }
  }

  resume(id: string): AutoH3Snapshot {
    const session = this.requireSession(id);
    if (session.status !== 'INTERRUPTED') throw new Error('Only interrupted sessions can resume.');
    session.status = session.stopRequested ? 'STOPPING' : 'RUNNING';
    this.save(session);
    void this.tick();
    return this.snapshot();
  }

  async stop(id: string, immediately = false): Promise<AutoH3Snapshot> {
    const session = this.requireSession(id);
    session.stopRequested = true;
    session.stopNowRequested ||= immediately;
    session.status = 'STOPPING';
    this.save(session);
    if (immediately && session.currentJobId) {
      const job = this.jobs.get(session.currentJobId);
      const state = job ? await this.compute.recoverAutoJob(job.autoJobId) : null;
      if (state?.remotePromptId && !terminal(state)) await this.compute.autoProvider().interruptAutoJob(state.remotePromptId);
    }
    void this.tick();
    return this.snapshot();
  }

  cancelDownload(id: string): AutoH3Snapshot {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown download.');
    job.downloadStatus = 'CANCELLED';
    if (this.activeDownload?.id === id) this.activeDownload.controller.abort();
    this.save(this.requireSession(job.sessionId), job);
    return this.snapshot();
  }

  private requireSession(id: string): AutoH3Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Unknown Auto Session.');
    return session;
  }

  private prepare(session: AutoH3Session, attempt = 0): AutoH3Job {
    const product = getProduct(session.productOrder[session.productIndex])!;
    const contentType = session.contentTypeOrder[session.contentTypeIndex];
    const autoJobId = `h3-auto-${session.sessionId}-${session.cycleNumber}-${product.id}-${safeOutputComponent(contentType)}-${randomUUID()}`;
    const creativeSeed = (seed() ^ session.cycleSeed) >>> 0;
    const brief = structuredClone(session.brief);
    brief.product = product.id; brief.contentType = contentType; brief.creativeSeed = creativeSeed;
    brief.creativeVariety ??= 'Balanced';
    for (const ref of Object.values(brief.references)) if (ref.source === 'selected-product') {
      ref.path = product.imagePath; ref.description = `${product.officialName} packaging reference`;
    }
    brief.references.productReference = { source: 'selected-product', path: product.imagePath, description: `${product.officialName} packaging reference` };
    const history = this.db.listH3(2000);
    // Include a per-combination window even after large product cycles.
    const recent = history.filter(h => h.product === product.id && h.contentType === contentType).slice(0, 100);
    let selected: ReturnType<typeof planCreativeGenome>;
    try { selected = planCreativeGenome({ product, contentFamily: contentType, userIdea: brief.videoIdea, specialInstructions: brief.specialInstructions, recentHistory: [...recent, ...history.filter(h => !recent.includes(h)).slice(0, 200)], variety: brief.creativeVariety, options: { sameProductFamilyWindow: 100, maxRerolls: 1000 }, seed: creativeSeed, generationJobId: autoJobId }); } catch (error) { return this.failedPlan(session, autoJobId, attempt, String(error)); }
    brief.creativeGenome = selected.genome;
    if (brief.seedMode === 'random') brief.seed = seed();
    const workflow = validateH3WorkflowSettings(h3WorkflowSettingsFromBrief(brief));
    const generationBrief = buildH3GenerationBrief({ product, brief, genome: selected.genome, references: brief.references });
    const record = this.db.createH3({ product: product.id, contentType, brief, concept: null, resolvedMode: 'REF2VA', referencePlan: brief.references, timeline: [], prompt: '', generationJobId: autoJobId, generationStatus: 'prepared', creativeSeed, creativeGenome: selected.genome, creativeFingerprint: selected.fingerprint, conceptSummary: selected.conceptSummary, noveltyScore: selected.noveltyScore, repetitionPenaltySources: selected.repetitionPenaltySources, diversityFallbackUsed: selected.diversityFallbackUsed, diversityFallbackReason: selected.diversityFallbackReason, rerollsUsed: selected.rerollsUsed, noveltyThresholdMissed: selected.noveltyThresholdMissed, creativeDiversityDiagnostics: selected.diversityDiagnostics, generationBrief });
    const referenceImages = buildH3ReferenceSlotMappings(brief.references).map(mapping => ({ localPath: join(this.settings().productAssetsDirectory, basename(mapping.asset.path!.replaceAll('\\', '/'))) }));
    const request: RemoteH3GenerationRequest = { autoJobId, autoSessionId: session.sessionId, autoCycleNumber: session.cycleNumber, localJobId: autoJobId, promptRecordId: record.id, product: product.id, generationBrief, promptEngine: this.settings().h3PromptEngine, mode: 'REF2VA', duration: workflow.durationSeconds, aspectRatio: workflow.aspectRatio, fps: workflow.fps, frames: workflow.frameLength, megapixels: workflow.megapixels, multiple: workflow.multiple, steps: workflow.steps, seed: workflow.seed, workflowSettings: workflow, firstFrame: null, lastFrame: null, productReference: null, referenceImages, productReferencePath: join(this.settings().productAssetsDirectory, basename(product.imagePath.replaceAll('\\', '/'))), scheduler: workflow.scheduler, refImageSize: workflow.refImageSize };
    const createdAt = now();
    const filename = `${createdAt.replace(/[^0-9]/g, '').slice(0, 14)}__${product.id}__${safeOutputComponent(contentType)}__${createHash('sha256').update(selected.fingerprint.signature).digest('hex').slice(0, 12)}__${workflow.seed}__${autoJobId}.mp4`;
    // Full identity in metadata and SaveVideo prefix; short suffix keeps Windows paths usable.
    const shortFilename = filename.replace(autoJobId, autoJobId.slice(-12));
    return { autoJobId, sessionId: session.sessionId, cycleNumber: session.cycleNumber, cycleSeed: session.cycleSeed, product: product.id, contentType, createdAt, finishedAt: null, status: 'PREPARED', request, state: null, attempt, diagnostics: [], creativeGenome: selected.genome, creativeFingerprint: selected.fingerprint.signature, relativePath: `${createdAt.slice(0, 10)}/${safeOutputComponent(product.shortName)}/${safeOutputComponent(contentType)}/${shortFilename}`, chinaArchivePath: null, chinaArchiveSucceeded: false, chinaArchiveError: null, archiveSize: null, laptopOutputPath: null, laptopDownloadSucceeded: false, laptopDownloadError: null, downloadStatus: 'WAITING_RENDER' };
  }

  private failedPlan(session: AutoH3Session, autoJobId: string, attempt: number, error: string): AutoH3Job {
    const product = session.productOrder[session.productIndex];
    const contentType = session.contentTypeOrder[session.contentTypeIndex];
    const brief = { ...session.brief, product, contentType };
    const record = this.db.createH3({ product, contentType, brief, concept: null, resolvedMode: 'REF2VA', referencePlan: brief.references, timeline: [], prompt: '', generationJobId: autoJobId, generationStatus: 'failed' });
    const workflow = validateH3WorkflowSettings(h3WorkflowSettingsFromBrief(brief));
    return { autoJobId, sessionId: session.sessionId, cycleNumber: session.cycleNumber, cycleSeed: session.cycleSeed, product, contentType, createdAt: now(), finishedAt: null, status: 'PREPARED', attempt, diagnostics: [error], request: { autoJobId, localJobId: autoJobId, promptRecordId: record.id, mode: 'REF2VA', duration: workflow.durationSeconds, aspectRatio: workflow.aspectRatio, fps: workflow.fps, frames: workflow.frameLength, megapixels: workflow.megapixels, multiple: workflow.multiple, firstFrame: null, lastFrame: null, productReference: null }, state: null, relativePath: '', chinaArchivePath: null, chinaArchiveSucceeded: false, chinaArchiveError: null, archiveSize: null, laptopOutputPath: null, laptopDownloadSucceeded: false, laptopDownloadError: null, downloadStatus: 'WAITING_RENDER' };
  }

  async tick(): Promise<void> {
    if (this.generating || this.disposed) return;
    const session = [...this.sessions.values()].find(s => s.status === 'RUNNING' || s.status === 'STOPPING');
    if (!session) return;
    this.generating = true;
    try {
      let job = session.currentJobId ? this.jobs.get(session.currentJobId) : undefined;
      if (!job) {
        if (session.stopRequested) { session.status = 'STOPPED'; session.stoppedAt = now(); this.save(session); return; }
        job = this.prepare(session);
        session.currentJobId = job.autoJobId; session.generatedCount++;
        this.save(session, job);
      }
      if (job.finishedAt) { this.recoverFinished(session, job); return; }
      if (!job.request.generationBrief && job.diagnostics.length) { this.finish(session, job, false, job.diagnostics[0]); return; }
      let state = await this.compute.recoverAutoJob(job.autoJobId);
      if (!state) {
        if (session.stopRequested) { this.finish(session, job, false, 'Stopped before remote submission.'); return; }
        job.status = 'SUBMITTING'; this.save(session, job);
        state = await this.compute.submitH3(job.request);
      }
      job.state = state;
      if (session.stopNowRequested && state.remotePromptId && !terminal(state)) await this.compute.autoProvider().interruptAutoJob(state.remotePromptId);
      session.lastError = state.connectionError;
      if (state.connectionError) { this.save(session, job); return; }
      if (terminal(state)) {
        // A release failure never permits the next Qwen, even on deterministic failure.
        if (state.remotePromptId && (state.h3VramReleaseSucceeded !== true || state.h3VramReleaseDurationMs == null)) {
          session.lastError = state.h3VramReleaseError ?? 'Waiting for H3 VRAM release'; this.save(session, job); return;
        }
        this.finish(session, job, state.status === 'completed', state.error ?? undefined);
      } else { job.status = 'RENDERING'; this.save(session, job); }
    } catch (error) {
      session.lastError = String(error);
      const job = session.currentJobId ? this.jobs.get(session.currentJobId) : undefined;
      if (error instanceof AmbiguousSubmissionError || isTransientTransport(error) || /previous H3|queue|VRAM|submission is in progress/i.test(String(error))) {
        this.save(session, job);
      } else if (job) this.finish(session, job, false, String(error));
      else {
        // Planning errors are bounded too: record the combination and advance.
        session.failedCount++;
        Object.assign(session, advanceAutoCursor(session, seed()));
        this.save(session);
      }
    } finally { this.generating = false; }
  }

  private finish(session: AutoH3Session, job: AutoH3Job, success: boolean, error?: string): void {
    if (job.finishedAt) { this.recoverFinished(session, job); return; }
    job.status = success ? 'COMPLETED' : 'FAILED'; job.finishedAt = now();
    if (error) job.diagnostics.push(error);
    if (success) { session.completedCount++; session.lastSuccessfulJobId = job.autoJobId; job.downloadStatus = 'PENDING_DOWNLOAD'; }
    else session.failedCount++;
    const promptFailure = /PROMPT|LLM|WRITING/.test(job.state?.failureStage ?? job.state?.pipelineStage ?? (job.state ? '' : 'PROMPT'));
    const retry = !success && !session.stopRequested && job.attempt < (promptFailure ? 2 : 1);
    if (retry) {
      this.save(session, job);
      const replacement = this.prepare(session, job.attempt + 1);
      session.currentJobId = replacement.autoJobId; session.generatedCount++;
      this.save(session, replacement);
    } else {
      Object.assign(session, advanceAutoCursor(session, seed()));
      if (session.stopRequested) { session.status = 'STOPPED'; session.stoppedAt = now(); }
      this.save(session, job); // Cursor and terminal job commit atomically.
    }
  }

  private recoverFinished(session: AutoH3Session, job: AutoH3Job): void {
    // A crash between recording an exhausted attempt and creating its retry must not recount it.
    const retry = job.status === 'FAILED' && !session.stopRequested && job.attempt < (/PROMPT|LLM|WRITING/.test(job.state?.failureStage ?? job.state?.pipelineStage ?? (job.state ? '' : 'PROMPT')) ? 2 : 1);
    if (retry) {
      const replacement = this.prepare(session, job.attempt + 1);
      session.currentJobId = replacement.autoJobId; session.generatedCount++;
      this.save(session, replacement);
    } else {
      Object.assign(session, advanceAutoCursor(session, seed()));
      if (session.stopRequested) { session.status = 'STOPPED'; session.stoppedAt = now(); }
      this.save(session);
    }
  }

  private async archiveBeforeRelease(request: RemoteH3GenerationRequest, state: ComputeJobState): Promise<void> {
    const job = this.jobs.get(request.autoJobId!);
    if (!job) throw new Error('Auto job is missing; output cannot be archived safely.');
    job.state = state;
    this.save(this.requireSession(job.sessionId), job); // Durable descriptor before remote /free.
    await this.archive(job);
  }

  private async archive(job: AutoH3Job): Promise<void> {
    const pending = this.archiving.get(job.autoJobId);
    if (pending) return pending;
    const operation = this.copyArchive(job);
    this.archiving.set(job.autoJobId, operation);
    try { await operation; } finally { this.archiving.delete(job.autoJobId); }
  }

  private async copyArchive(job: AutoH3Job): Promise<void> {
    if (job.chinaArchiveSucceeded) return;
    const session = this.requireSession(job.sessionId);
    try {
      const output = findComfyVideoOutputs(job.state?.outputs ?? [])[0];
      if (!output) throw new Error('SaveVideo returned no MP4 descriptor.');
      const result = await this.compute.autoProvider().archiveAutoOutput(output, session.chinaRoot, job.relativePath);
      if (!Number.isSafeInteger(result.size) || result.size <= 0 || typeof result.path !== 'string' || !result.path) throw new Error('Invalid archive verification response.');
      job.chinaArchivePath = result.path; job.archiveSize = result.size; job.chinaArchiveSucceeded = true; job.chinaArchiveError = null;
    } catch (error) { job.chinaArchiveError = String(error); }
    this.save(session, job); // Copy failure is retried separately and never rerenders.
  }

  async downloadTick(): Promise<void> {
    if (this.downloading || this.disposed) return;
    this.downloading = true;
    try {
      // One download attempt per pending item per tick; a broken old output cannot starve newer ones.
      for (const job of this.jobs.values()) {
        if (this.disposed) break;
        if (job.state?.status === 'completed' && !job.chinaArchiveSucceeded) await this.archive(job);
        if (job.downloadStatus !== 'PENDING_DOWNLOAD' || !job.chinaArchiveSucceeded) continue;
        const session = this.requireSession(job.sessionId);
        try {
          const target = resolve(session.laptopRoot, job.relativePath);
          const relativeTarget = relative(resolve(session.laptopRoot), target);
          if (!relativeTarget || relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) throw new Error('Unsafe laptop output path.');
          if (!existsSync(target) || statSync(target).size !== job.archiveSize) {
            const output = findComfyVideoOutputs(job.state?.outputs ?? [])[0];
            if (!output) throw new Error('Missing saved output descriptor.');
            const controller = new AbortController();
            this.activeDownload = { id: job.autoJobId, controller };
            const result = await this.compute.autoProvider().downloadAutoArchive(output, session.chinaRoot, job.relativePath, join(dirname(target), '.proya-downloads'), controller.signal);
            if (statSync(result.localPath).size !== job.archiveSize) { unlinkSync(result.localPath); throw new Error('Source/destination size mismatch.'); }
            mkdirSync(dirname(target), { recursive: true }); renameSync(result.localPath, target);
          }
          job.laptopOutputPath = target; job.laptopDownloadSucceeded = true; job.laptopDownloadError = null;
          if (job.downloadStatus === 'PENDING_DOWNLOAD') job.downloadStatus = 'COMPLETE';
        } catch (error) { job.laptopDownloadError = String(error); }
        this.activeDownload = null;
        this.save(session, job);
      }
    } finally { this.activeDownload = null; this.downloading = false; }
  }

  dispose(): void { this.disposed = true; this.activeDownload?.controller.abort(); if (this.timer) clearInterval(this.timer); }
}
