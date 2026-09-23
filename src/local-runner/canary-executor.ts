import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RemoteComfyComputeProvider, findComfyVideoOutputs } from '../../electron/main/compute-provider';
import { safeOutputComponent } from '../domain/auto-h3';
import { buildH3ReferenceContext, serializeH3GenerationBrief } from '../domain/h3-generation-brief';
import { h3WorkflowSettingsFromBrief } from '../domain/h3';
import { validateH3WorkflowSettings } from '../domain/minimax-h3-workflow';
import { isNoProductVideo } from '../domain/support-b-roll';
import { isCtaEndCard, renderCtaEndCard, defaultCtaSettings } from '../domain/cta-end-card';
import { defaultH3PromptEngineSettings } from '../domain/settings';
import type { ComputeJobState, H3PromptEngineSettings, H3WorkflowSettingsSnapshot, RemoteH3GenerationRequest } from '../domain/types';
import { sha256 } from './staging';
import type { JobPhase, PersistedJob, PersistedSession } from './types';

export interface CanaryExecutionHooks {
  update(phase: JobPhase, patch?: Partial<PersistedJob>): PersistedJob;
}

export interface CanaryExecutor {
  executeStep(session: PersistedSession, job: PersistedJob, hooks: CanaryExecutionHooks): Promise<PersistedJob>;
}

function stagedAssetPath(session: PersistedSession, assetId: string): string {
  const asset = session.bundle.assets.find(candidate => candidate.id === assetId);
  if (!asset) throw new Error(`Staged asset ${assetId} is missing.`);
  return join(session.sessionDirectory, 'assets', `${asset.id}__${asset.filename}`);
}

function buildRequest(session: PersistedSession, job: PersistedJob): RemoteH3GenerationRequest {
  const settings = job.settingsSnapshot ?? session.bundle.settings;
  const workflow = settings.h3
    ? settings.h3 as H3WorkflowSettingsSnapshot
    : validateH3WorkflowSettings(h3WorkflowSettingsFromBrief(settings.brief));
  const promptEngine = (settings.promptEngine ?? defaultH3PromptEngineSettings) as H3PromptEngineSettings;
  const referenceImages = job.referenceAssetIds.map(assetId => ({ localPath: stagedAssetPath(session, assetId) }));
  const supportBRoll = isNoProductVideo(job.contentType);
  return {
    autoJobId: job.jobId, autoSessionId: session.sessionId, autoCycleNumber: job.cycleNumber,
    localJobId: job.jobId, product: job.product, mode: supportBRoll ? 'T2VA' : 'REF2VA', generationBrief: job.generationBrief,
    generationBriefText: serializeH3GenerationBrief(job.generationBrief), referenceContext: buildH3ReferenceContext(job.generationBrief),
    mediaManifest: job.generationBrief.mediaManifest, allowedReferenceLabels: job.generationBrief.allowedReferenceLabels,
    promptEngine, systemPromptOverride: session.bundle.systemPrompt,
    duration: job.durationSeconds ?? workflow.durationSeconds, aspectRatio: workflow.aspectRatio, fps: workflow.fps, frames: workflow.frameLength,
    megapixels: workflow.megapixels, multiple: workflow.multiple, steps: workflow.steps, seed: workflow.seed,
    scheduler: workflow.scheduler, refImageSize: workflow.refImageSize, workflowSettings: workflow,
    firstFrame: null, lastFrame: null, productReference: null, referenceImages,
    productReferencePath: job.referenceAssetIds[0] ? stagedAssetPath(session, job.referenceAssetIds[0]) : null
  };
}

const terminal = (state: ComputeJobState): boolean => ['completed', 'failed', 'error'].includes(state.status);

/** Real canary execution uses loopback ComfyUI only; it has no Cloudflare URL or external path. */
export class LocalCanaryExecutor implements CanaryExecutor {
  private providers = new Map<string, RemoteComfyComputeProvider>();

  private provider(session: PersistedSession, job: PersistedJob): RemoteComfyComputeProvider {
    const supportBRoll = isNoProductVideo(job.contentType);
    const providerKey = `${session.sessionId}:${supportBRoll ? 't2va' : 'ref2va'}`;
    let provider = this.providers.get(providerKey);
    if (!provider) {
      provider = new RemoteComfyComputeProvider({
        baseUrl: 'http://127.0.0.1:8188', workflowPath: join(session.sessionDirectory, supportBRoll ? 'workflow-support-b-roll-t2va.json' : 'workflow.json'),
        auth: { type: 'none' }, includeSubmissionJson: true,
        localReferenceRoots: [join(session.sessionDirectory, 'assets')], pollIntervalMs: 1000
      });
      this.providers.set(providerKey, provider);
    }
    return provider;
  }

  async executeStep(session: PersistedSession, job: PersistedJob, hooks: CanaryExecutionHooks): Promise<PersistedJob> {
    if (isCtaEndCard(job.contentType)) {
      if (job.phase === 'COMPLETED' || job.phase === 'FAILED') return job;
      try {
        if (job.product === 'full-series') throw new Error('CTA Full Series requires a verified composite master; the serum thumbnail is not a Full Series master.');
        const assetId = job.referenceAssetIds[0];
        if (!assetId) throw new Error(`CTA verified product master missing for ${job.product}.`);
        const settings = job.settingsSnapshot?.brief ?? session.bundle.settings.brief;
        const date = job.createdAt.slice(0, 10);
        const path = join(session.bundle.archiveRoot, date, job.product, 'CTA-End-Card', `${job.jobId}.mp4`);
        const result = await renderCtaEndCard({ productId: job.product, masterPath: stagedAssetPath(session, assetId), outputPath: path,
          settings: { ...(settings.cta ?? defaultCtaSettings), duration: job.durationSeconds ?? settings.duration }, language: settings.language, aspectRatio: settings.aspectRatio === 'Custom' ? '9:16' : settings.aspectRatio, seed: job.creativeSeed,
          previousStyle: job.ctaPreviousStyle });
        return hooks.update('COMPLETED', { archivePath: result.path, archiveSha256: result.sha256, archiveSize: result.size,
          ctaStyle: result.style, outputSize: result.size, outputFilename: result.path, archivedAt: new Date().toISOString(), completedAt: new Date().toISOString(), error: null });
      } catch (error) { return hooks.update('FAILED', { error: String(error), completedAt: new Date().toISOString() }); }
    }
    const provider = this.provider(session, job);
    let current = job;
    try {
      if (current.phase === 'PREPARING') {
        const request = current.request ?? buildRequest(session, current);
        current = hooks.update('PREPARING', { request });
        const submitted = await provider.submitH3(request, state => {
          if (state.submissionJson && !current.submissionHash) current = hooks.update('SUBMISSION_INTENT_PERSISTED', { submissionHash: sha256(state.submissionJson), executionState: state });
          else if (state.remotePromptId) current = hooks.update(state.status === 'running' ? 'RUNNING' : 'SUBMITTED', { promptId: state.remotePromptId, executionState: state });
          else current = hooks.update(current.phase, { executionState: state });
        }, request.productReferencePath ? { productReferencePath: request.productReferencePath } : undefined);
        if (!submitted.remotePromptId) return current;
        current = hooks.update(submitted.status === 'running' ? 'RUNNING' : 'SUBMITTED', { promptId: submitted.remotePromptId, executionState: submitted });
      }
      if (current.phase === 'SUBMISSION_INTENT_PERSISTED' && !current.promptId) {
        const recovered = await provider.reconcileAutoJob(current.jobId);
        return recovered ? hooks.update('SUBMITTED', { promptId: recovered }) : current;
      }
      if ((current.phase === 'SUBMITTED' || current.phase === 'RUNNING') && current.promptId) {
        const state = await provider.getJobState(current.promptId);
        current = hooks.update(state.status === 'running' || state.status === 'queued' || state.status === 'submitted' ? 'RUNNING' : current.phase, { executionState: state });
        if (!terminal(state)) return current;
        if (state.status !== 'completed') return hooks.update('FAILED', { error: state.error ?? state.failureStage ?? 'Canary H3 workflow failed.' });
        const output = findComfyVideoOutputs(state.outputs)[0];
        if (!output) return hooks.update('FAILED', { error: 'H3 completed without an authoritative SaveVideo output.' });
        current = hooks.update('OUTPUT_CAPTURED', { outputFilename: output.filename, outputCapturedAt: new Date().toISOString(), executionState: state });
      }
      if (current.phase === 'OUTPUT_CAPTURED') {
        const output = findComfyVideoOutputs(current.executionState?.outputs ?? [])[0];
        if (!output) return hooks.update('FAILED', { error: 'Captured output metadata is unavailable for local archive.' });
        const relativePath = `${new Date().toISOString().slice(0, 10)}/${safeOutputComponent(current.product)}/${safeOutputComponent(current.contentType)}/${current.jobId}.mp4`;
        const archive = await provider.archiveAutoOutput(output, session.bundle.archiveRoot, relativePath);
        const archiveSha256 = sha256(readFileSync(archive.path));
        current = hooks.update('ARCHIVED', { archivePath: archive.path, archiveSize: archive.size, outputSize: archive.size, archiveSha256, archivedAt: new Date().toISOString() });
      }
      if (current.phase === 'ARCHIVED' || current.phase === 'RELEASING_VRAM') {
        if (!current.promptId) return hooks.update('FAILED', { error: 'Cannot authorize local VRAM release without the persisted prompt ID.' });
        const promptId = current.promptId;
        const attempts = (current.releaseAttempts ?? 0) + 1;
        current = hooks.update('RELEASING_VRAM', { releaseAttempts: attempts });
        const audit = await provider.releaseH3Vram({ previousJobId: current.jobId, previousPromptId: promptId, completionProven: true, completionEvidence: current.archivePath ? 'china_archive' : 'output' }, next => { current = hooks.update('RELEASING_VRAM', { vramAudit: next, releaseAttempts: attempts }); });
        if (audit.h3VramReleaseSucceeded === true && audit.h3VramVerification === 'PASSED' && audit.h3VramPostMeasurementFresh === true) return hooks.update('COMPLETED', { vramAudit: audit, error: null });
        if (attempts >= 3) return hooks.update('FAILED', { vramAudit: audit, error: audit.h3VramReleaseError ?? 'Fresh local GPU telemetry did not verify VRAM release after three attempts.' });
        return hooks.update('RELEASING_VRAM', { vramAudit: audit, error: audit.h3VramReleaseError ?? 'Local VRAM verification pending retry.' });
      }
      return current;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (/acceptance is unknown|fetch failed|network|socket|ECONN|ECONNREFUSED|timeout|temporar/i.test(message)) return current;
      return hooks.update('FAILED', { error: message });
    }
  }
}

export { buildRequest as buildCanaryRequest };
