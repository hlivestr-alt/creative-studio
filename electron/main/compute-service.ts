import { createHash, randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AppSettings, ComfyOutputFile, ComputeJobState, H3PipelineStage, H3PromptEngineStatus, H3WorkflowAspectRatio, H3WorkflowSettings, RemoteComfySystemInfo, RemoteH3GenerationRequest, RemoteH3JobRecord } from '../../src/domain/types';
import { buildH3ReferenceContext, serializeH3GenerationBrief } from '../../src/domain/h3-generation-brief';
import { normalizeAutonomousH3PromptEngineSettings, readH3WorkflowTemplateDefaults, validateH3PromptEngineSettings, validateH3WorkflowSettings } from '../../src/domain/minimax-h3-workflow';
import { classifyH3PromptEngineError, findComfyVideoOutputs, h3PromptEngineAudit, h3PromptEngineErrorMessage, isCanonicalComfyPromptId, LocalComputeProvider, normalizeComfyUrl, RemoteComfyComputeProvider, type ComfyAuth, type ComputeProvider } from './compute-provider';

export interface ReferencePathAuthorizer {
  getAuthorizedPath(sessionId: number, sourcePath: string): string | null;
}

export interface RemoteH3JobPersistence {
  listRemoteH3Jobs(limit?: number): RemoteH3JobRecord[];
  upsertRemoteH3Job(record: RemoteH3JobRecord): RemoteH3JobRecord;
}

type JobEntry = {
  provider: ComputeProvider;
  localJobId: string;
  remotePromptId: string;
  request: RemoteH3GenerationRequest;
  createdAt: string;
  stop: () => void;
  downloadStarted: boolean;
};

type StageTimingCursor = {
  stage: H3PipelineStage;
  startedAt: number;
  durations: Record<string, number>;
};

export function comfyAuthFromEnvironment(environment: NodeJS.ProcessEnv = process.env): ComfyAuth {
  const token = environment.PROYA_COMFY_AUTH_TOKEN?.trim();
  return token ? { type: 'bearer', token } : { type: 'none' };
}

function connectionFailure(url: string, reason: unknown): RemoteComfySystemInfo {
  return {
    connected: false,
    url,
    comfyVersion: null,
    gpuName: null,
    vramTotalBytes: null,
    vramFreeBytes: null,
    latencyMs: null,
    error: reason instanceof Error ? reason.message : 'Could not connect to ComfyUI.'
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Could not connect to ComfyUI.';
}

function normalizePromptEngineState(state: ComputeJobState, settings: RemoteH3GenerationRequest['promptEngine'] | null): ComputeJobState {
  const effectiveSettings = state.promptEngine ?? settings;
  const audited = { ...state, ...h3PromptEngineAudit(effectiveSettings) };
  if (!state.error) return audited;
  const classified = classifyH3PromptEngineError(state.error);
  const isPromptFailure = state.currentNode === '149'
    || state.failureStage === 'PROMPT_GENERATION_FAILED'
    || state.failureStage === 'PROMPT_GENERATION_TIMEOUT'
    || state.failureStage === 'LLM_UNAVAILABLE';
  if (!isPromptFailure || classified === 'PROMPT_GENERATION_FAILED') return audited;
  return {
    ...audited,
    pipelineStage: classified,
    failureStage: classified,
    error: h3PromptEngineErrorMessage(state.error, effectiveSettings)
  };
}

function emptyState(localJobId: string, status: ComputeJobState['status'], serverUrl: string, remotePromptId: string | null = null): ComputeJobState {
  return {
    localJobId,
    remotePromptId,
    status,
    progress: null,
    currentNode: null,
    queuePosition: null,
    queueRemaining: null,
    outputs: [],
    referenceUploads: [],
    remoteUploadedFilename: null,
    localResultPath: null,
    downloadError: null,
    error: null,
    connectionError: null,
    serverUrl,
    updatedAt: new Date().toISOString(),
    pipelineStage: 'PREPARING',
    referenceMap: [],
    stageTimings: {}
  };
}

function isTerminal(status: ComputeJobState['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'error';
}

function isRemoteTracked(status: ComputeJobState['status']): boolean {
  return status === 'submitted' || status === 'queued' || status === 'running';
}

function pathWithin(root: string, target: string): boolean {
  const relativePath = relative(resolve(root), resolve(target));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function mergeState(previous: ComputeJobState | undefined, next: ComputeJobState): ComputeJobState {
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    localJobId: next.localJobId ?? previous.localJobId,
    remotePromptId: next.remotePromptId ?? previous.remotePromptId,
    progress: next.progress ?? previous.progress,
    currentNode: next.currentNode ?? previous.currentNode,
    queuePosition: next.queuePosition ?? previous.queuePosition,
    queueRemaining: next.queueRemaining ?? previous.queueRemaining,
    outputs: next.outputs.length > 0 ? next.outputs : previous.outputs,
    referenceUploads: next.referenceUploads.length > 0 ? next.referenceUploads : previous.referenceUploads,
    remoteUploadedFilename: next.remoteUploadedFilename ?? previous.remoteUploadedFilename,
    localResultPath: next.localResultPath ?? previous.localResultPath,
    downloadError: next.downloadError ?? previous.downloadError,
    pipelineStage: next.pipelineStage ?? previous.pipelineStage,
    failureStage: next.failureStage ?? previous.failureStage,
    generationBrief: next.generationBrief ?? previous.generationBrief,
    referenceMap: next.referenceMap && next.referenceMap.length > 0 ? next.referenceMap : previous.referenceMap,
    mediaManifest: next.mediaManifest ?? previous.mediaManifest,
    allowedReferenceLabels: next.allowedReferenceLabels ?? previous.allowedReferenceLabels,
    physicalReferenceMap: next.physicalReferenceMap && next.physicalReferenceMap.length > 0 ? next.physicalReferenceMap : previous.physicalReferenceMap,
    systemPromptHash: next.systemPromptHash ?? previous.systemPromptHash,
    lmStudioModelId: next.lmStudioModelId ?? previous.lmStudioModelId,
    llmModelId: next.llmModelId ?? previous.llmModelId,
    temperature: next.temperature ?? previous.temperature,
    llmModel: next.llmModel ?? previous.llmModel,
    llmTemperature: next.llmTemperature ?? previous.llmTemperature,
    llmTimeoutSeconds: next.llmTimeoutSeconds ?? previous.llmTimeoutSeconds,
    llmRepairAttempts: next.llmRepairAttempts ?? previous.llmRepairAttempts,
    repairAttemptsConfigured: next.repairAttemptsConfigured ?? previous.repairAttemptsConfigured,
    llmDisableThinking: next.llmDisableThinking ?? previous.llmDisableThinking,
    repairAttemptsUsed: next.repairAttemptsUsed ?? previous.repairAttemptsUsed,
    enhancementManifest: next.enhancementManifest ?? previous.enhancementManifest,
    rewriteDiagnostics: next.rewriteDiagnostics ?? previous.rewriteDiagnostics,
    finalEnhancedPrompt: next.finalEnhancedPrompt ?? previous.finalEnhancedPrompt,
    validationReport: next.validationReport ?? previous.validationReport,
    promptCaptureSource: next.promptCaptureSource ?? previous.promptCaptureSource,
    validationCaptureSource: next.validationCaptureSource ?? previous.validationCaptureSource,
    promptEngine: next.promptEngine ?? previous.promptEngine,
    llmUnloadRequested: next.llmUnloadRequested ?? previous.llmUnloadRequested,
    llmUnloadSucceeded: next.llmUnloadSucceeded ?? previous.llmUnloadSucceeded,
    llmUnloadError: next.llmUnloadError ?? previous.llmUnloadError,
    llmInstanceId: next.llmInstanceId ?? previous.llmInstanceId,
    llmUnloadDurationMs: next.llmUnloadDurationMs ?? previous.llmUnloadDurationMs,
    stageTimings: next.stageTimings && Object.keys(next.stageTimings).length > 0 ? { ...previous.stageTimings, ...next.stageTimings } : previous.stageTimings
  };
}

export function reconcileRemoteJobState(previous: ComputeJobState, remote: ComputeJobState): ComputeJobState {
  const missingRemoteEntry = remote.status === 'submitted' && (previous.status === 'queued' || previous.status === 'running' || previous.status === 'completed');
  const reconciled = mergeState(previous, remote);
  if (missingRemoteEntry) {
    return {
      ...reconciled,
      status: previous.status,
      connectionError: remote.connectionError ?? 'ComfyUI has not exposed this job in history or the queue yet; it will continue to be checked.'
    };
  }
  return { ...reconciled, connectionError: remote.connectionError };
}

/** Capture effective values before the provider can upload or POST anything. */
export function withWorkflowSettingsSnapshot(request: RemoteH3GenerationRequest): RemoteH3GenerationRequest {
  if (request.workflowSettings) {
    const snapshot = validateH3WorkflowSettings(request.workflowSettings);
    return {
      ...request,
      steps: request.steps ?? snapshot.steps,
      seed: request.seed ?? snapshot.seed,
      scheduler: request.scheduler ?? snapshot.scheduler,
      refImageSize: request.refImageSize ?? snapshot.refImageSize,
      // Re-materialize the validated values so later UI changes cannot alter
      // the settings object captured for this job.
      workflowSettings: { ...snapshot }
    };
  }
  const seed = request.seed ?? randomInt(0, 4_294_967_296);
  const snapshot = validateH3WorkflowSettings({
    durationSeconds: request.duration,
    aspectRatio: request.aspectRatio as H3WorkflowAspectRatio,
    megapixels: request.megapixels,
    multiple: request.multiple,
    fps: request.fps,
    steps: request.steps ?? 20,
    scheduler: request.scheduler ?? 'simple',
    seedMode: request.seed === undefined ? 'random' : 'fixed',
    seed,
    refImageSize: request.refImageSize ?? 'match'
  });
  return {
    ...request,
    steps: snapshot.steps,
    seed: snapshot.seed,
    scheduler: snapshot.scheduler,
    refImageSize: snapshot.refImageSize,
    workflowSettings: snapshot
  };
}

/** Reads the current configured API workflow's canonical defaults for Reset to Workflow Defaults. */
export function readH3WorkflowDefaultsFromFile(filePath: string): H3WorkflowSettings {
  const absolutePath = resolve(filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  } catch (reason) {
    throw new Error(`Could not read H3 workflow defaults from ${absolutePath}: ${errorMessage(reason)}`, { cause: reason });
  }
  try {
    return readH3WorkflowTemplateDefaults(parsed);
  } catch (reason) {
    throw new Error(`Could not read H3 workflow defaults from ${absolutePath}: ${errorMessage(reason)}`, { cause: reason });
  }
}

export function readExactSystemPrompt(filePath: string): { text: string; hash: string } {
  const absolutePath = resolve(filePath);
  let bytes: Buffer;
  try {
    bytes = readFileSync(absolutePath);
  } catch (reason) {
    throw new Error(`Required MiniMax H3 LM Studio system prompt is missing at ${absolutePath}. Add prompts/minimax-h3-lmstudio-system.md exactly as supplied: ${errorMessage(reason)}`, { cause: reason });
  }
  const text = bytes.toString('utf8');
  if (!bytes.length || !text.trim().length) throw new Error(`Required MiniMax H3 LM Studio system prompt is empty at ${absolutePath}. The exact supplied prompt must be present before H3 can run.`);
  return { text, hash: createHash('sha256').update(bytes).digest('hex') };
}

export class ComputeService {
  private readonly activeJobs = new Map<string, JobEntry>();
  private readonly lastStates = new Map<string, ComputeJobState>();
  private readonly records = new Map<string, RemoteH3JobRecord>();
  private readonly providerCache = new Map<string, RemoteComfyComputeProvider>();
  private readonly stageTimingCursors = new Map<string, StageTimingCursor>();
  private submissionInFlight = false;
  private readonly finalizingJobs = new Map<string, Promise<ComputeJobState>>();
  private readonly releasingJobs = new Map<string, Promise<ComputeJobState>>();
  private restoringJobs: Promise<RemoteH3JobRecord[]> | null = null;

  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly emitState: (state: ComputeJobState) => void,
    private readonly developmentMode = false,
    private readonly persistence?: RemoteH3JobPersistence,
    private readonly localReferenceRoots: string[] = [],
    private readonly referenceAuthorizer?: ReferencePathAuthorizer
  ) {}

  async testConnection(url: string): Promise<RemoteComfySystemInfo> {
    try {
      return await this.providerForUrl(url).testConnection();
    } catch (reason) {
      return connectionFailure(url, reason);
    }
  }

  async testPromptEngine(url = this.getSettings().remoteComfyUrl, settings = this.getSettings().h3PromptEngine): Promise<H3PromptEngineStatus> {
    const base = {
      enhancerInstalled: false,
      validatorInstalled: false,
      requiredNodesInstalled: false,
      lmStudioConnected: false,
      models: [],
      observedModelId: null,
      observedInstanceId: null,
      selectedModel: null,
      qwenReady: false,
      error: null,
      checkedAt: new Date().toISOString()
    } satisfies H3PromptEngineStatus;
    try { readExactSystemPrompt(this.getSettings().h3SystemPromptPath); }
    catch (reason) { return { ...base, error: errorMessage(reason) }; }
    try {
      return await this.providerForUrl(url).testPromptEngine(settings);
    } catch (reason) {
      return { ...base, error: errorMessage(reason) };
    }
  }

  getWorkflowDefaults(): H3WorkflowSettings {
    return readH3WorkflowDefaultsFromFile(this.getSettings().remoteComfyWorkflowPath);
  }

  async submitH3(request: RemoteH3GenerationRequest, sessionId?: number): Promise<ComputeJobState> {
    // Acquire synchronously, before any upload/network await or renderer callback.
    if (this.submissionInFlight) throw new Error('Another H3 submission is in progress. Generations must run one at a time.');
    this.submissionInFlight = true;
    try {
      if (this.restoringJobs) await this.restoringJobs;
      const settings = this.getSettings();
      const provider = this.providerForCurrentSettings(request.generationBrief ? 'remote' : undefined);
      if (provider.mode === 'remote') await this.prepareGpuForSubmission(provider, settings.remoteComfyUrl);
      return await this.submitSerializedH3(request, provider, settings, sessionId);
    } finally {
      this.submissionInFlight = false;
    }
  }

  private async prepareGpuForSubmission(provider: ComputeProvider, url: string): Promise<void> {
    await Promise.all(this.finalizingJobs.values());
    await Promise.all(this.releasingJobs.values());
    const serverUrl = normalizeComfyUrl(url);
    const records = this.listJobs(200)
      .filter((record) => normalizeComfyUrl(record.state.serverUrl || serverUrl) === serverUrl)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    for (const record of records) {
      const latest = this.lastStates.get(record.localJobId) ?? record.state;
      if (!isTerminal(latest.status)) {
        const reconciled = await this.getJobState(record.localJobId);
        if (!isTerminal(reconciled.status)) throw new Error('The previous H3 job is not finished. Wait for execution and VRAM release before starting Qwen.');
      }
    }
    // Check the server even after restart or if its work came from another client.
    await provider.assertQueueIdle();
    const previous = records.find((record) => isCanonicalComfyPromptId(record.remotePromptId));
    if (previous) {
      const state = this.lastStates.get(previous.localJobId) ?? previous.state;
      const released = await this.ensureH3VramReleased(previous, provider, state, true);
      if (released.h3VramReleaseSucceeded === false || released.h3VramReleaseDurationMs == null) {
        throw new Error(released.h3VramReleaseError ?? 'The previous H3 VRAM release has not completed. Qwen was not submitted.');
      }
    }
    await provider.assertQueueIdle();
  }

  private async submitSerializedH3(request: RemoteH3GenerationRequest, provider: ComputeProvider, settings: AppSettings, sessionId?: number): Promise<ComputeJobState> {
    const localJobId = request.localJobId?.trim() || request.clientJobId?.trim() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    let requestForTracking: RemoteH3GenerationRequest = { ...request };
    let promptEngineForTracking = request.generationBrief
      ? normalizeAutonomousH3PromptEngineSettings(settings.h3PromptEngine)
      : request.promptEngine ? normalizeAutonomousH3PromptEngineSettings(request.promptEngine) : null;
    let systemPromptHash: string | null = null;
    let promptSetupError: unknown = null;
    if (request.generationBrief) {
      requestForTracking = { ...request, promptEngine: promptEngineForTracking ?? undefined };
      try {
        const promptFile = readExactSystemPrompt(settings.h3SystemPromptPath);
        // The main process owns the internal request contract and always records
        // the fixed autonomous model before node 149 captures its exact instance.
        const promptEngine = validateH3PromptEngineSettings(normalizeAutonomousH3PromptEngineSettings(settings.h3PromptEngine));
        promptEngineForTracking = promptEngine;
        requestForTracking = {
          ...request,
          // These three values are derived in the main process from the same
          // immutable brief. Renderer-provided copies cannot drift from the
          // physical reference order or omit the timing/repair contract.
          generationBriefText: serializeH3GenerationBrief(request.generationBrief),
          referenceContext: buildH3ReferenceContext(request.generationBrief),
          mediaManifest: request.generationBrief.mediaManifest,
          allowedReferenceLabels: request.generationBrief.allowedReferenceLabels,
          promptEngine,
          // The renderer cannot replace the authoritative prompt file. The main
          // process reads the exact UTF-8 bytes and injects them into ComfyUI.
          systemPromptOverride: promptFile.text
        };
        systemPromptHash = promptFile.hash;
      } catch (reason) {
        promptSetupError = reason;
      }
    }
    const trackedRequest: RemoteH3GenerationRequest = { ...withWorkflowSettingsSnapshot(requestForTracking), localJobId, clientJobId: undefined };
    const createdAt = new Date().toISOString();
    let latest = emptyState(localJobId, 'preparing', settings.remoteComfyUrl);
    if (request.generationBrief) {
      latest = {
        ...latest,
        generationBrief: request.generationBrief,
        referenceMap: request.generationBrief.references,
        mediaManifest: trackedRequest.mediaManifest ?? request.generationBrief.mediaManifest,
        allowedReferenceLabels: trackedRequest.allowedReferenceLabels ?? request.generationBrief.allowedReferenceLabels,
        promptEngine: trackedRequest.promptEngine ?? null,
        systemPromptHash,
        llmUnloadRequested: trackedRequest.promptEngine?.unloadModelBeforeH3 ?? false,
        lmStudioModelId: trackedRequest.promptEngine?.model.trim() || null,
        temperature: trackedRequest.promptEngine?.temperature ?? null,
        ...h3PromptEngineAudit(trackedRequest.promptEngine)
      };
    }
    const publish = (state: ComputeJobState) => {
      const normalized = normalizePromptEngineState({ ...state, localJobId, remotePromptId: state.remotePromptId ?? latest.remotePromptId }, trackedRequest.promptEngine);
      latest = this.applyStageTiming(mergeState(latest, normalized));
      this.saveState(trackedRequest, latest, createdAt);
      this.emitState(latest);
    };
    try {
      if (promptSetupError) throw promptSetupError;
      const authorizedReferencePath = sessionId !== undefined && trackedRequest.productReferencePath?.trim()
        ? this.referenceAuthorizer?.getAuthorizedPath(sessionId, trackedRequest.productReferencePath) ?? null
        : null;
      const initial = await provider.submitH3(trackedRequest, publish, authorizedReferencePath ? { productReferencePath: authorizedReferencePath } : undefined);
      if (!initial.remotePromptId || !isCanonicalComfyPromptId(initial.remotePromptId)) {
        throw new Error('ComfyUI did not return a canonical prompt UUID. The remote job cannot be tracked safely.');
      }
      const remotePromptId = initial.remotePromptId;
      latest = this.applyStageTiming(mergeState(latest, { ...initial, localJobId, remotePromptId }));
      this.saveState(trackedRequest, latest, createdAt);
      const entry: JobEntry = { provider, localJobId, remotePromptId, request: trackedRequest, createdAt, stop: () => undefined, downloadStarted: false };
      this.activeJobs.set(localJobId, entry);
      this.activeJobs.set(remotePromptId, entry);
      entry.stop = provider.watchJob(remotePromptId, (state) => { void this.handleJobState(entry, state); });
      return latest;
    } catch (reason) {
      if (latest.status !== 'failed' && latest.status !== 'error') {
        const failureStage = request.generationBrief && promptSetupError
          ? 'PROMPT_GENERATION_FAILED' as const
          : latest.pipelineStage === 'UPLOADING_REFERENCES'
            ? 'REFERENCE_UPLOAD_FAILED' as const
            : latest.pipelineStage && latest.pipelineStage !== 'PREPARING' ? latest.pipelineStage : 'H3_QUEUE_FAILED';
        const promptFailure = latest.pipelineStage === 'WRITING_PROMPT' ? classifyH3PromptEngineError(errorMessage(reason)) : null;
        const resolvedFailureStage = promptFailure && promptFailure !== 'PROMPT_GENERATION_FAILED' ? promptFailure : failureStage;
        latest = this.applyStageTiming(normalizePromptEngineState({ ...latest, status: 'failed', pipelineStage: resolvedFailureStage, failureStage: resolvedFailureStage, error: h3PromptEngineErrorMessage(errorMessage(reason), trackedRequest.promptEngine), updatedAt: new Date().toISOString() }, trackedRequest.promptEngine));
        this.saveState(trackedRequest, latest, createdAt);
        this.emitState(latest);
      }
      throw reason;
    }
  }

  async getJobState(identifier: string): Promise<ComputeJobState> {
    const record = this.findRecord(identifier);
    const active = this.activeJobs.get(identifier) ?? (record ? this.activeJobs.get(record.localJobId) : undefined);
    const localJobId = active?.localJobId ?? record?.localJobId ?? null;
    const storedRemotePromptId = active?.remotePromptId ?? record?.remotePromptId ?? null;
    const remotePromptId = isCanonicalComfyPromptId(storedRemotePromptId)
      ? storedRemotePromptId
      : isCanonicalComfyPromptId(identifier) ? identifier : null;
    const stateKey = localJobId ?? identifier;
    const finalizing = this.finalizingJobs.get(stateKey);
    if (finalizing) return finalizing;
    const releasing = this.releasingJobs.get(stateKey);
    if (releasing) return releasing;

    if (!remotePromptId) {
      if (!record && !active) throw new Error('Remote H3 prompt ID must be a canonical UUID; the supplied identifier is not sent to ComfyUI.');
      const previous = this.lastStates.get(stateKey) ?? record?.state ?? emptyState(stateKey, 'submitted', this.getSettings().remoteComfyUrl);
       const state: ComputeJobState = this.applyStageTiming({
         ...previous,
         localJobId,
         remotePromptId: null,
         status: isTerminal(previous.status) ? previous.status : 'error',
         error: isTerminal(previous.status) ? previous.error : 'This Remote H3 job has no authoritative ComfyUI prompt ID and cannot be reconciled safely.',
         updatedAt: new Date().toISOString()
       });
      if (record) this.saveState(record.request, state, record.createdAt);
      else this.lastStates.set(stateKey, state);
      return state;
    }

    const provider = active?.provider ?? (record ? this.providerForJob(record) : this.providerForCurrentSettings('remote'));
    try {
      const remote = await provider.getJobState(remotePromptId);
      const identifiedRemote = normalizePromptEngineState({ ...remote, localJobId, remotePromptId }, active?.request.promptEngine ?? record?.request.promptEngine);
      const previous = this.lastStates.get(stateKey) ?? record?.state;
       const state = this.applyStageTiming(previous ? reconcileRemoteJobState(previous, identifiedRemote) : identifiedRemote);
      if (record && isTerminal(identifiedRemote.status)) {
        return this.handleJobState(active ?? this.entryForRecord(record, provider), state);
      }
      if (record) this.saveState(record.request, state, record.createdAt);
      else this.lastStates.set(stateKey, state);
      return state;
    } catch (reason) {
      if (!record && !active) throw reason;
      const previous = this.lastStates.get(stateKey) ?? record?.state ?? emptyState(stateKey, 'submitted', this.getSettings().remoteComfyUrl, remotePromptId);
      const state = this.applyStageTiming(normalizePromptEngineState({ ...previous, localJobId, remotePromptId, connectionError: errorMessage(reason), updatedAt: new Date().toISOString() }, active?.request.promptEngine ?? record?.request.promptEngine));
      if (record) this.saveState(record.request, state, record.createdAt);
      else this.lastStates.set(stateKey, state);
      return state;
    }
  }

  getOutputUrl(output: ComfyOutputFile): string {
    return this.providerForCurrentSettings('remote').getOutputUrl(output);
  }

  async downloadResult(identifier: string): Promise<ComputeJobState> {
    const record = this.findRecord(identifier);
    const active = this.activeJobs.get(identifier) ?? (record ? this.activeJobs.get(record.localJobId) : undefined);
    const stateKey = active?.localJobId ?? record?.localJobId ?? identifier;
    const provider = active?.provider ?? (record ? this.providerForJob(record) : this.providerForCurrentSettings('remote'));
    let state = this.lastStates.get(stateKey) ?? record?.state;
    if (!state || state.outputs.length === 0) state = await this.getJobState(identifier);
    if (this.finalizingJobs.has(stateKey)) state = await this.finalizingJobs.get(stateKey)!;
    if (!isTerminal(state.status)) throw new Error('Wait for H3 execution to finish before downloading.');
    if (record) state = await this.ensureH3VramReleased(record, provider, state);
    const output = findComfyVideoOutputs(state.outputs)[0];
    if (!output) {
       const next = this.applyStageTiming({ ...state, status: 'failed', pipelineStage: 'DOWNLOAD_FAILED' as const, failureStage: 'DOWNLOAD_FAILED' as const, downloadError: 'ComfyUI completed the job but did not return a video from SaveVideo node 92.', updatedAt: new Date().toISOString() });
      if (record) this.saveState(record.request, next, record.createdAt);
      this.emitState(next);
       throw new Error(next.downloadError ?? 'ComfyUI completed the job but did not return a video.');
    }
    try {
       const downloading = this.applyStageTiming({ ...state, pipelineStage: 'DOWNLOADING' as const, updatedAt: new Date().toISOString() });
      if (record) this.saveState(record.request, downloading, record.createdAt);
      else this.lastStates.set(stateKey, downloading);
      this.emitState(downloading);
      const result = await provider.downloadOutput(output, this.getSettings().remoteOutputDirectory);
       const next = this.applyStageTiming({ ...downloading, status: 'completed', localResultPath: result.localPath, downloadError: null, pipelineStage: 'COMPLETE' as const, failureStage: undefined, updatedAt: result.downloadedAt });
      if (record) this.saveState(record.request, next, record.createdAt);
      else this.lastStates.set(stateKey, next);
      this.emitState(next);
      return next;
    } catch (reason) {
       const next = this.applyStageTiming({ ...state, status: 'failed', downloadError: errorMessage(reason), pipelineStage: 'DOWNLOAD_FAILED' as const, failureStage: 'DOWNLOAD_FAILED' as const, updatedAt: new Date().toISOString() });
      if (record) this.saveState(record.request, next, record.createdAt);
      else this.lastStates.set(stateKey, next);
      this.emitState(next);
      throw reason;
    }
  }

  listJobs(limit = 100): RemoteH3JobRecord[] {
    if (this.persistence) {
      for (const record of this.persistence.listRemoteH3Jobs(limit)) this.records.set(record.localJobId, record);
    }
    return Array.from(this.records.values())
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }

  getLocalResultPath(identifier: string): string | null {
    const record = this.findRecord(identifier);
    const localJobId = record?.localJobId ?? identifier;
    const localPath = this.lastStates.get(localJobId)?.localResultPath ?? record?.localDownloadedPath ?? null;
    if (!localPath) throw new Error('This H3 job has no downloaded local result yet.');
    const outputDirectory = resolve(this.getSettings().remoteOutputDirectory);
    const resolvedPath = resolve(localPath);
    if (!pathWithin(outputDirectory, resolvedPath)) throw new Error('The saved result is outside the configured Remote output folder.');
    if (!existsSync(resolvedPath)) throw new Error('The saved local result no longer exists. Download it again from the remote job.');
    return resolvedPath;
  }

  restoreJobs(): Promise<RemoteH3JobRecord[]> {
    if (this.restoringJobs) return this.restoringJobs;
    this.restoringJobs = this.restoreStoredJobs().finally(() => { this.restoringJobs = null; });
    return this.restoringJobs;
  }

  private async restoreStoredJobs(): Promise<RemoteH3JobRecord[]> {
    if (!this.persistence) return [];
    const records = this.persistence.listRemoteH3Jobs(200).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const seenServers = new Set<string>();
    for (const record of records) {
      const server = record.state.serverUrl || this.getSettings().remoteComfyUrl;
      const latestOnServer = !seenServers.has(server) && isCanonicalComfyPromptId(record.remotePromptId);
      if (isCanonicalComfyPromptId(record.remotePromptId)) seenServers.add(server);
      this.records.set(record.localJobId, record);
      const restoredState = { ...record.state, localJobId: record.localJobId, remotePromptId: record.remotePromptId };
      this.lastStates.set(record.localJobId, restoredState);
      let state: ComputeJobState = restoredState;
      if (isRemoteTracked(state.status)) {
        if (!isCanonicalComfyPromptId(record.remotePromptId)) {
          state = {
            ...state,
            status: 'error',
            remotePromptId: null,
            error: 'This legacy Remote H3 job has no authoritative ComfyUI prompt UUID and cannot be reconciled safely.',
            updatedAt: new Date().toISOString()
          };
          this.saveState(record.request, state, record.createdAt);
          this.emitState(state);
          continue;
        }
        const provider = this.providerForJob(record);
        try {
           state = this.applyStageTiming(reconcileRemoteJobState(state, { ...await provider.getJobState(record.remotePromptId), localJobId: record.localJobId, remotePromptId: record.remotePromptId }));
        } catch (reason) {
          state = { ...state, connectionError: errorMessage(reason), updatedAt: new Date().toISOString() };
        }
        this.saveState(record.request, state, record.createdAt);
        this.emitState(state);
        if (isRemoteTracked(state.status)) this.startWatcher(record, provider);
        else if (isTerminal(state.status)) await this.handleJobState(this.entryForRecord(record, provider), state);
      } else if (isTerminal(state.status) && isCanonicalComfyPromptId(record.remotePromptId)
        && (latestOnServer || state.pipelineStage === 'RELEASING_H3_VRAM' || state.status === 'completed' && this.getSettings().remoteAutoDownload && !state.localResultPath)) {
        const provider = this.providerForJob(record);
        await this.handleJobState(this.entryForRecord(record, provider), state);
      }
    }
    return this.listJobs(200);
  }

  dispose(): void {
    for (const entry of new Set(this.activeJobs.values())) entry.stop();
    this.activeJobs.clear();
    this.stageTimingCursors.clear();
  }

  private entryForRecord(record: RemoteH3JobRecord, provider: ComputeProvider): JobEntry {
    return { provider, localJobId: record.localJobId, remotePromptId: record.remotePromptId ?? '', request: record.request, createdAt: record.createdAt, stop: () => undefined, downloadStarted: Boolean(record.state.localResultPath) };
  }

  private async ensureH3VramReleased(record: Pick<RemoteH3JobRecord, 'localJobId' | 'remotePromptId' | 'request' | 'createdAt'>, provider: ComputeProvider, state: ComputeJobState, retryFailure = false): Promise<ComputeJobState> {
    const pending = this.releasingJobs.get(record.localJobId);
    if (pending) return pending;
    if (provider.mode !== 'remote') return state;
    if (state.h3VramReleaseDurationMs != null && !(retryFailure && state.h3VramReleaseSucceeded === false)) return state;
    const release = async () => {
      const publish = (next: ComputeJobState) => {
        state = this.applyStageTiming({ ...next, updatedAt: new Date().toISOString() });
        this.saveState(record.request, state, record.createdAt);
        this.emitState(state);
      };
      const previousStage = state.pipelineStage;
      // Persist SaveVideo descriptors before ComfyUI clears its executor caches.
      publish({ ...state, pipelineStage: 'RELEASING_H3_VRAM', h3VramReleaseRequested: false, h3VramReleaseSucceeded: null, h3VramReleaseDurationMs: null, h3VramReleaseError: null });
      const result = await provider.releaseH3Vram(record.remotePromptId ?? '', () => publish({ ...state, h3VramReleaseRequested: true }));
      publish({ ...state, ...result, pipelineStage: state.status === 'completed'
        ? this.getSettings().remoteAutoDownload && !state.localResultPath ? 'RELEASING_H3_VRAM' : 'COMPLETE'
        : previousStage });
      return state;
    };
    const operation = release();
    this.releasingJobs.set(record.localJobId, operation);
    try { return await operation; }
    finally { this.releasingJobs.delete(record.localJobId); }
  }

  private handleJobState(entry: JobEntry, incoming: ComputeJobState): Promise<ComputeJobState> {
    const pending = this.finalizingJobs.get(entry.localJobId);
    if (pending) return pending;
    const operation = this.processJobState(entry, incoming);
    if (!isTerminal(incoming.status)) return operation;
    this.finalizingJobs.set(entry.localJobId, operation);
    return operation.finally(() => this.finalizingJobs.delete(entry.localJobId));
  }

  private async processJobState(entry: JobEntry, incoming: ComputeJobState): Promise<ComputeJobState> {
    const previous = this.lastStates.get(entry.localJobId);
    if (previous && isTerminal(previous.status) && previous.h3VramReleaseDurationMs != null && !isTerminal(incoming.status)) return previous;
    const normalizedIncoming = normalizePromptEngineState({ ...incoming, localJobId: entry.localJobId, remotePromptId: entry.remotePromptId || incoming.remotePromptId }, entry.request.promptEngine);
    let state = this.applyStageTiming(mergeState(previous, normalizedIncoming));
    if (isTerminal(state.status)) {
      entry.stop();
      state = await this.ensureH3VramReleased(entry, entry.provider, state);
    }
    const settings = this.getSettings();
    if (state.status === 'completed' && settings.remoteAutoDownload && !state.localResultPath && !entry.downloadStarted) {
      entry.downloadStarted = true;
      const output = findComfyVideoOutputs(state.outputs)[0];
      if (!output) {
           state = this.applyStageTiming({ ...state, status: 'failed', pipelineStage: 'DOWNLOAD_FAILED', failureStage: 'DOWNLOAD_FAILED', downloadError: 'ComfyUI completed the job but did not return a video from SaveVideo node 92.' });
       } else {
         try {
           state = this.applyStageTiming({ ...state, pipelineStage: 'DOWNLOADING', updatedAt: new Date().toISOString() });
          this.saveState(entry.request, state, entry.createdAt);
          this.emitState(state);
          const result = await entry.provider.downloadOutput(output, settings.remoteOutputDirectory);
           state = this.applyStageTiming({ ...state, status: 'completed', localResultPath: result.localPath, downloadError: null, pipelineStage: 'COMPLETE', failureStage: undefined, updatedAt: result.downloadedAt });
         } catch (reason) {
           state = this.applyStageTiming({ ...state, status: 'failed', downloadError: errorMessage(reason), pipelineStage: 'DOWNLOAD_FAILED', failureStage: 'DOWNLOAD_FAILED', updatedAt: new Date().toISOString() });
        }
      }
    }
    if (state.status === 'completed' && (!settings.remoteAutoDownload || state.localResultPath)) {
      state = this.applyStageTiming({ ...state, pipelineStage: 'COMPLETE' });
    }
    this.saveState(entry.request, state, entry.createdAt);
    this.emitState(state);
    if (isTerminal(state.status)) {
      entry.stop();
      for (const [identifier, current] of this.activeJobs.entries()) if (current === entry) this.activeJobs.delete(identifier);
    }
    return state;
  }

  private startWatcher(record: RemoteH3JobRecord, provider: ComputeProvider): void {
    if (!isCanonicalComfyPromptId(record.remotePromptId) || this.activeJobs.has(record.localJobId)) return;
    const entry: JobEntry = { provider, localJobId: record.localJobId, remotePromptId: record.remotePromptId, request: record.request, createdAt: record.createdAt, stop: () => undefined, downloadStarted: Boolean(record.state.localResultPath) };
    this.activeJobs.set(record.localJobId, entry);
    this.activeJobs.set(record.remotePromptId, entry);
    entry.stop = provider.watchJob(record.remotePromptId, (state) => { void this.handleJobState(entry, state); });
  }

  private saveState(request: RemoteH3GenerationRequest, state: ComputeJobState, createdAt: string): void {
    const localJobId = state.localJobId?.trim() || request.localJobId?.trim() || request.clientJobId?.trim();
    if (!localJobId) throw new Error('Remote H3 state is missing its local job identifier.');
    const remotePromptId = state.remotePromptId?.trim() || null;
    const promptEngine = state.promptEngine ?? request.promptEngine ?? null;
    const identifiedState = {
      ...normalizePromptEngineState({ ...this.applyStageTiming(state), localJobId, remotePromptId }, promptEngine),
      promptEngine
    };
    this.lastStates.set(localJobId, identifiedState);
    const record: RemoteH3JobRecord = {
      localJobId,
      remotePromptId,
      createdAt,
      updatedAt: identifiedState.updatedAt,
      promptRecordId: request.promptRecordId ?? null,
      product: request.product ?? null,
      workflowMode: request.mode,
      prompt: request.prompt ?? state.finalEnhancedPrompt ?? request.generationBriefText ?? '',
      generationBrief: request.generationBrief ?? state.generationBrief ?? null,
      generationBriefText: request.generationBriefText ?? null,
      referenceContext: request.referenceContext ?? null,
      promptEngine: request.promptEngine ?? state.promptEngine ?? null,
      systemPromptHash: identifiedState.systemPromptHash ?? null,
      lmStudioModelId: identifiedState.lmStudioModelId ?? identifiedState.llmModelId ?? null,
      llmModelId: identifiedState.llmModelId ?? identifiedState.lmStudioModelId ?? null,
      ...h3PromptEngineAudit(promptEngine),
      repairAttemptsConfigured: identifiedState.repairAttemptsConfigured ?? promptEngine?.repairAttempts ?? null,
      repairAttemptsUsed: identifiedState.repairAttemptsUsed ?? null,
      enhancementManifest: identifiedState.enhancementManifest ?? null,
      rewriteDiagnostics: identifiedState.rewriteDiagnostics ?? null,
      finalEnhancedPrompt: identifiedState.finalEnhancedPrompt ?? null,
      validationReport: identifiedState.validationReport ?? null,
      promptCaptureSource: identifiedState.promptCaptureSource ?? null,
      validationCaptureSource: identifiedState.validationCaptureSource ?? null,
      referenceMap: identifiedState.referenceMap ?? request.generationBrief?.references ?? [],
      mediaManifest: identifiedState.mediaManifest ?? request.mediaManifest ?? request.generationBrief?.mediaManifest ?? null,
      allowedReferenceLabels: identifiedState.allowedReferenceLabels ?? request.allowedReferenceLabels ?? request.generationBrief?.allowedReferenceLabels ?? null,
      physicalReferenceMap: identifiedState.physicalReferenceMap ?? [],
      timings: identifiedState.stageTimings ?? {},
      pipelineStage: identifiedState.pipelineStage ?? null,
      llmUnloadRequested: identifiedState.llmUnloadRequested ?? null,
      llmUnloadSucceeded: identifiedState.llmUnloadSucceeded ?? null,
      llmUnloadError: identifiedState.llmUnloadError ?? null,
      llmInstanceId: identifiedState.llmInstanceId ?? null,
      llmUnloadDurationMs: identifiedState.llmUnloadDurationMs ?? null,
      h3VramReleaseRequested: identifiedState.h3VramReleaseRequested,
      h3VramReleaseSucceeded: identifiedState.h3VramReleaseSucceeded,
      h3VramReleaseDurationMs: identifiedState.h3VramReleaseDurationMs,
      h3VramReleaseError: identifiedState.h3VramReleaseError,
      h3VramBeforeRelease: identifiedState.h3VramBeforeRelease,
      h3VramAfterRelease: identifiedState.h3VramAfterRelease,
      request,
      workflowSettings: request.workflowSettings,
      localSourceReferencePath: request.productReferencePath ?? request.firstFramePath ?? request.lastFramePath ?? null,
      remoteUploadedFilename: identifiedState.remoteUploadedFilename ?? identifiedState.referenceUploads[0]?.filename ?? null,
      outputMetadata: identifiedState.outputs,
      localDownloadedPath: identifiedState.localResultPath,
      status: identifiedState.status,
      state: identifiedState
    };
    this.records.set(record.localJobId, record);
    this.persistence?.upsertRemoteH3Job(record);
  }

  private findRecord(identifier: string): RemoteH3JobRecord | undefined {
    const cached = this.records.get(identifier);
    if (cached) return cached;
    const persisted = this.persistence?.listRemoteH3Jobs(200).find((item) => item.localJobId === identifier || item.remotePromptId === identifier);
    if (persisted) this.records.set(persisted.localJobId, persisted);
    return persisted;
  }

  private applyStageTiming(state: ComputeJobState): ComputeJobState {
    const localJobId = state.localJobId?.trim();
    const stage = state.pipelineStage;
    if (!localJobId || !stage) return state;
    const now = Date.now();
    const previous = this.stageTimingCursors.get(localJobId);
    const durations = { ...(previous?.durations ?? {}), ...(state.stageTimings ?? {}) };
    if (!previous) {
      this.stageTimingCursors.set(localJobId, { stage, startedAt: now, durations });
      return { ...state, stageTimings: durations };
    }
    if (previous.stage !== stage) {
      durations[previous.stage] = (durations[previous.stage] ?? 0) + Math.max(0, now - previous.startedAt);
      this.stageTimingCursors.set(localJobId, { stage, startedAt: now, durations });
      if (previous.stage === 'UNLOADING_LLM' && (state.llmUnloadDurationMs === undefined || state.llmUnloadDurationMs === null)) {
        return { ...state, llmUnloadDurationMs: durations[previous.stage], stageTimings: durations };
      }
    } else {
      this.stageTimingCursors.set(localJobId, { ...previous, durations });
    }
    return { ...state, stageTimings: durations };
  }

  private providerForCurrentSettings(modeOverride: 'local' | 'remote' | undefined = this.getSettings().computeMode): ComputeProvider {
    const settings = this.getSettings();
    if (modeOverride === 'local') return new LocalComputeProvider();
    return this.providerForUrl(settings.remoteComfyUrl, settings.remoteComfyWorkflowPath);
  }

  private providerForJob(record: RemoteH3JobRecord): RemoteComfyComputeProvider {
    return this.providerForUrl(record.state.serverUrl || this.getSettings().remoteComfyUrl, this.getSettings().remoteComfyWorkflowPath);
  }

  private providerForUrl(url: string, workflowPath = this.getSettings().remoteComfyWorkflowPath): RemoteComfyComputeProvider {
    const settings = this.getSettings();
    const normalizedUrl = normalizeComfyUrl(url);
    const roots = [...this.localReferenceRoots, settings.productAssetsDirectory, settings.referencesDirectory];
    const key = JSON.stringify([normalizedUrl, workflowPath, this.developmentMode, roots]);
    const existing = this.providerCache.get(key);
    if (existing) return existing;
    const provider = new RemoteComfyComputeProvider({
      baseUrl: normalizedUrl,
      workflowPath,
      auth: comfyAuthFromEnvironment(),
      includeSubmissionJson: this.developmentMode,
      localReferenceRoots: roots
    });
    this.providerCache.set(key, provider);
    return provider;
  }
}
