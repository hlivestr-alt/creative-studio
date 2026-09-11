import { randomInt, randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { advanceAutoCursor, safeOutputComponent } from '../domain/auto-h3';
import { buildH3GenerationBrief } from '../domain/h3-generation-brief';
import { createH3ReferencePlan } from '../domain/h3';
import { planCreativeGenome, type CreativeHistoryEntry } from '../domain/creative-diversity';
import type { H3VideoBrief } from '../domain/types';
import { LocalComfyClient, LocalLmStudioClient } from './localhost-comfy';
import { ChinaRunnerStore } from './store';
import { stageSessionBundle } from './staging';
import { LocalCanaryExecutor, type CanaryExecutor } from './canary-executor';
import { CHINA_RUNNER_VERSION, DEFAULT_API_ADDRESS, DEFAULT_API_PORT, DEFAULT_ARCHIVE_ROOT, DEFAULT_STATE_ROOT, LOCAL_COMFY_URL, LOCAL_LM_STUDIO_URL, SESSION_BUNDLE_SCHEMA_VERSION, type CanaryStartResult, type ChinaSessionBundle, type PersistedJob, type PersistedSession, type RunnerCapabilities, type RunnerMode, type SessionSettings, type StageResult } from './types';

const now = () => new Date().toISOString();
const newSeed = () => randomInt(0, 4_294_967_296);
const h3ExecutionStages = new Set([
  'QUEUED_H3',
  'GENERATING_H3',
  'RELEASING_H3_VRAM',
  'DOWNLOADING',
  'COMPLETE',
  'H3_GENERATION_FAILED',
  'REMOTE_STATE_LOST',
  'DOWNLOAD_FAILED'
]);

function h3LifecycleStarted(job: PersistedJob): boolean {
  const pipelineStage = job.executionState?.pipelineStage;
  return Boolean(job.archivePath || job.vramAudit || pipelineStage && h3ExecutionStages.has(pipelineStage));
}

export interface ChinaRunnerOptions {
  stateRoot?: string;
  archiveRoot?: string;
  address?: string;
  port?: number;
  store?: ChinaRunnerStore;
  comfy?: LocalComfyClient;
  lmStudio?: LocalLmStudioClient;
  mode?: RunnerMode;
  canaryExecutor?: CanaryExecutor;
  schedulerIntervalMs?: number;
}

export class ChinaAutoRunner {
  readonly stateRoot: string;
  readonly archiveRoot: string;
  readonly address: string;
  readonly port: number;
  readonly store: ChinaRunnerStore;
  readonly comfy: LocalComfyClient;
  readonly lmStudio: LocalLmStudioClient;
  readonly mode: RunnerMode;
  private readonly canaryExecutor: CanaryExecutor;
  private readonly canaryTimer: ReturnType<typeof setInterval> | null;
  private driving = new Set<string>();
  private startOperations = new Map<string, Promise<CanaryStartResult>>();
  private closed = false;

  constructor(options: ChinaRunnerOptions = {}) {
    const configuredMode = options.mode ?? (process.env.RUNNER_MODE ?? 'shadow').toLowerCase();
    if (configuredMode !== 'shadow' && configuredMode !== 'canary' && configuredMode !== 'two-job-canary' && configuredMode !== 'production') throw new Error('Runner mode must be shadow, canary, two-job-canary, or production.');
    this.mode = configuredMode;
    this.stateRoot = options.stateRoot ?? process.env.PROYA_AUTO_STATE_ROOT ?? DEFAULT_STATE_ROOT;
    this.archiveRoot = options.archiveRoot ?? process.env.PROYA_H3_ARCHIVE_ROOT ?? DEFAULT_ARCHIVE_ROOT;
    this.address = options.address ?? DEFAULT_API_ADDRESS;
    this.port = options.port ?? DEFAULT_API_PORT;
    this.store = options.store ?? new ChinaRunnerStore(join(this.stateRoot, 'runner.sqlite3'));
    this.comfy = options.comfy ?? new LocalComfyClient(this.mode);
    this.lmStudio = options.lmStudio ?? new LocalLmStudioClient();
    this.canaryExecutor = options.canaryExecutor ?? new LocalCanaryExecutor();
    this.canaryTimer = this.mode !== 'shadow' ? setInterval(() => { void this.resumeCanaries(); }, options.schedulerIntervalMs ?? 5000) : null;
    if (this.mode !== 'shadow') queueMicrotask(() => { void this.resumeCanaries(); });
  }

  capabilities(): RunnerCapabilities {
    return {
      runnerVersion: CHINA_RUNNER_VERSION,
      bundleSchemaVersion: SESSION_BUNDLE_SCHEMA_VERSION,
      mode: this.mode,
      listenAddress: `${this.address}:${this.port}`,
      comfyUrl: LOCAL_COMFY_URL,
      lmStudioUrl: LOCAL_LM_STUDIO_URL,
      archiveRoot: this.archiveRoot,
      generationEnabled: this.mode !== 'shadow',
      promptSubmissionEnabled: this.mode !== 'shadow',
      canaryStartEnabled: this.mode !== 'shadow',
      maxJobsPerSession: this.mode === 'production' ? null : this.mode === 'two-job-canary' ? 2 : 1
    };
  }

  async health(): Promise<Record<string, unknown>> {
    const [comfy, lmStudio] = await Promise.all([this.comfy.readiness(), this.lmStudio.readiness()]);
    const lmDetails = lmStudio.details && typeof lmStudio.details === 'object' ? lmStudio.details as Record<string, unknown> : {};
    return {
      ready: comfy.ready && lmStudio.ready,
      mode: this.mode,
      checkedAt: now(),
      comfy,
      lmStudio,
      lmStudioLocal: lmStudio.ready ? 'ready' : 'not_ready',
      qwenModelAvailable: lmDetails.available === true,
      requiredModel: lmDetails.requiredModel ?? null,
      matchedField: lmDetails.matchedField ?? null,
      matchedValue: lmDetails.matchedValue ?? null,
      stateDatabase: this.store.path,
      archiveRoot: this.archiveRoot
    };
  }

  async stage(bundle: ChinaSessionBundle): Promise<StageResult> {
    const result = await stageSessionBundle(bundle, { store: this.store, stateRoot: this.stateRoot, archiveRoot: this.archiveRoot, comfy: this.comfy, lmStudio: this.lmStudio });
    return { ...result, mode: this.mode };
  }

  currentSession(): PersistedSession | null { return this.store.currentSession(); }
  session(id: string): PersistedSession | null { return this.store.getSession(id); }
  stagingPersistence(id: string): { assetRecordCount: number; settingsVersions: number[] } { return this.store.stagingPersistence(id); }
  jobs(sessionId?: string, afterRevision = 0): PersistedJob[] { return this.store.listJobs(sessionId, afterRevision); }

  startCanary(sessionId: string, bundleHash: string): Promise<CanaryStartResult> {
    const same = this.startOperations.get(sessionId);
    if (same) return same;
    if (this.startOperations.size > 0) return Promise.reject(new Error('Another canary Start transaction is in progress.'));
    const operation = this.commitCanaryStart(sessionId, bundleHash);
    this.startOperations.set(sessionId, operation);
    void operation.then(() => { this.startOperations.delete(sessionId); }, () => { this.startOperations.delete(sessionId); });
    return operation;
  }

  private async commitCanaryStart(sessionId: string, bundleHash: string): Promise<CanaryStartResult> {
    if (this.mode === 'shadow') throw new Error('Canary Start is disabled in shadow mode.');
    const maxJobsPerSession = this.mode === 'production' ? null : this.mode === 'two-job-canary' ? 2 as const : 1 as const;
    const startingStatus: PersistedSession['status'] = this.mode === 'production' ? 'PRODUCTION_STARTING' : this.mode === 'two-job-canary' ? 'TWO_JOB_CANARY_STARTING' : 'CANARY_STARTING';
    const runningStatuses: PersistedSession['status'][] = ['CANARY_STARTING', 'CANARY_RUNNING', 'TWO_JOB_CANARY_STARTING', 'TWO_JOB_CANARY_RUNNING', 'PRODUCTION_STARTING', 'PRODUCTION_RUNNING'];
    const terminalStatuses: PersistedSession['status'][] = ['CANARY_FINISHED', 'TWO_JOB_CANARY_FINISHED'];
    const session = this.requireSession(sessionId);
    if (session.bundleHash !== bundleHash) throw new Error('Start bundle identity does not match the staged session.');
    if ([...runningStatuses, ...terminalStatuses].includes(session.status)) return { started: true, idempotent: true, sessionId, bundleHash, revision: session.revision, status: session.status, maxJobsPerSession };
    if (session.status !== 'STAGED') throw new Error(`Session ${sessionId} is not STAGED / READY.`);
    if (this.mode !== 'production' && this.store.listJobs(sessionId).length > 0) throw new Error('Canary job limit already consumed for this session.');
    const active = this.store.listSessions().find(candidate => candidate.sessionId !== sessionId && runningStatuses.includes(candidate.status));
    if (active) throw new Error(`Another canary session is active: ${active.sessionId}.`);
    const health = await this.health();
    if (health.ready !== true) throw new Error('China Auto Run Start requires current local ComfyUI, Qwen, and archive readiness.');
    const started = this.store.saveSession({ ...session, status: startingStatus, lastError: null }, this.mode === 'production' ? 'PRODUCTION_START_COMMITTED' : 'CANARY_START_COMMITTED');
    queueMicrotask(() => { void this.driveCanary(sessionId); });
    return { started: true, idempotent: false, sessionId, bundleHash, revision: started.revision, status: started.status, maxJobsPerSession };
  }

  updateSettings(sessionId: string, version: number, settings: SessionSettings): PersistedSession {
    return this.store.saveSettings(sessionId, version, settings);
  }

  acknowledgeLaptopSync(jobId: string, path: string): PersistedJob {
    const job = this.store.getJob(jobId);
    if (!job || job.phase !== 'COMPLETED' || !job.archiveSha256) throw new Error('Only a completed authoritative artifact can be marked synced.');
    return this.store.updateJob(jobId, job.phase, { laptopSyncedAt: now(), laptopSyncPath: path });
  }

  requestStopAfterCurrent(sessionId: string): PersistedSession {
    const session = this.requireSession(sessionId);
    return this.store.saveSession({ ...session, stopAfterCurrent: true, status: session.currentJobId ? 'STOPPING' : 'STOPPED' }, 'STOP_AFTER_CURRENT_COMMITTED');
  }

  requestStopNow(sessionId: string): PersistedSession {
    const session = this.requireSession(sessionId);
    return this.store.saveSession({ ...session, stopNow: true, stopAfterCurrent: true, status: 'STOPPED' }, 'STOP_NOW_COMMITTED');
  }

  /** Shadow-only scheduler simulation. It creates plans and durable jobs but never submits. */
  simulateNextJob(sessionId: string): PersistedJob {
    if (this.mode !== 'shadow') throw new Error('Shadow simulation is disabled in autonomous canary modes.');
    return this.planJob(sessionId, 'SHADOW_SIMULATING', 'SHADOW_JOB_SELECTED');
  }

  private planJob(sessionId: string, status: PersistedSession['status'], eventType: string): PersistedJob {
    const session = this.requireSession(sessionId);
    if (session.stopNow || session.stopAfterCurrent && !session.currentJobId) throw new Error('Session stop intent prevents another simulated job.');
    const productId = session.bundle.ordering.productOrder[session.productIndex];
    const contentType = session.bundle.ordering.contentTypeOrder[session.contentTypeIndex];
    const schedulerKey = `${session.cycleNumber}:${session.productIndex}:${session.contentTypeIndex}`;
    const existing = this.store.listJobs(sessionId).find(job => job.schedulerKey === schedulerKey);
    if (existing) {
      if (session.currentJobId !== existing.jobId) this.store.saveSession({ ...session, status, currentJobId: existing.jobId }, `${eventType}_RECOVERED`);
      return existing;
    }
    const product = session.bundle.products.find(item => item.id === productId);
    if (!product) throw new Error(`Staged metadata for ${productId} is missing.`);
    const settings = this.store.getSettings(sessionId, session.settingsVersion);
    const brief = structuredClone(settings.brief) as H3VideoBrief;
    brief.product = product.id;
    brief.contentType = contentType;
    brief.references = createH3ReferencePlan(product);
    const binding = session.bundle.productReferences.find(item => item.productId === product.id);
    if (!binding?.assetIds.length) throw new Error(`Staged reference mapping for ${product.id} is missing.`);
    const primary = session.bundle.assets.find(asset => asset.id === binding.assetIds[0]);
    if (!primary) throw new Error(`Staged master ${binding.assetIds[0]} is missing.`);
    brief.references.productReference = { source: 'selected-product', description: `${product.officialName} packaging reference`, path: join(session.sessionDirectory, 'assets', `${primary.id}__${primary.filename}`) };
    const jobId = `h3-auto-${sessionId}-${session.cycleNumber}-${product.id}-${safeOutputComponent(contentType)}-${randomUUID()}`;
    const creativeSeed = (newSeed() ^ session.cycleSeed) >>> 0;
    const history: CreativeHistoryEntry[] = this.store.listJobs(sessionId).map(job => ({
      id: job.jobId, generationJobId: job.jobId, product: job.product, contentFamily: job.contentType,
      genome: job.creativeGenome, conceptSummary: null, createdAt: job.createdAt, generationStatus: 'planned'
    }));
    const plan = planCreativeGenome({ product, contentFamily: contentType, userIdea: brief.videoIdea, specialInstructions: brief.specialInstructions, recentHistory: history, variety: brief.creativeVariety, seed: creativeSeed, generationJobId: jobId, options: { sameProductFamilyWindow: 100, maxRerolls: 1000 } });
    brief.creativeGenome = plan.genome;
    const generationBrief = buildH3GenerationBrief({ product, brief, genome: plan.genome, references: brief.references });
    const timestamp = now();
    const job = this.store.createJob({
      jobId, sessionId, schedulerKey, phase: 'PREPARING', cycleNumber: session.cycleNumber, productIndex: session.productIndex, contentTypeIndex: session.contentTypeIndex,
      product: product.id, contentType, settingsVersion: session.settingsVersion, settingsSnapshot: structuredClone(settings), creativeSeed,
      creativeGenome: plan.genome, creativeFingerprint: plan.fingerprint.signature, generationBrief,
      referenceAssetIds: [...binding.assetIds], promptId: null, submissionHash: null,
      archivePath: null, archiveSize: null, archiveSha256: null, revision: 0,
      createdAt: timestamp, updatedAt: timestamp, error: null
    });
    this.store.saveSession({ ...session, status, currentJobId: job.jobId }, eventType);
    return job;
  }

  private async resumeCanaries(): Promise<void> {
    if (this.closed) return;
    for (const session of this.store.listSessions().filter(candidate => ['CANARY_STARTING', 'CANARY_RUNNING', 'TWO_JOB_CANARY_STARTING', 'TWO_JOB_CANARY_RUNNING', 'PRODUCTION_STARTING', 'PRODUCTION_RUNNING'].includes(candidate.status))) await this.driveCanary(session.sessionId);
  }

  private async driveCanary(sessionId: string): Promise<void> {
    if (this.closed || this.mode === 'shadow' || this.driving.has(sessionId)) return;
    this.driving.add(sessionId);
    try {
      const maxJobs = this.mode === 'production' ? null : this.mode === 'two-job-canary' ? 2 : 1;
      const runningStatus: PersistedSession['status'] = this.mode === 'production' ? 'PRODUCTION_RUNNING' : this.mode === 'two-job-canary' ? 'TWO_JOB_CANARY_RUNNING' : 'CANARY_RUNNING';
      const finishedStatus: PersistedSession['status'] = this.mode === 'two-job-canary' ? 'TWO_JOB_CANARY_FINISHED' : 'CANARY_FINISHED';
      while (!this.closed) {
        let session = this.requireSession(sessionId);
        const jobs = this.store.listJobs(sessionId);
        if (maxJobs !== null && jobs.length > maxJobs) throw new Error(`CANARY SAFETY: more than ${maxJobs} jobs exist for the session.`);
        let job = session.currentJobId ? this.store.getJob(session.currentJobId) : null;
        if (!job) {
          if (maxJobs !== null && jobs.length >= maxJobs) {
            this.store.saveSession({ ...session, status: finishedStatus, currentJobId: null, lastError: jobs.at(-1)?.error ?? null }, 'CANARY_JOB_LIMIT_FINISHED');
            return;
          }
          job = this.planJob(sessionId, runningStatus, jobs.length === 0 ? 'CANARY_JOB_SELECTED' : 'CANARY_NEXT_JOB_SELECTED');
        } else if (session.status !== runningStatus) {
          this.store.saveSession({ ...session, status: runningStatus, currentJobId: job.jobId }, 'CANARY_RECOVERY_RESUMED');
        }
        session = this.requireSession(sessionId);
        const update = (phase: PersistedJob['phase'], patch: Partial<PersistedJob> = {}) => this.store.updateJob(job!.jobId, phase, patch);
        const result = await this.canaryExecutor.executeStep(session, this.store.getJob(job.jobId) ?? job, { update });
        if (this.closed) return;
        if (result.phase !== 'COMPLETED' && result.phase !== 'FAILED') return;
        const latest = this.requireSession(sessionId);
        if (latest.stopAfterCurrent || latest.stopNow) {
          this.store.saveSession({ ...latest, status: 'STOPPED', currentJobId: null, lastError: result.error }, 'CANARY_STOPPED_AFTER_CURRENT');
          return;
        }
        if (maxJobs !== null && this.store.listJobs(sessionId).length >= maxJobs) {
          this.store.saveSession({ ...latest, status: finishedStatus, currentJobId: null, lastError: result.error }, 'CANARY_JOB_LIMIT_FINISHED');
          return;
        }
        // The Comfy prompt UUID identifies the whole Qwen -> validation -> H3
        // graph. It is persisted before validation and therefore cannot prove
        // that H3 sampling started. Only H3-stage execution evidence can gate
        // the next job on a VRAM release audit.
        const h3Started = h3LifecycleStarted(result);
        const vramVerified = result.vramAudit?.h3VramReleaseSucceeded === true
          && result.vramAudit?.h3VramVerification === 'PASSED'
          && result.vramAudit?.h3VramPostMeasurementFresh === true;
        if (h3Started && !vramVerified) {
          this.store.saveSession({ ...latest, status: runningStatus, lastError: 'Job terminal state is waiting for verified local VRAM cleanup.' }, 'CANARY_NEXT_JOB_BLOCKED_VRAM');
          return;
        }
        this.advanceCanaryCursor(result, runningStatus);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const job = this.store.listJobs(sessionId).at(-1);
        if (job && !['COMPLETED', 'FAILED'].includes(job.phase)) this.store.updateJob(job.jobId, 'FAILED', { error: message, completedAt: now() });
        const session = this.store.getSession(sessionId);
        if (session) this.store.saveSession({ ...session, status: this.mode === 'production' ? 'FAILED' : this.mode === 'two-job-canary' ? 'TWO_JOB_CANARY_FINISHED' : 'CANARY_FINISHED', currentJobId: null, lastError: message }, this.mode === 'production' ? 'PRODUCTION_INFRASTRUCTURE_FAILURE' : 'CANARY_FATAL_FAILURE');
    } finally { this.driving.delete(sessionId); }
  }

  private advanceCanaryCursor(job: PersistedJob, runningStatus: PersistedSession['status']): void {
    const session = this.requireSession(job.sessionId);
    if (session.currentJobId !== job.jobId) return;
    const advanced = advanceAutoCursor({
      selectedProducts: session.bundle.selectedProducts,
      selectedContentTypes: session.bundle.selectedContentTypes,
      shuffleProducts: session.bundle.ordering.shuffleProducts,
      shuffleContentTypes: session.bundle.ordering.shuffleContentTypes,
      chinaRoot: session.bundle.archiveRoot,
      laptopRoot: '', sessionId: session.sessionId, status: 'RUNNING', startedAt: session.createdAt, stoppedAt: null,
      productOrder: session.bundle.ordering.productOrder, contentTypeOrder: session.bundle.ordering.contentTypeOrder,
      cycleNumber: session.cycleNumber, cycleSeed: session.cycleSeed, productIndex: session.productIndex,
      contentTypeIndex: session.contentTypeIndex, generatedCount: 0, completedCount: 0, failedCount: 0,
      pendingLaptopDownloads: 0, stopRequested: false, currentJobId: job.jobId, lastSuccessfulJobId: null, lastError: null
    }, newSeed());
    this.store.saveSession({ ...session, currentJobId: null, status: runningStatus, productIndex: advanced.productIndex, contentTypeIndex: advanced.contentTypeIndex, cycleNumber: advanced.cycleNumber, cycleSeed: advanced.cycleSeed, bundle: { ...session.bundle, ordering: { ...session.bundle.ordering, productOrder: advanced.productOrder, contentTypeOrder: advanced.contentTypeOrder } } }, 'CANARY_CURSOR_ADVANCED');
  }

  simulatePhase(jobId: string, phase: PersistedJob['phase']): PersistedJob {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error('Unknown job.');
    const saved = this.store.updateJob(jobId, phase);
    if (phase === 'COMPLETED' || phase === 'FAILED') this.advanceAfterTerminal(saved);
    return saved;
  }

  persistSubmissionIntent(jobId: string, submission: unknown): PersistedJob {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error('Unknown job.');
    return this.store.updateJob(jobId, 'SUBMISSION_INTENT_PERSISTED', { submissionHash: LocalComfyClient.submissionHash(submission) });
  }

  async recoverSubmissionIntent(jobId: string): Promise<{ job: PersistedJob; ambiguous: boolean }> {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error('Unknown job.');
    if (job.phase !== 'SUBMISSION_INTENT_PERSISTED' || job.promptId) return { job, ambiguous: false };
    const promptId = await this.comfy.reconcileIdentity(job.jobId);
    if (!promptId) return { job, ambiguous: true };
    return { job: this.store.updateJob(jobId, 'SUBMITTED', { promptId }), ambiguous: false };
  }

  async submitGeneration(): Promise<never> {
    throw new Error('SHADOW SAFETY: generation submission is impossible in Phase 1.');
  }

  private advanceAfterTerminal(job: PersistedJob): void {
    const session = this.requireSession(job.sessionId);
    if (session.currentJobId !== job.jobId) return;
    if (session.stopAfterCurrent || session.stopNow) {
      this.store.saveSession({ ...session, currentJobId: null, status: 'STOPPED' }, 'SHADOW_STOPPED_AFTER_TERMINAL');
      return;
    }
    const advanced = advanceAutoCursor({
      selectedProducts: session.bundle.selectedProducts,
      selectedContentTypes: session.bundle.selectedContentTypes,
      shuffleProducts: session.bundle.ordering.shuffleProducts,
      shuffleContentTypes: session.bundle.ordering.shuffleContentTypes,
      chinaRoot: session.bundle.archiveRoot,
      laptopRoot: '', sessionId: session.sessionId, status: 'RUNNING', startedAt: session.createdAt, stoppedAt: null,
      productOrder: session.bundle.ordering.productOrder, contentTypeOrder: session.bundle.ordering.contentTypeOrder,
      cycleNumber: session.cycleNumber, cycleSeed: session.cycleSeed, productIndex: session.productIndex,
      contentTypeIndex: session.contentTypeIndex, generatedCount: 0, completedCount: 0, failedCount: 0,
      pendingLaptopDownloads: 0, stopRequested: false, currentJobId: job.jobId, lastSuccessfulJobId: null, lastError: null
    }, newSeed());
    this.store.saveSession({ ...session, currentJobId: null, status: 'STAGED', productIndex: advanced.productIndex, contentTypeIndex: advanced.contentTypeIndex, cycleNumber: advanced.cycleNumber, cycleSeed: advanced.cycleSeed, bundle: { ...session.bundle, ordering: { ...session.bundle.ordering, productOrder: advanced.productOrder, contentTypeOrder: advanced.contentTypeOrder } } }, 'SHADOW_CURSOR_ADVANCED');
  }

  private requireSession(id: string): PersistedSession {
    const session = this.store.getSession(id);
    if (!session) throw new Error('Unknown session.');
    return session;
  }

  describeJob(job: PersistedJob): Record<string, unknown> {
    return { ...job, primaryReference: job.referenceAssetIds[0] ? basename(job.referenceAssetIds[0]) : null };
  }

  close(): void { this.closed = true; if (this.canaryTimer) clearInterval(this.canaryTimer); this.store.close(); }
}
