import { createHash, randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { prepareH3ComfyWorkflow, type ComfyApiWorkflow } from '../../src/domain/comfy-workflow';
import { isValidH3PromptEngineEndpoint, minimaxH3ReferenceSlotMappings, normalizeAutonomousH3PromptEngineSettings, validateMiniMaxH3ApiWorkflowTemplate, validateMiniMaxH3GenerationRequest, type H3Resolution } from '../../src/domain/minimax-h3-workflow';
import { maxLocalReferenceUploadBytes } from './reference-authorization';
import {
  h3PromptEngineModelId,
  type ComfyDownloadResult,
  type ComfyOutputFile,
  type ComfyUploadedFile,
  type ComputeJobState,
  type H3ReferenceBinding,
  type H3PromptEngineSettings,
  type H3PromptEngineStatus,
  type H3PipelineStage,
  type H3VramReleaseAudit,
  type H3VramSnapshot,
  type RemoteComfySystemInfo,
  type RemoteH3GenerationRequest
} from '../../src/domain/types';

export type ComfyAuth = { type: 'none' } | { type: 'bearer'; token: string };
export type ComfyFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ComfyWebSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  close: () => void;
}

export type ComfyWebSocketFactory = (url: string) => ComfyWebSocket;

/**
 * Trusted context supplied by ComputeService after main-process validation.
 * Renderer requests never provide this value directly.
 */
export interface TrustedReferenceAuthorization {
  productReferencePath: string;
}

export interface ComputeProvider {
  readonly mode: 'local' | 'remote';
  testConnection(): Promise<RemoteComfySystemInfo>;
  testPromptEngine(settings: H3PromptEngineSettings): Promise<H3PromptEngineStatus>;
  submitH3(request: RemoteH3GenerationRequest, onState?: (state: ComputeJobState) => void, authorization?: TrustedReferenceAuthorization): Promise<ComputeJobState>;
  getJobState(remotePromptId: string): Promise<ComputeJobState>;
  watchJob(remotePromptId: string, onState: (state: ComputeJobState) => void): () => void;
  getOutputUrl(output: ComfyOutputFile): string;
  downloadOutput(output: ComfyOutputFile, destinationDirectory: string): Promise<ComfyDownloadResult>;
  assertQueueIdle(): Promise<void>;
  releaseH3Vram(remotePromptId: string, onRequested?: () => void): Promise<H3VramReleaseAudit>;
}

export interface RemoteComfyProviderConfig {
  baseUrl: string;
  workflowPath: string;
  auth?: ComfyAuth;
  fetchImpl?: ComfyFetch;
  webSocketFactory?: ComfyWebSocketFactory;
  pollIntervalMs?: number;
  includeSubmissionJson?: boolean;
  /** Local roots accepted for client-side reference uploads. */
  localReferenceRoots?: string[];
  maxReferenceUploadBytes?: number;
}

interface ComfyPromptResponse {
  prompt_id?: unknown;
  number?: unknown;
  error?: unknown;
  node_errors?: unknown;
}

interface ComfyUploadResponse {
  name?: unknown;
  subfolder?: unknown;
  type?: unknown;
  [key: string]: unknown;
}

interface ComfyQueueResponse {
  queue_running?: unknown;
  queue_pending?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** ComfyUI 0.34.x requires the prompt ID to be canonical lowercase UUID text. */
export function isCanonicalComfyPromptId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    && value === value.toLowerCase();
}

function requireCanonicalComfyPromptId(value: unknown): string {
  if (!isCanonicalComfyPromptId(value)) throw new Error('ComfyUI did not return a canonical prompt UUID. The remote job cannot be tracked safely.');
  return value;
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  try { return JSON.stringify(reason); } catch { return 'Unknown ComfyUI error'; }
}

export type H3PromptEngineFailureStage = Extract<H3PipelineStage, 'PROMPT_GENERATION_TIMEOUT' | 'LLM_UNAVAILABLE' | 'PROMPT_GENERATION_FAILED'>;

/** Classify node 149 errors without confusing a prompt timeout with transport failure. */
export function classifyH3PromptEngineError(message: string): H3PromptEngineFailureStage {
  if (/\b(?:timed?\s*out|time\s*out|timeout|deadline\s+exceeded|client\s+disconnected|stopping\s+generation)\b/i.test(message)) {
    return 'PROMPT_GENERATION_TIMEOUT';
  }
  if (/(?:connection\s+refused|cannot\s+reach|could\s+not\s+connect|connection\s+(?:reset|failed)|network\s+unavailable|model\s+(?:is\s+)?(?:not\s+found|unavailable|not\s+loaded)|(?:no|missing)\s+(?:active\s+|suitable\s+)?(?:chat\s+|prompt\s+)?model|returned\s+HTTP\s+[45]\d{2}|endpoint)/i.test(message)) {
    return 'LLM_UNAVAILABLE';
  }
  return 'PROMPT_GENERATION_FAILED';
}

export function h3PromptEngineAudit(settings: H3PromptEngineSettings | null | undefined): Pick<ComputeJobState, 'llmModel' | 'llmModelId' | 'llmTemperature' | 'llmTimeoutSeconds' | 'llmRepairAttempts' | 'repairAttemptsConfigured' | 'llmDisableThinking'> {
  if (!settings) return {};
  const model = h3PromptEngineModelId;
  return {
    ...(model ? { llmModel: model, llmModelId: model } : {}),
    llmTemperature: settings.temperature,
    llmTimeoutSeconds: settings.timeoutSeconds,
    llmRepairAttempts: settings.repairAttempts,
    repairAttemptsConfigured: settings.repairAttempts,
    llmDisableThinking: settings.disableThinking
  };
}

export function h3PromptEngineErrorMessage(message: string, settings?: H3PromptEngineSettings | null): string {
  if (classifyH3PromptEngineError(message) !== 'PROMPT_GENERATION_TIMEOUT') return message;
  const timeoutSeconds = settings?.timeoutSeconds ?? 600;
  return `Prompt generation exceeded the configured ${timeoutSeconds}-second timeout for the rewrite and repair attempts.`;
}

function physicalReferenceMap(request: RemoteH3GenerationRequest, referenceImages: string[]): H3ReferenceBinding[] {
  return (request.generationBrief?.references ?? [])
    .filter((reference) => reference.source !== 'none')
    .map((reference, index) => ({
      ...reference,
      physicalInput: `ref_images.ref_image_${index}`,
      nodeId: minimaxH3ReferenceSlotMappings[index]?.nodeId ?? null,
      uploadedFilename: referenceImages[index] ?? null
    }));
}

function promptEngineStatus(_settings: H3PromptEngineSettings, overrides: Partial<H3PromptEngineStatus> = {}): H3PromptEngineStatus {
  const models = overrides.models ?? [];
  const targetAvailable = overrides.observedModelId === h3PromptEngineModelId || models.includes(h3PromptEngineModelId);
  const observedModelId = targetAvailable ? h3PromptEngineModelId : null;
  return {
    enhancerInstalled: false,
    validatorInstalled: false,
    requiredNodesInstalled: false,
    error: null,
    checkedAt: new Date().toISOString(),
    ...overrides,
    models: targetAvailable ? [h3PromptEngineModelId] : [],
    observedModelId,
    observedInstanceId: targetAvailable ? overrides.observedInstanceId ?? null : null,
    lmStudioConnected: Boolean(overrides.lmStudioConnected && targetAvailable),
    qwenReady: Boolean(overrides.qwenReady && targetAvailable),
    selectedModel: observedModelId
  };
}

function includesString(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.some((item) => item === expected);
}

/** Require the schema fields that make exact-instance telemetry and unload safe. */
function hasPatchedPromptEngineSchema(objectInfo: unknown): boolean {
  if (!isRecord(objectInfo)) return false;
  const enhancer = objectInfo.MiniMaxH3PromptEnhancer;
  const unload = objectInfo.MiniMaxH3UnloadLMStudioModel;
  if (!isRecord(enhancer) || !isRecord(unload)) return false;
  const unloadInputOrder = isRecord(unload.input_order) ? unload.input_order : {};
  return includesString(enhancer.output_name, 'llm_model_id')
    && includesString(enhancer.output_name, 'llm_instance_id')
    && includesString(unload.output_name, 'instance_id')
    && includesString(unload.output_name, 'unload_duration_ms')
    && includesString(unloadInputOrder.required, 'instance_id');
}

export function promptEngineModelNames(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) return [];
  return payload.models.map((model) => {
    if (typeof model === 'string') return model.trim();
    if (!isRecord(model)) return '';
    return asString(model.key) ?? asString(model.id) ?? asString(model.model_id) ?? '';
  }).filter((model): model is string => Boolean(model));
}

export interface PromptEngineDiscovery {
  models: string[];
  observedModelId: string | null;
  observedInstanceId: string | null;
  error: string | null;
}

/** Interpret only the fixed autonomous prompt model; every other model is ignored. */
export function parsePromptEngineDiscovery(payload: unknown): PromptEngineDiscovery {
  const record = isRecord(payload) ? payload : {};
  const models = promptEngineModelNames(payload);
  const explicitModel = [
    record.observed_model_id,
    record.observedModelId,
    record.model_id,
    record.modelId,
    record.selected_model,
    record.selectedModel
  ].map(asString).find((value): value is string => Boolean(value)) ?? null;
  const targetAvailable = explicitModel === h3PromptEngineModelId || models.includes(h3PromptEngineModelId);
  const observedModelId = targetAvailable ? h3PromptEngineModelId : null;
  const observedInstanceId = targetAvailable && (explicitModel === null || explicitModel === h3PromptEngineModelId) ? [
    record.observed_instance_id,
    record.observedInstanceId,
    record.instance_id,
    record.instanceId
  ].map(asString).find((value): value is string => Boolean(value)) ?? null : null;
  const routeError = asString(record.error);
  const error = routeError
    ?? (observedModelId ? null : `${h3PromptEngineModelId} is not available in LM Studio on the remote PC.`);
  return { models: targetAvailable ? [h3PromptEngineModelId] : [], observedModelId, observedInstanceId, error };
}

function isLocalFilesystemPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
}

function pathWithin(root: string, target: string): boolean {
  const relativePath = relative(resolve(root), resolve(target));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function sanitizedSegment(value: string, fallback: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function referenceMimeType(filePath: string): { extension: string; mimeType: string } {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.png') return { extension, mimeType: 'image/png' };
  if (extension === '.jpg' || extension === '.jpeg') return { extension, mimeType: 'image/jpeg' };
  if (extension === '.webp') return { extension, mimeType: 'image/webp' };
  throw new Error('Reference upload rejected: only PNG, JPEG, and WebP images are supported.');
}

function remoteReferenceFilename(product: string | undefined, filePath: string, contents: Buffer): string {
  const slug = sanitizedSegment(product ?? 'reference', 'reference');
  const hash = createHash('sha256').update(contents).digest('hex').slice(0, 16);
  return `PROYA_H3_REF_${slug}_${hash}${referenceMimeType(filePath).extension}`;
}

function combineComfyFilename(name: string, subfolder: string): string {
  return subfolder ? `${subfolder.replace(/^[/\\]+|[/\\]+$/g, '')}/${name}` : name;
}

export function normalizeComfyUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('ComfyUI URL must use HTTP or HTTPS');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch (reason) {
    throw new Error(reason instanceof Error ? reason.message : 'ComfyUI URL is invalid', { cause: reason });
  }
}

function endpointFor(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}/${path.replace(/^\/+/, '')}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function websocketEndpointFor(baseUrl: string, clientId: string): string {
  const url = new URL(endpointFor(baseUrl, 'ws'));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = new URLSearchParams({ clientId }).toString();
  return url.toString();
}

function authHeaders(auth: ComfyAuth): Record<string, string> {
  return auth.type === 'bearer' ? { Authorization: `Bearer ${auth.token}` } : {};
}

function outputKind(key: string): string {
  const lower = key.toLowerCase();
  if (lower.includes('video') || lower.includes('gif')) return 'video';
  if (lower.includes('audio')) return 'audio';
  if (lower.includes('image')) return 'image';
  return key || 'file';
}

function outputKindForCandidate(key: string, filename: string): string {
  const lower = key.toLowerCase();
  if (lower.includes('video') || lower.includes('gif') || /\.(mp4|webm|mov|mkv|avi|gif)$/i.test(filename)) return 'video';
  return outputKind(key);
}

function createOutputUrl(baseUrl: string, output: Pick<ComfyOutputFile, 'filename' | 'subfolder' | 'type'>): string {
  const url = new URL(endpointFor(baseUrl, 'view'));
  url.search = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder, type: output.type }).toString();
  return url.toString();
}

export function extractComfyOutputs(baseUrl: string, outputs: unknown): ComfyOutputFile[] {
  if (!isRecord(outputs)) return [];
  const found: ComfyOutputFile[] = [];
  const seen = new Set<string>();
  for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
    if (!isRecord(nodeOutput)) continue;
    for (const [key, value] of Object.entries(nodeOutput)) {
      const candidates = Array.isArray(value) ? value : [value];
      for (const candidate of candidates) {
        if (!isRecord(candidate)) continue;
        const filename = asString(candidate.filename) ?? asString(candidate.name);
        if (!filename) continue;
        const output = {
          nodeId,
          kind: outputKindForCandidate(key, filename),
          filename,
          subfolder: asString(candidate.subfolder) ?? '',
          type: asString(candidate.type) ?? 'output',
          url: ''
        };
        output.url = createOutputUrl(baseUrl, output);
        const identity = `${output.nodeId}:${output.kind}:${output.filename}:${output.subfolder}:${output.type}`;
        if (!seen.has(identity)) {
          seen.add(identity);
          found.push(output);
        }
      }
    }
  }
  return found;
}

/** Returns the generated video descriptors, preferring the configured SaveVideo node. */
export function findComfyVideoOutputs(outputs: ComfyOutputFile[], preferredNodeId = '92'): ComfyOutputFile[] {
  const videos = outputs.filter((output) => output.kind === 'video');
  const preferred = videos.filter((output) => output.nodeId === preferredNodeId);
  return preferred.length > 0 ? preferred : videos;
}

function queueItemPromptId(item: unknown): string | null {
  if (Array.isArray(item)) return asString(item[1]);
  if (isRecord(item)) return asString(item.prompt_id);
  return null;
}

function queueItemNumber(item: unknown): number | null {
  if (Array.isArray(item)) return asNumber(item[0]);
  if (isRecord(item)) return asNumber(item.number);
  return null;
}

function findHistoryEntry(payload: unknown, remotePromptId: string): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  const direct = payload[remotePromptId];
  if (isRecord(direct)) return direct;
  if (Array.isArray(payload.history)) {
    const entry = payload.history.find((item) => isRecord(item) && item.prompt_id === remotePromptId);
    return isRecord(entry) ? entry : null;
  }
  return payload.prompt_id === remotePromptId ? payload : null;
}

function historyError(entry: Record<string, unknown>): string | null {
  const executionError = entry.execution_error;
  if (typeof executionError === 'string' && executionError.trim()) return executionError.trim();
  if (isRecord(executionError)) {
    const message = asString(executionError.exception_message) ?? asString(executionError.message);
    if (message) return message;
  }
  const status = entry.status;
  const statusRecord = isRecord(status) ? status : null;
  const statusText = (asString(statusRecord?.status_str) ?? (typeof status === 'string' ? status : '')).toLowerCase();
  if (Array.isArray(statusRecord?.messages)) {
    for (const message of statusRecord.messages) {
      if (!Array.isArray(message)) continue;
      const detail = isRecord(message[1]) ? message[1] : null;
      const text = asString(detail?.exception_message) ?? asString(detail?.message);
      if (text && String(message[0]).toLowerCase().includes('error')) return text;
    }
  }
  if (statusText.includes('error') || statusText.includes('fail') || statusText.includes('interrupt') || statusText.includes('cancel')) return statusText;
  return null;
}

function historyStatus(entry: Record<string, unknown>): { status: ComputeJobState['status']; progress: number | null; queueRemaining: number | null } {
  const status = entry.status;
  const statusRecord = isRecord(status) ? status : null;
  const statusText = (asString(statusRecord?.status_str) ?? (typeof status === 'string' ? status : '')).toLowerCase();
  const execInfo = isRecord(statusRecord?.exec_info) ? statusRecord.exec_info : null;
  const queueRemaining = asNumber(execInfo?.queue_remaining);
  // Intermediate node outputs (including SaveVideo) are not execution completion.
  const completed = statusRecord?.completed === true || ['success', 'complete', 'completed'].includes(statusText);
  if (completed) return { status: 'completed', progress: 1, queueRemaining };
  if (statusText.includes('running') || statusText.includes('executing') || entry.execution_start_time !== undefined) return { status: 'running', progress: null, queueRemaining };
  return { status: 'queued', progress: null, queueRemaining };
}

export function parseComfySystemStats(payload: unknown, url: string, latencyMs: number): RemoteComfySystemInfo {
  if (!isRecord(payload)) throw new Error('ComfyUI system stats did not return a JSON object');
  const root = payload;
  const system = isRecord(root.system) ? root.system : {};
  const cuda = isRecord(root.cuda) ? root.cuda : {};
  const devices = Array.isArray(root.devices) && isRecord(root.devices[0]) ? root.devices[0] : {};
  const comfyVersion = asString(system.comfyui_version) ?? asString(root.comfyui_version) ?? asString(root.version);
  const gpuName = asString(devices.name) ?? asString(cuda.gpu) ?? asString(cuda.name) ?? asString(root.gpu);
  const vramTotalBytes = asNumber(devices.vram_total) ?? asNumber(cuda.vram_total) ?? asNumber(root.vram_total);
  const vramFreeBytes = asNumber(devices.vram_free) ?? asNumber(cuda.vram_free) ?? asNumber(root.vram_free);
  return { connected: true, url, comfyVersion, gpuName, vramTotalBytes, vramFreeBytes, latencyMs };
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveWait) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolveWait(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function statusRank(status: ComputeJobState['status']): number {
  return { preparing: 0, uploading_reference: 0, submitted: 0, queued: 1, running: 2, completed: 3, failed: 3, error: 3 }[status];
}

function pipelineStageForNode(nodeId: string | null): H3PipelineStage | undefined {
  if (nodeId === '149') return 'WRITING_PROMPT';
  if (nodeId === '150' || nodeId === '151') return 'VALIDATING_PROMPT';
  if (nodeId === '152') return 'UNLOADING_LLM';
  if (nodeId === '136' || nodeId === '125' || nodeId === '127' || nodeId === '128' || nodeId === '129' || nodeId === '130' || nodeId === '131' || nodeId === '92') return 'GENERATING_H3';
  return undefined;
}

function firstString(value: unknown, preferredKeys: string[] = []): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, preferredKeys);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of preferredKeys) {
    const found = firstString(value[key], preferredKeys);
    if (found) return found;
  }
  for (const item of Object.values(value)) {
    const found = firstString(item, preferredKeys);
    if (found) return found;
  }
  return null;
}

function repairAttemptsFromOutput(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = repairAttemptsFromOutput(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value === 'string') {
    try { return repairAttemptsFromOutput(JSON.parse(value) as unknown); } catch { return null; }
  }
  if (!isRecord(value)) return null;
  for (const key of ['repairAttemptsUsed', 'repair_attempts_used']) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  for (const key of ['manifest', 'enhancement_manifest', 'enhancementManifest']) {
    const found = repairAttemptsFromOutput(value[key]);
    if (found !== null) return found;
  }
  for (const item of Object.values(value)) {
    const found = repairAttemptsFromOutput(item);
    if (found !== null) return found;
  }
  return null;
}

function outputSlot(value: unknown, slot: number): unknown {
  if (Array.isArray(value)) return value[slot];
  if (!isRecord(value)) return undefined;
  for (const key of ['result', 'output']) {
    const result = value[key];
    if (Array.isArray(result)) return result[slot];
  }
  return undefined;
}

function textSlot(value: unknown, slot: number): unknown {
  if (Array.isArray(value)) return value[slot];
  if (!isRecord(value) || !Array.isArray(value.text)) return undefined;
  return value.text[slot];
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function serializedOutput(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value === null || value === undefined) return null;
  try { return JSON.stringify(value); } catch { return null; }
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseJsonRecord(item);
      if (parsed) return parsed;
    }
    return null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Read the explicit UI payload emitted by the patched ComfyUI nodes. */
function structuredOutput(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  for (const key of ['proya_h3_structured_output', 'h3_structured_output', 'structured_output']) {
    const parsed = parseJsonRecord(value[key]);
    if (parsed) return parsed;
  }
  if (['enhanced_prompt', 'enhancement_manifest', 'repair_attempts_used', 'prompt', 'valid', 'validation_report', 'unload_succeeded', 'instance_id', 'llm_instance_id'].some((key) => key in value)) return value;
  const ui = value.ui;
  return isRecord(ui) ? structuredOutput(ui) : null;
}

export function executionMetadata(outputs: unknown): Partial<ComputeJobState> {
  if (!isRecord(outputs)) return {};
  const enhancerOutput = outputs['149'];
  const validatorOutput = outputs['150'];
  const unloadOutput = outputs['152'];
  const enhancerStructured = structuredOutput(enhancerOutput);
  const validatorStructured = structuredOutput(validatorOutput);
  const unloadStructured = structuredOutput(unloadOutput);
  const structuredPrompt = asString(enhancerStructured?.enhanced_prompt)
    ?? asString(enhancerStructured?.enhancedPrompt)
    ?? asString(validatorStructured?.prompt);
  const fallbackPrompt = asString(outputSlot(enhancerOutput, 0))
    ?? asString(outputSlot(validatorOutput, 0))
    ?? asString(textSlot(validatorOutput, 0));
  const finalEnhancedPrompt = structuredPrompt ?? fallbackPrompt;
  const structuredValidationReport = serializedOutput(validatorStructured?.validation_report)
    ?? serializedOutput(validatorStructured?.validationReport);
  const fallbackValidationReport = asString(outputSlot(validatorOutput, 2))
    ?? asString(textSlot(validatorOutput, 1));
  const validationReport = structuredValidationReport ?? fallbackValidationReport;
  const structuredRepairAttempts = repairAttemptsFromOutput(enhancerStructured);
  const fallbackRepairAttempts = repairAttemptsFromOutput(enhancerOutput);
  const repairAttemptsUsed = structuredRepairAttempts
    ?? fallbackRepairAttempts
    ?? (enhancerOutput !== undefined ? 0 : null);
  const enhancementManifest = serializedOutput(enhancerStructured?.enhancement_manifest)
    ?? serializedOutput(enhancerStructured?.enhancementManifest);
  const manifestRecord = parseJsonRecord(enhancerStructured?.enhancement_manifest)
    ?? parseJsonRecord(enhancerStructured?.enhancementManifest)
    ?? parseJsonRecord(outputSlot(enhancerOutput, 2));
  const reportedModelId = asString(enhancerStructured?.model_id)
    ?? asString(enhancerStructured?.llm_model_id)
    ?? asString(enhancerStructured?.observed_model_id)
    ?? asString(enhancerStructured?.modelId)
    ?? asString(manifestRecord?.model_id)
    ?? asString(manifestRecord?.modelId)
    ?? asString(outputSlot(enhancerOutput, 8));
  const observedModelId = reportedModelId === h3PromptEngineModelId ? h3PromptEngineModelId : null;
  const observedInstanceId = reportedModelId && reportedModelId !== h3PromptEngineModelId ? null : asString(enhancerStructured?.model_instance_id)
    ?? asString(enhancerStructured?.llm_instance_id)
    ?? asString(enhancerStructured?.observed_instance_id)
    ?? asString(enhancerStructured?.instance_id)
    ?? asString(enhancerStructured?.modelInstanceId)
    ?? asString(manifestRecord?.model_instance_id)
    ?? asString(manifestRecord?.modelInstanceId)
    ?? asString(outputSlot(enhancerOutput, 9));
  const rewriteDiagnostics = serializedOutput(enhancerStructured?.rewrite_diagnostics)
    ?? serializedOutput(enhancerStructured?.rewriteDiagnostics);
  const structuredUnloadSucceeded = outputBoolean(unloadStructured?.unload_succeeded, ['unload_succeeded', 'unloaded', 'success'])
    ?? outputBoolean(unloadStructured?.unloadSucceeded, ['unload_succeeded', 'unloaded', 'success']);
  const fallbackUnloadSucceeded = outputBoolean(outputSlot(unloadOutput, 3), ['unload_succeeded', 'unloaded', 'success']);
  const unloadSucceeded = unloadStructured ? structuredUnloadSucceeded : fallbackUnloadSucceeded;
  const unloadError = unloadStructured
    ? asString(unloadStructured.unload_error) ?? asString(unloadStructured.unloadError)
    : asString(outputSlot(unloadOutput, 4));
  const unloadInstanceId = unloadStructured
    ? asString(unloadStructured.instance_id) ?? asString(unloadStructured.llm_instance_id) ?? asString(unloadStructured.instanceId)
    : asString(outputSlot(unloadOutput, 5));
  const llmInstanceId = unloadInstanceId ?? observedInstanceId;
  const llmUnloadDurationMs = unloadStructured
    ? finiteNumber(unloadStructured.unload_duration_ms) ?? finiteNumber(unloadStructured.llm_unload_duration_ms)
    : finiteNumber(outputSlot(unloadOutput, 6));
  return {
    ...(finalEnhancedPrompt ? { finalEnhancedPrompt } : {}),
    ...(validationReport ? { validationReport } : {}),
    ...(repairAttemptsUsed !== null ? { repairAttemptsUsed } : {}),
    ...(enhancementManifest ? { enhancementManifest } : {}),
    ...(observedModelId === h3PromptEngineModelId ? { lmStudioModelId: h3PromptEngineModelId, llmModelId: h3PromptEngineModelId, llmModel: h3PromptEngineModelId } : {}),
    ...(rewriteDiagnostics ? { rewriteDiagnostics } : {}),
    ...(finalEnhancedPrompt ? { promptCaptureSource: structuredPrompt ? 'structured' as const : 'fallback_raw_history' as const } : {}),
    ...(validationReport ? { validationCaptureSource: structuredValidationReport ? 'structured' as const : 'fallback_raw_history' as const } : {}),
    ...(unloadSucceeded !== null ? { llmUnloadSucceeded: unloadSucceeded, llmUnloadError: unloadError } : {}),
    ...(llmInstanceId ? { llmInstanceId } : {}),
    ...(llmUnloadDurationMs !== null ? { llmUnloadDurationMs } : {})
  };
}

function outputBoolean(value: unknown, preferredKeys: string[] = []): boolean | null {
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = outputBoolean(item, preferredKeys);
      if (found !== null) return found;
    }
  }
  if (isRecord(value)) {
    for (const key of preferredKeys) {
      const found = outputBoolean(value[key], preferredKeys);
      if (found !== null) return found;
    }
    for (const item of Object.values(value)) {
      const found = outputBoolean(item, preferredKeys);
      if (found !== null) return found;
    }
  }
  return null;
}

export class LocalComputeProvider implements ComputeProvider {
  readonly mode = 'local' as const;

  async testConnection(): Promise<RemoteComfySystemInfo> {
    return { connected: false, url: '', comfyVersion: null, gpuName: null, vramTotalBytes: null, vramFreeBytes: null, latencyMs: null, error: 'Local mode does not use a remote ComfyUI server.' };
  }

  async testPromptEngine(settings: H3PromptEngineSettings): Promise<H3PromptEngineStatus> {
    return promptEngineStatus(settings, { error: 'Local compute is not an H3 prompt-engine provider.' });
  }

  async submitH3(): Promise<ComputeJobState> {
    throw new Error('Local mode is not used for autonomous H3 generation; use the remote ComfyUI execution plane.');
  }

  async getJobState(): Promise<ComputeJobState> {
    throw new Error('Local mode has no remote ComfyUI jobs.');
  }

  watchJob(): () => void {
    return () => undefined;
  }

  getOutputUrl(): string {
    throw new Error('Local mode has no remote output URL.');
  }

  async downloadOutput(): Promise<ComfyDownloadResult> {
    throw new Error('Local mode has no remote output to download.');
  }

  async assertQueueIdle(): Promise<void> { throw new Error('Local mode has no ComfyUI queue.'); }
  async releaseH3Vram(): Promise<H3VramReleaseAudit> { throw new Error('Local mode has no H3 GPU.'); }
}

export class RemoteComfyComputeProvider implements ComputeProvider {
  readonly mode = 'remote' as const;
  private readonly baseUrl: string;
  private readonly workflowPath: string;
  private readonly auth: ComfyAuth;
  private readonly fetchImpl: ComfyFetch;
  private readonly webSocketFactory: ComfyWebSocketFactory | null;
  private readonly pollIntervalMs: number;
  private readonly includeSubmissionJson: boolean;
  private readonly localReferenceRoots: string[];
  private readonly maxReferenceUploadBytes: number;
  private readonly clientIds = new Map<string, string>();
  private readonly promptEngineByPromptId = new Map<string, H3PromptEngineSettings>();
  private readonly uploadCache = new Map<string, ComfyUploadedFile>();
  private readonly inFlightUploads = new Map<string, Promise<ComfyUploadedFile>>();

  constructor(config: RemoteComfyProviderConfig) {
    this.baseUrl = normalizeComfyUrl(config.baseUrl);
    this.workflowPath = config.workflowPath;
    this.auth = config.auth ?? { type: 'none' };
    if (this.auth.type === 'bearer' && !this.auth.token.trim()) throw new Error('ComfyUI bearer token cannot be empty');
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.webSocketFactory = config.webSocketFactory ?? (typeof globalThis.WebSocket === 'function' ? (url) => {
      const WebSocketConstructor = globalThis.WebSocket;
      return new WebSocketConstructor(url) as unknown as ComfyWebSocket;
    } : null);
    this.pollIntervalMs = Math.max(250, config.pollIntervalMs ?? 1000);
    this.includeSubmissionJson = config.includeSubmissionJson ?? false;
    this.localReferenceRoots = (config.localReferenceRoots ?? []).filter((root) => root.trim()).map((root) => resolve(root));
    const configuredMax = config.maxReferenceUploadBytes;
    this.maxReferenceUploadBytes = configuredMax !== undefined && Number.isFinite(configuredMax) && configuredMax > 0
      ? configuredMax
      : maxLocalReferenceUploadBytes;
  }

  async testConnection(): Promise<RemoteComfySystemInfo> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const payload = await this.requestJson('/system_stats', { signal: controller.signal });
      return parseComfySystemStats(payload, this.baseUrl, Date.now() - startedAt);
    } finally {
      clearTimeout(timeout);
    }
  }

  async testPromptEngine(settings: H3PromptEngineSettings): Promise<H3PromptEngineStatus> {
    const status = promptEngineStatus(settings);
    if (!isValidH3PromptEngineEndpoint(settings.endpoint)) {
      return { ...status, error: 'H3 Prompt Engine endpoint must be http://127.0.0.1:1234/v1 on the execution PC.' };
    }
    let objectInfo: unknown;
    try {
      objectInfo = await this.requestJson('/object_info');
    } catch (reason) {
      return { ...status, error: `Could not inspect ComfyUI custom nodes: ${errorMessage(reason)}` };
    }
    const classes = isRecord(objectInfo) ? Object.keys(objectInfo) : [];
    const enhancerInstalled = classes.includes('MiniMaxH3PromptEnhancer');
    const validatorInstalled = classes.includes('MiniMaxH3PromptValidator');
    const missingPatchedNodes = ['MiniMaxH3PromptEnhancer', 'MiniMaxH3PromptValidator', 'MiniMaxH3PromptValidityGate', 'MiniMaxH3UnloadLMStudioModel']
      .filter((classType) => !classes.includes(classType));
    if (missingPatchedNodes.length > 0) {
      return { ...status, enhancerInstalled, validatorInstalled, requiredNodesInstalled: false, error: `Install ComfyUI-MiniMax-H3-Prompt-Enhancer and apply the Proya autonomous-H3 patch on the execution PC. Missing: ${missingPatchedNodes.join(', ')}` };
    }
    if (!hasPatchedPromptEngineSchema(objectInfo)) {
      return { ...status, enhancerInstalled, validatorInstalled, requiredNodesInstalled: false, error: 'The remote H3 prompt nodes are installed with a stale schema. Apply the latest pinned Proya autonomous-H3 patch and restart ComfyUI before generating.' };
    }
    try {
      const modelsPayload = await this.requestJson('/minimax_h3_prompt_enhancer/models', {
        method: 'POST',
        body: JSON.stringify({ endpoint: settings.endpoint, api_key: '', allow_remote_endpoint: false })
      });
      const discovery = parsePromptEngineDiscovery(modelsPayload);
      return {
        ...status,
        enhancerInstalled,
        validatorInstalled,
        requiredNodesInstalled: true,
        lmStudioConnected: Boolean(discovery.observedModelId) && !discovery.error,
        models: discovery.models,
        observedModelId: discovery.observedModelId,
        observedInstanceId: discovery.observedInstanceId,
        selectedModel: discovery.observedModelId,
        qwenReady: Boolean(discovery.observedModelId) && !discovery.error,
        error: discovery.error
      };
    } catch (reason) {
      return { ...status, enhancerInstalled, validatorInstalled, requiredNodesInstalled: true, error: `LM Studio discovery through ComfyUI failed: ${errorMessage(reason)}` };
    }
  }

  async submitH3(request: RemoteH3GenerationRequest, onState?: (state: ComputeJobState) => void, authorization?: TrustedReferenceAuthorization): Promise<ComputeJobState> {
    const localJobId = request.localJobId?.trim() || request.clientJobId?.trim() || null;
    let effectivePromptEngine = request.promptEngine
      ? normalizeAutonomousH3PromptEngineSettings(request.promptEngine)
      : null;
    let referenceUploads: ComfyUploadedFile[] = [];
    let stage: H3PipelineStage = 'PREPARING';
    const publish = (status: ComputeJobState['status'], overrides: Partial<ComputeJobState> = {}) => {
      onState?.(this.makeState(localJobId, null, status, { ...h3PromptEngineAudit(effectivePromptEngine), referenceUploads, ...overrides }));
    };
    try {
      if (!this.workflowPath.trim()) throw new Error('Set an H3 API workflow file in Settings → Remote compute before submitting.');
      const resolution = validateMiniMaxH3GenerationRequest(request);
      const template = this.loadWorkflowTemplate(this.workflowPath);
      publish('preparing', { pipelineStage: 'PREPARING' });
      await this.testConnection();

      let effectiveRequest: RemoteH3GenerationRequest = request.promptEngine
        ? { ...request, promptEngine: effectivePromptEngine ?? undefined }
        : request;
      if (request.generationBrief) {
        if (!request.promptEngine) throw new Error('H3 Prompt Engine settings are missing.');
        const autonomousPromptEngine = normalizeAutonomousH3PromptEngineSettings(request.promptEngine);
        const promptEngine = await this.testPromptEngine(autonomousPromptEngine);
        if (!promptEngine.requiredNodesInstalled || !promptEngine.enhancerInstalled || !promptEngine.validatorInstalled) {
          stage = 'PROMPT_GENERATION_FAILED';
          throw new Error(promptEngine.error ?? 'The remote H3 prompt enhancer and validator are not installed.');
        }
        if (!promptEngine.lmStudioConnected) {
          stage = 'LLM_UNAVAILABLE';
          throw new Error(promptEngine.error ?? 'The remote LM Studio Prompt Engine is not reachable.');
        }
        if (!promptEngine.observedModelId) {
          stage = 'LLM_UNAVAILABLE';
          throw new Error(promptEngine.error ?? `${h3PromptEngineModelId} is not available in LM Studio on the remote PC.`);
        }
        if (!promptEngine.qwenReady) {
          stage = 'LLM_UNAVAILABLE';
          throw new Error(promptEngine.error ?? 'The remote LM Studio Prompt Engine did not return a usable Qwen model.');
        }
        // Pass the fixed model to node 149; the remote node captures the exact
        // instance used after normal LM Studio JIT/autoload resolution.
        effectiveRequest = { ...request, promptEngine: autonomousPromptEngine };
        effectivePromptEngine = effectiveRequest.promptEngine ?? null;
      }

      stage = 'UPLOADING_REFERENCES';
      const remoteReferences = await this.prepareRemoteReferences(effectiveRequest, (status, overrides) => {
        publish(status, { pipelineStage: status === 'uploading_reference' ? 'UPLOADING_REFERENCES' : overrides?.pipelineStage, ...overrides });
      }, authorization);
      referenceUploads = remoteReferences.uploads;
      const referenceBindings = physicalReferenceMap(effectiveRequest, remoteReferences.referenceImages);
      stage = request.generationBrief ? 'WRITING_PROMPT' : 'PREPARING';
      publish('preparing', {
        pipelineStage: request.generationBrief ? 'WRITING_PROMPT' : 'PREPARING',
        referenceUploads,
        remoteUploadedFilename: referenceUploads[0]?.filename ?? null,
        generationBrief: effectiveRequest.generationBrief ?? null,
        referenceMap: effectiveRequest.generationBrief?.references ?? [],
        mediaManifest: effectiveRequest.mediaManifest ?? effectiveRequest.generationBrief?.mediaManifest ?? null,
        allowedReferenceLabels: effectiveRequest.allowedReferenceLabels ?? effectiveRequest.generationBrief?.allowedReferenceLabels ?? null,
        physicalReferenceMap: referenceBindings,
        promptEngine: effectiveRequest.promptEngine ?? null,
        ...h3PromptEngineAudit(effectiveRequest.promptEngine),
        lmStudioModelId: effectiveRequest.promptEngine?.model.trim() || null,
        temperature: effectiveRequest.promptEngine?.temperature ?? null,
        llmUnloadRequested: effectiveRequest.promptEngine?.unloadModelBeforeH3 ?? false
      });
      stage = 'H3_QUEUE_FAILED';
      const workflow = this.prepareWorkflow(template, effectiveRequest, resolution, remoteReferences);
      const clientId = randomUUID();
      const submission = { prompt: workflow, client_id: clientId };
      const submissionJson = JSON.stringify(submission, null, 2);
      const payload = await this.requestJson<ComfyPromptResponse>('/prompt', {
        method: 'POST',
        body: submissionJson
      });
      const responseError = payload.error;
      const nodeErrors = payload.node_errors;
      if (responseError !== undefined && responseError !== null) throw new Error(`ComfyUI rejected the workflow: ${errorMessage(responseError)}`);
      if ((Array.isArray(nodeErrors) && nodeErrors.length > 0) || (isRecord(nodeErrors) && Object.keys(nodeErrors).length > 0)) {
        throw new Error(`ComfyUI rejected one or more nodes: ${errorMessage(nodeErrors)}`);
      }
      const remotePromptId = requireCanonicalComfyPromptId(payload.prompt_id);
      this.clientIds.set(remotePromptId, clientId);
      if (effectiveRequest.promptEngine) this.promptEngineByPromptId.set(remotePromptId, effectiveRequest.promptEngine);
      const queuePosition = asNumber(payload.number);
      const state = this.makeState(localJobId, remotePromptId, queuePosition !== null && queuePosition <= 0 ? 'running' : 'queued', {
        queuePosition,
        pipelineStage: 'QUEUED_H3',
        referenceUploads,
        remoteUploadedFilename: referenceUploads[0]?.filename ?? null,
        generationBrief: effectiveRequest.generationBrief ?? null,
        referenceMap: effectiveRequest.generationBrief?.references ?? [],
        mediaManifest: effectiveRequest.mediaManifest ?? effectiveRequest.generationBrief?.mediaManifest ?? null,
        allowedReferenceLabels: effectiveRequest.allowedReferenceLabels ?? effectiveRequest.generationBrief?.allowedReferenceLabels ?? null,
        physicalReferenceMap: referenceBindings,
        promptEngine: effectiveRequest.promptEngine ?? null,
        ...h3PromptEngineAudit(effectiveRequest.promptEngine),
        lmStudioModelId: effectiveRequest.promptEngine?.model.trim() || null,
        temperature: effectiveRequest.promptEngine?.temperature ?? null,
        llmUnloadRequested: effectiveRequest.promptEngine?.unloadModelBeforeH3 ?? false,
        submissionJson: this.includeSubmissionJson ? submissionJson : undefined
      });
      onState?.(state);
      return state;
    } catch (reason) {
      const promptFailureStage = stage === 'WRITING_PROMPT' ? classifyH3PromptEngineError(errorMessage(reason)) : null;
      const failureStage: H3PipelineStage = stage === 'UPLOADING_REFERENCES'
        ? 'REFERENCE_UPLOAD_FAILED'
        : stage === 'WRITING_PROMPT' ? promptFailureStage ?? 'PROMPT_GENERATION_FAILED'
          : stage === 'LLM_UNAVAILABLE' ? 'LLM_UNAVAILABLE'
            : stage === 'PROMPT_GENERATION_FAILED' ? 'PROMPT_GENERATION_FAILED'
              : 'H3_QUEUE_FAILED';
      publish('failed', { pipelineStage: failureStage, failureStage, error: h3PromptEngineErrorMessage(errorMessage(reason), effectivePromptEngine), referenceUploads, remoteUploadedFilename: referenceUploads[0]?.filename ?? null });
      throw reason;
    }
  }

  async getJobState(remotePromptId: string): Promise<ComputeJobState> {
    requireCanonicalComfyPromptId(remotePromptId);
    const historyPayload = await this.requestJson(`/history/${encodeURIComponent(remotePromptId)}`);
    const entry = findHistoryEntry(historyPayload, remotePromptId);
    if (entry) {
      const error = historyError(entry);
      const outputs = extractComfyOutputs(this.baseUrl, entry.outputs);
      const parsedStatus = historyStatus(entry);
      const promptEngine = this.promptEngineByPromptId.get(remotePromptId);
      const classifiedError = error ? classifyH3PromptEngineError(error) : null;
      const promptFailure = classifiedError && classifiedError !== 'PROMPT_GENERATION_FAILED' ? classifiedError : null;
      return this.makeState(null, remotePromptId, error ? 'failed' : parsedStatus.status, {
        progress: error ? null : parsedStatus.progress,
        queueRemaining: parsedStatus.queueRemaining,
        outputs,
        ...executionMetadata(entry.outputs),
        promptEngine: promptEngine ?? null,
        ...h3PromptEngineAudit(promptEngine),
        ...(promptFailure ? { pipelineStage: promptFailure, failureStage: promptFailure } : {}),
        error: error ? h3PromptEngineErrorMessage(error, promptEngine) : null
      });
    }

    const queue = await this.getQueue();
    const running = Array.isArray(queue.queue_running) ? queue.queue_running : [];
    const pending = Array.isArray(queue.queue_pending) ? queue.queue_pending : [];
    const runningItem = running.find((item) => queueItemPromptId(item) === remotePromptId);
    if (runningItem !== undefined) return this.makeState(null, remotePromptId, 'running', { promptEngine: this.promptEngineByPromptId.get(remotePromptId) ?? null, ...h3PromptEngineAudit(this.promptEngineByPromptId.get(remotePromptId)), queuePosition: queueItemNumber(runningItem) });
    const pendingIndex = pending.findIndex((item) => queueItemPromptId(item) === remotePromptId);
    if (pendingIndex >= 0) return this.makeState(null, remotePromptId, 'queued', { promptEngine: this.promptEngineByPromptId.get(remotePromptId) ?? null, ...h3PromptEngineAudit(this.promptEngineByPromptId.get(remotePromptId)), queuePosition: queueItemNumber(pending[pendingIndex]) ?? pendingIndex + 1 });
    return this.makeState(null, remotePromptId, 'submitted', { promptEngine: this.promptEngineByPromptId.get(remotePromptId) ?? null, ...h3PromptEngineAudit(this.promptEngineByPromptId.get(remotePromptId)) });
  }

  async getQueue(): Promise<ComfyQueueResponse> {
    return this.requestJson<ComfyQueueResponse>('/queue');
  }

  async assertQueueIdle(): Promise<void> {
    if (!await this.isQueueIdle(AbortSignal.timeout(5000))) {
      throw new Error('ComfyUI is still executing or has pending jobs. Wait for H3 and its VRAM release before starting Qwen.');
    }
  }

  private async isQueueIdle(signal: AbortSignal): Promise<boolean> {
    const queue = await this.requestJson<ComfyQueueResponse>('/queue', { signal });
    if (!queue || !Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) {
      throw new Error('Cannot verify ComfyUI queue state; expected running and pending arrays.');
    }
    return queue.queue_running.length === 0 && queue.queue_pending.length === 0;
  }

  /** /free only acknowledges executor flags. Keep the GPU handoff open until idle cleanup settles. */
  async releaseH3Vram(remotePromptId: string, onRequested?: () => void): Promise<H3VramReleaseAudit> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let requested = false;
    let before: H3VramSnapshot | null = null;
    let after: H3VramSnapshot | null = null;
    const result = (succeeded: boolean | null, error: string | null): H3VramReleaseAudit => ({
      h3VramReleaseRequested: requested, h3VramReleaseSucceeded: succeeded,
      h3VramReleaseDurationMs: Date.now() - startedAt, h3VramReleaseError: error,
      h3VramBeforeRelease: before, h3VramAfterRelease: after
    });
    const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]);
    const snapshot = async (): Promise<H3VramSnapshot | null> => {
      try {
        const payload = await this.requestJson('/system_stats', { signal: signal() });
        if (!isRecord(payload) || !Array.isArray(payload.devices)) return null;
        const devices = payload.devices.filter(isRecord).map((device) => ({
          name: asString(device.name), type: asString(device.type),
          vramTotalBytes: asNumber(device.vram_total), vramFreeBytes: asNumber(device.vram_free),
          torchReservedBytes: asNumber(device.torch_vram_total)
        }));
        return { capturedAt: new Date().toISOString(), devices };
      } catch { return null; }
    };
    try {
      requireCanonicalComfyPromptId(remotePromptId);
      const history = await this.requestJson(`/history/${remotePromptId}`, { signal: signal() });
      const entry = findHistoryEntry(history, remotePromptId);
      if (!entry || (historyStatus(entry).status !== 'completed' && !historyError(entry))) {
        return result(false, 'H3 execution has not finished in ComfyUI history; VRAM release was not requested.');
      }
      // Never set unload flags while any job is running or waiting to render.
      const idleDeadline = Date.now() + 3000;
      while (!await this.isQueueIdle(signal())) {
        if (Date.now() >= idleDeadline) return result(false, 'ComfyUI queue is busy; H3 VRAM release was not requested.');
        await wait(250, controller.signal);
      }
      before = await snapshot();
      // Telemetry may take time: recheck immediately before the mutation.
      if (!await this.isQueueIdle(signal())) return result(false, 'ComfyUI queue became busy; H3 VRAM release was not requested.');
      requested = true;
      onRequested?.();
      await this.requestJson('/free', { method: 'POST', body: JSON.stringify({ unload_models: true, free_memory: true }), signal: signal() });
      const releaseDeadline = Math.min(startedAt + 19_000, Date.now() + 15_000);
      let consecutiveReleased = 0;
      let measuredRetained = false;
      while (Date.now() < releaseDeadline && !controller.signal.aborted) {
        await wait(1000, controller.signal);
        if (!await this.isQueueIdle(signal())) return result(false, 'ComfyUI became busy during the H3 VRAM handoff; release could not be verified.');
        after = await snapshot();
        const gpuDevices = after?.devices.filter((device) => device.type !== null && device.type !== 'cpu') ?? [];
        const measurable = gpuDevices.length > 0 && gpuDevices.every((device) => device.torchReservedBytes !== null && device.torchReservedBytes >= 0
          && device.vramTotalBytes !== null && device.vramTotalBytes > 0 && device.vramFreeBytes !== null && device.vramFreeBytes >= 0 && device.vramFreeBytes <= device.vramTotalBytes);
        // vram_free alone includes reusable Torch cache on some ComfyUI versions.
        // Require small process reservations on every reported GPU, not just a rise in free VRAM.
        // cudaMallocAsync/other processes can occupy the device without appearing
        // in Torch reservations. Also require device headroom, allowing OS/display
        // overhead of 2 GiB or 10% of capacity. This does not tune Qwen offload.
        const released = measurable && gpuDevices.every((device) => device.torchReservedBytes! <= 256 * 1024 * 1024
          && device.vramTotalBytes! - device.vramFreeBytes! <= Math.max(2 * 1024 ** 3, device.vramTotalBytes! * 0.1));
        const knownOccupied = gpuDevices.some((device) => (device.torchReservedBytes ?? 0) > 256 * 1024 * 1024
          || device.vramTotalBytes !== null && device.vramTotalBytes > 0 && device.vramFreeBytes !== null && device.vramFreeBytes >= 0
            && device.vramTotalBytes - device.vramFreeBytes > Math.max(2 * 1024 ** 3, device.vramTotalBytes * 0.1));
        if (released || knownOccupied) measuredRetained = knownOccupied;
        consecutiveReleased = released ? consecutiveReleased + 1 : 0;
        if (consecutiveReleased >= 2 && await this.isQueueIdle(signal())) return result(true, null);
      }
      if (!await this.isQueueIdle(signal())) return result(false, 'ComfyUI queue is not idle after the H3 VRAM release wait.');
      return measuredRetained
        ? result(false, 'GPU memory remains occupied after the bounded H3 VRAM release wait (ComfyUI caches or another process). Retry the handoff before starting Qwen.')
        : result(null, 'ComfyUI accepted /free and the idle wait finished, but GPU telemetry could not verify H3 VRAM release.');
    } catch (reason) {
      return result(false, `H3 VRAM release failed: ${errorMessage(reason)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  watchJob(remotePromptId: string, onState: (state: ComputeJobState) => void): () => void {
    requireCanonicalComfyPromptId(remotePromptId);
    const controller = new AbortController();
    void this.monitorJob(remotePromptId, onState, controller.signal);
    return () => controller.abort();
  }

  getOutputUrl(output: ComfyOutputFile): string {
    return createOutputUrl(this.baseUrl, output);
  }

  async downloadOutput(output: ComfyOutputFile, destinationDirectory: string): Promise<ComfyDownloadResult> {
    if (!output.filename.trim()) throw new Error('ComfyUI output is missing a filename.');
    const directory = resolve(destinationDirectory);
    mkdirSync(directory, { recursive: true });
    const rawFilename = output.filename.replaceAll('\\', '/').split('/').pop() ?? 'comfy-output';
    const sanitizedFilename = Array.from(rawFilename, (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || '<>:"/|?*'.includes(character) ? '_' : character;
    }).join('');
    const safeFilename = sanitizedFilename && sanitizedFilename !== '.' && sanitizedFilename !== '..' ? sanitizedFilename : 'comfy-output';
    const extension = extname(safeFilename);
    const stem = extension ? safeFilename.slice(0, -extension.length) : safeFilename;
    let localPath = join(directory, safeFilename);
    let suffix = 1;
    while (existsSync(localPath)) {
      localPath = join(directory, `${stem} (${suffix})${extension}`);
      suffix += 1;
    }
    const temporaryPath = join(directory, `.${safeFilename}.${randomUUID()}.part`);
    try {
      const response = await this.fetchImpl(this.getOutputUrl(output), { method: 'GET', headers: new Headers(authHeaders(this.auth)) });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`ComfyUI output download failed (${response.status})${detail.trim() ? `: ${detail.trim()}` : ''}`);
      }
      const contents = Buffer.from(await response.arrayBuffer());
      writeFileSync(temporaryPath, contents);
      renameSync(temporaryPath, localPath);
      return { output, localPath, downloadedAt: new Date().toISOString() };
    } catch (reason) {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      throw new Error(`Could not download ComfyUI output ${output.filename}: ${errorMessage(reason)}`, { cause: reason });
    }
  }

  private loadWorkflowTemplate(filePath: string): ComfyApiWorkflow {
    const absolutePath = resolve(filePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
    } catch (reason) {
      throw new Error(`Could not read H3 API workflow ${absolutePath}: ${errorMessage(reason)}`, { cause: reason });
    }
    validateMiniMaxH3ApiWorkflowTemplate(parsed);
    return parsed as ComfyApiWorkflow;
  }

  private prepareWorkflow(template: ComfyApiWorkflow, request: RemoteH3GenerationRequest, resolution: H3Resolution, references: { firstFrame: string | null; lastFrame: string | null; productReference: string | null; referenceImages: string[] }): ComfyApiWorkflow {
    const seed = request.workflowSettings?.seed ?? request.seed ?? randomInt(0, 4_294_967_296);
    const outputPrefix = `PROYA_H3_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}_${seed}`;
    const promptEngine = request.promptEngine;
    return prepareH3ComfyWorkflow(template, {
      prompt: request.prompt,
      generationBrief: request.generationBriefText ?? request.prompt ?? '',
      referenceContext: request.referenceContext ?? '',
      mediaManifest: request.mediaManifest ?? request.generationBrief?.mediaManifest ?? '',
      systemPrompt: request.systemPromptOverride ?? '',
      lmStudioEndpoint: promptEngine?.endpoint,
      lmStudioModel: promptEngine?.model,
      temperature: promptEngine?.temperature,
      repairAttempts: promptEngine?.repairAttempts,
      disableThinking: promptEngine?.disableThinking,
      unloadModel: promptEngine?.unloadModelBeforeH3,
      promptTimeout: promptEngine?.timeoutSeconds,
      language: request.generationBrief?.language ?? 'Indonesian',
      promptAspectRatio: request.generationBrief?.aspectRatio ?? request.aspectRatio,
      mode: request.mode,
      duration: request.duration,
      aspectRatio: resolution.selectorValue,
      width: resolution.width,
      height: resolution.height,
      fps: request.fps,
      frames: request.frames,
      megapixels: request.megapixels,
      multiple: request.multiple,
      steps: request.workflowSettings?.steps ?? request.steps ?? 20,
      seed,
      firstFrame: references.firstFrame,
      lastFrame: references.lastFrame,
      productReference: references.productReference,
      referenceImages: references.referenceImages,
      refImageSize: request.refImageSize,
      scheduler: request.scheduler,
      outputPrefix
    });
  }

  private async prepareRemoteReferences(request: RemoteH3GenerationRequest, publish: (status: ComputeJobState['status'], overrides?: Partial<ComputeJobState>) => void, authorization?: TrustedReferenceAuthorization): Promise<{ firstFrame: string | null; lastFrame: string | null; productReference: string | null; referenceImages: string[]; uploads: ComfyUploadedFile[] }> {
    const uploads: ComfyUploadedFile[] = [];
    const uploadBySource = new Map<string, ComfyUploadedFile>();
    const upload = async (sourcePath: string | null | undefined, explicitlyAuthorizedPath?: string): Promise<string | null> => {
      if (!sourcePath?.trim()) return null;
      publish('uploading_reference', { referenceUploads: uploads });
      const uploaded = await this.uploadLocalReference(sourcePath, request.product, explicitlyAuthorizedPath);
      if (!uploads.some((item) => item.sourcePath === uploaded.sourcePath && item.filename === uploaded.filename)) uploads.push(uploaded);
      uploadBySource.set(sourcePath, uploaded);
      return uploaded.filename;
    };
    const remoteOrUploaded = async (remoteFilename: string | null, localPath: string | null | undefined, explicitlyAuthorizedPath?: string): Promise<string | null> => {
      if (localPath?.trim()) {
        const existing = uploadBySource.get(localPath);
        return existing?.filename ?? upload(localPath, explicitlyAuthorizedPath);
      }
      if (remoteFilename?.trim()) {
        if (isLocalFilesystemPath(remoteFilename.trim())) throw new Error('A local filesystem path cannot be sent to ComfyUI. Use the matching local reference path field so Creative Studio can upload it safely.');
        return remoteFilename.trim();
      }
      return null;
    };
    const usableReferenceInputs = request.referenceImages?.filter((reference) => Boolean(
      reference.remoteFilename?.trim()
      || reference.filename?.trim()
      || reference.localPath?.trim()
      || reference.path?.trim()
    )) ?? [];
    const requestedReferences = usableReferenceInputs.length
      ? usableReferenceInputs.map((reference) => ({
        remoteFilename: reference.remoteFilename?.trim() || reference.filename?.trim() || null,
        localPath: reference.localPath?.trim() || reference.path?.trim() || null
      }))
      : [{ remoteFilename: request.productReference, localPath: request.productReferencePath }];
    const referenceImages: string[] = [];
    for (const [index, reference] of requestedReferences.entries()) {
      const explicitlyAuthorizedPath = usableReferenceInputs.length
        ? index === 0 && reference.localPath && request.productReferencePath && reference.localPath === request.productReferencePath
          ? authorization?.productReferencePath
          : undefined
        : authorization?.productReferencePath;
      const remoteReference = await remoteOrUploaded(reference.remoteFilename, reference.localPath, explicitlyAuthorizedPath);
      if (remoteReference) referenceImages.push(remoteReference);
    }
    return { firstFrame: null, lastFrame: null, productReference: referenceImages[0] ?? null, referenceImages, uploads };
  }

  private resolveReferencePath(sourcePath: string, explicitlyAuthorizedPath?: string): string {
    const candidate = resolve(sourcePath);
    let resolvedPath: string;
    try { resolvedPath = realpathSync(candidate); }
    catch (reason) { throw new Error(`Reference upload could not find ${sourcePath}: ${errorMessage(reason)}`, { cause: reason }); }
    if (explicitlyAuthorizedPath) {
      if (!samePath(resolvedPath, explicitlyAuthorizedPath)) throw new Error('Reference upload was blocked because the source file was not the explicitly selected file.');
      return resolvedPath;
    }
    if (this.localReferenceRoots.length === 0) throw new Error('Reference upload is disabled until an allowed local product/reference folder is configured.');
    if (this.localReferenceRoots.length > 0 && !this.localReferenceRoots.some((root) => pathWithin(root, resolvedPath))) {
      throw new Error('Reference upload was blocked because the source file is outside the configured local reference folders.');
    }
    return resolvedPath;
  }

  private async uploadLocalReference(sourcePath: string, product: RemoteH3GenerationRequest['product'], explicitlyAuthorizedPath?: string): Promise<ComfyUploadedFile> {
    const resolvedPath = this.resolveReferencePath(sourcePath, explicitlyAuthorizedPath);
    let fileInfo;
    try { fileInfo = statSync(resolvedPath); }
    catch (reason) { throw new Error(`Reference upload could not inspect ${resolvedPath}: ${errorMessage(reason)}`, { cause: reason }); }
    if (!fileInfo.isFile()) throw new Error('Reference upload requires a regular image file.');
    if (fileInfo.size <= 0) throw new Error('Reference upload rejected an empty image file.');
    if (fileInfo.size > this.maxReferenceUploadBytes) throw new Error(`Reference upload is too large. The maximum is ${Math.round(this.maxReferenceUploadBytes / (1024 * 1024))} MiB.`);
    const { mimeType } = referenceMimeType(resolvedPath);
    const cacheKey = `${resolvedPath}:${fileInfo.size}:${fileInfo.mtimeMs}:${product ?? 'reference'}`;
    const cached = this.uploadCache.get(cacheKey);
    if (cached) return cached;
    const inFlight = this.inFlightUploads.get(cacheKey);
    if (inFlight) return inFlight;
    const contents = readFileSync(resolvedPath);
    const remoteName = remoteReferenceFilename(product, resolvedPath, contents);
    const pending = this.uploadReferenceFile(resolvedPath, remoteName, mimeType, contents).then((uploaded) => {
      this.uploadCache.set(cacheKey, uploaded);
      this.inFlightUploads.delete(cacheKey);
      return uploaded;
    }, (reason) => {
      this.inFlightUploads.delete(cacheKey);
      throw reason;
    });
    this.inFlightUploads.set(cacheKey, pending);
    return pending;
  }

  private async uploadReferenceFile(sourcePath: string, remoteName: string, mimeType: string, contents: Buffer): Promise<ComfyUploadedFile> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(contents)], { type: mimeType }), remoteName);
    form.append('type', 'input');
    form.append('overwrite', 'false');
    const payload = await this.requestJson<ComfyUploadResponse>('/upload/image', { method: 'POST', body: form });
    const name = asString(payload.name) ?? remoteName;
    const subfolder = asString(payload.subfolder) ?? '';
    const type = asString(payload.type) ?? 'input';
    return { sourcePath, filename: combineComfyFilename(name, subfolder), subfolder, type };
  }

  private async requestJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    const multipart = typeof FormData !== 'undefined' && init.body instanceof FormData;
    if (init.body !== undefined && !multipart) headers.set('Content-Type', 'application/json');
    for (const [key, value] of Object.entries(authHeaders(this.auth))) headers.set(key, value);
    const response = await this.fetchImpl(endpointFor(this.baseUrl, path), { ...init, headers });
    const text = await response.text();
    let payload: unknown = {};
    if (text.trim()) {
      try { payload = JSON.parse(text) as unknown; } catch { payload = text; }
    }
    if (!response.ok) throw new Error(`ComfyUI request ${path} failed (${response.status}): ${errorMessage(payload)}`);
    return payload as T;
  }

  private makeState(localJobId: string | null, remotePromptId: string | null, status: ComputeJobState['status'], overrides: Partial<ComputeJobState> = {}): ComputeJobState {
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
      serverUrl: this.baseUrl,
      updatedAt: new Date().toISOString(),
      ...overrides
    };
  }

  private async monitorJob(remotePromptId: string, onState: (state: ComputeJobState) => void, signal: AbortSignal): Promise<void> {
    let latest = this.makeState(null, remotePromptId, 'submitted');
    let terminal = false;
    try {
      latest = await this.getJobState(remotePromptId);
      onState(latest);
      terminal = latest.status === 'completed' || latest.status === 'failed' || latest.status === 'error';
    } catch (reason) {
      latest = { ...latest, connectionError: errorMessage(reason), updatedAt: new Date().toISOString() };
      onState(latest);
    }

    let socket: ComfyWebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const publish = (next: Partial<ComputeJobState>) => {
      latest = { ...latest, ...next, updatedAt: new Date().toISOString() };
      onState(latest);
      terminal = latest.status === 'completed' || latest.status === 'failed' || latest.status === 'error';
    };
    const scheduleReconnect = () => {
      if (terminal || signal.aborted || reconnectTimer || reconnectAttempts >= 8) return;
      const delay = Math.min(5000, 500 * 2 ** reconnectAttempts);
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectSocket();
      }, delay);
    };
    const connectSocket = () => {
      if (terminal || signal.aborted || !this.webSocketFactory || this.auth.type !== 'none') return;
      const clientId = this.clientIds.get(remotePromptId);
      if (!clientId) return;
      try {
        socket = this.webSocketFactory(websocketEndpointFor(this.baseUrl, clientId));
        socket.onopen = () => { reconnectAttempts = 0; };
        socket.onmessage = (event) => this.handleSocketMessage(event.data, remotePromptId, publish);
        socket.onerror = () => { if (!terminal) scheduleReconnect(); };
        socket.onclose = () => { if (!terminal) scheduleReconnect(); };
      } catch (reason) {
        publish({ connectionError: errorMessage(reason) });
        scheduleReconnect();
      }
    };

    connectSocket();
    try {
      while (!terminal && !signal.aborted) {
        await wait(this.pollIntervalMs, signal);
        if (terminal || signal.aborted) break;
        try {
          const polled = await this.getJobState(remotePromptId);
          const preserveLiveProgress = polled.status !== 'completed' && polled.status !== 'failed' && polled.status !== 'error';
          const effectiveStatus = statusRank(polled.status) < statusRank(latest.status) ? latest.status : polled.status;
          publish({
            ...polled,
            status: effectiveStatus,
            progress: preserveLiveProgress && polled.progress === null ? latest.progress : polled.progress,
            currentNode: preserveLiveProgress && polled.currentNode === null ? latest.currentNode : polled.currentNode,
            queuePosition: polled.queuePosition ?? latest.queuePosition,
            queueRemaining: polled.queueRemaining ?? latest.queueRemaining
          });
        } catch (reason) {
          publish({ connectionError: errorMessage(reason) });
        }
      }
    } finally {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const socketToClose = socket as ComfyWebSocket | null;
      socketToClose?.close();
    }
  }

  private handleSocketMessage(raw: unknown, remotePromptId: string, publish: (next: Partial<ComputeJobState>) => void): void {
    if (typeof raw !== 'string') return;
    let message: unknown;
    try { message = JSON.parse(raw) as unknown; } catch { return; }
    if (!isRecord(message)) return;
    const data = isRecord(message.data) ? message.data : {};
    const messagePromptId = asString(data.prompt_id);
    if (messagePromptId && messagePromptId !== remotePromptId) return;
    const type = asString(message.type);
    if (type === 'status') {
      const status = isRecord(data.status) ? data.status : {};
      const execInfo = isRecord(status.exec_info) ? status.exec_info : {};
      publish({ queueRemaining: asNumber(execInfo.queue_remaining) });
    } else if (type === 'execution_start') {
      publish({ status: 'running', progress: 0, pipelineStage: 'QUEUED_H3', connectionError: null });
    } else if (type === 'executing') {
      const node = data.node;
      const currentNode = asString(node);
      const pipelineStage = pipelineStageForNode(currentNode);
      publish(node === null
        ? { progress: 1, currentNode: null, pipelineStage: 'GENERATING_H3' }
        : { status: 'running', currentNode, pipelineStage: pipelineStage ?? 'GENERATING_H3', connectionError: null });
    } else if (type === 'progress') {
      const value = asNumber(data.value);
      const maximum = asNumber(data.max);
      const currentNode = asString(data.node);
      publish({ status: 'running', progress: value !== null && maximum !== null && maximum > 0 ? Math.min(1, Math.max(0, value / maximum)) : null, currentNode, pipelineStage: pipelineStageForNode(currentNode) ?? 'GENERATING_H3', connectionError: null });
    } else if (type === 'executed') {
      const nodeId = asString(data.node);
      const output = data.output;
      const next: Partial<ComputeJobState> = { currentNode: nodeId, pipelineStage: pipelineStageForNode(nodeId) ?? 'GENERATING_H3' };
      if (nodeId === '149' || nodeId === '150' || nodeId === '152') Object.assign(next, executionMetadata({ [nodeId]: output }));
      if (nodeId === '151') next.validationReport = asString(outputSlot(output, 2)) ?? firstString(output, ['validation_report', 'report', 'text']);
      publish(next);
    } else if (type === 'execution_error') {
      const currentNode = asString(data.node) ?? asString(data.node_id);
      const executionError = asString(data.exception_message) ?? asString(data.message) ?? 'ComfyUI reported an execution error.';
      const failureStage = pipelineStageForNode(currentNode) === 'WRITING_PROMPT'
        ? classifyH3PromptEngineError(executionError)
        : pipelineStageForNode(currentNode) === 'VALIDATING_PROMPT'
          ? 'PROMPT_VALIDATION_FAILED'
          : pipelineStageForNode(currentNode) === 'UNLOADING_LLM' ? 'LLM_UNLOAD_FAILED' : 'H3_GENERATION_FAILED';
      const promptEngine = this.promptEngineByPromptId.get(remotePromptId);
      publish({
        status: 'failed',
        currentNode,
        pipelineStage: failureStage,
        failureStage,
        error: h3PromptEngineErrorMessage(executionError, promptEngine),
        connectionError: null,
        promptEngine: promptEngine ?? null,
        ...(currentNode === '152' ? { llmUnloadSucceeded: false, llmUnloadError: executionError } : {}),
        ...h3PromptEngineAudit(promptEngine)
      });
    } else if (type === 'execution_interrupted') {
      publish({ status: 'failed', pipelineStage: 'H3_GENERATION_FAILED', failureStage: 'H3_GENERATION_FAILED', error: 'ComfyUI interrupted the execution.', connectionError: null });
    }
  }
}
