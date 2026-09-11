import type { ComputeJobState, CreativeGenome, H3ContentType, H3GenerationBrief, H3VideoBrief, H3VramReleaseAudit, Product, ProductId, RemoteH3GenerationRequest } from '../domain/types';

export const CHINA_RUNNER_VERSION = '2.0.0-production.20260910';
export const REQUIRED_QWEN_MODEL = 'qwen/qwen3.8-27b';
export const SESSION_BUNDLE_SCHEMA_VERSION = 1;
export const LOCAL_COMFY_URL = 'http://127.0.0.1:8188';
export const LOCAL_LM_STUDIO_URL = 'http://127.0.0.1:1234';
export const DEFAULT_API_ADDRESS = '127.0.0.1';
export const DEFAULT_API_PORT = 8787;
export const DEFAULT_STATE_ROOT = String.raw`D:\AI Videos\.proya-auto`;
export const DEFAULT_ARCHIVE_ROOT = String.raw`D:\AI Videos`;

export type RunnerMode = 'shadow' | 'canary' | 'two-job-canary' | 'production';
export type JobPhase =
  | 'PREPARING'
  | 'SUBMISSION_INTENT_PERSISTED'
  | 'SUBMITTED'
  | 'RUNNING'
  | 'OUTPUT_CAPTURED'
  | 'ARCHIVED'
  | 'RELEASING_VRAM'
  | 'VRAM_VERIFIED'
  | 'COMPLETED'
  | 'FAILED';

export interface SessionAssetBundle {
  id: string;
  productId: ProductId;
  sourcePath: string;
  filename: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  size: number;
  sha256: string;
  base64: string;
}

export interface ProductReferenceBinding {
  productId: ProductId;
  assetIds: string[];
}

export interface SessionSettings {
  brief: H3VideoBrief;
  [key: string]: unknown;
}

export interface ChinaSessionBundle {
  sessionId: string;
  schemaVersion: number;
  selectedProducts: ProductId[];
  selectedContentTypes: H3ContentType[];
  ordering: {
    productOrder: ProductId[];
    contentTypeOrder: H3ContentType[];
    shuffleProducts: boolean;
    shuffleContentTypes: boolean;
  };
  repeatPolicy: { mode: 'forever' | 'cycles'; cycles?: number };
  products: Product[];
  assets: SessionAssetBundle[];
  productReferences: ProductReferenceBinding[];
  settings: SessionSettings;
  initialSettingsVersion: number;
  systemPrompt: string;
  systemPromptSha256: string;
  workflow: Record<string, unknown>;
  workflowSha256: string;
  workflowVersion: string;
  archiveRoot: string;
  expectedRunnerVersion: string;
  /** SHA-256 of the canonical JSON bundle with this field omitted. */
  bundleSha256: string;
}

export interface PersistedSession {
  sessionId: string;
  status: 'STAGED' | 'SHADOW_SIMULATING' | 'CANARY_STARTING' | 'CANARY_RUNNING' | 'CANARY_FINISHED' | 'TWO_JOB_CANARY_STARTING' | 'TWO_JOB_CANARY_RUNNING' | 'TWO_JOB_CANARY_FINISHED' | 'PRODUCTION_STARTING' | 'PRODUCTION_RUNNING' | 'STOPPING' | 'STOPPED' | 'FAILED';
  bundleHash: string;
  bundle: ChinaSessionBundle;
  sessionDirectory: string;
  productIndex: number;
  contentTypeIndex: number;
  cycleNumber: number;
  cycleSeed: number;
  currentJobId: string | null;
  settingsVersion: number;
  stopAfterCurrent: boolean;
  stopNow: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}

export interface PersistedJob {
  jobId: string;
  sessionId: string;
  schedulerKey: string;
  phase: JobPhase;
  cycleNumber: number;
  productIndex?: number;
  contentTypeIndex?: number;
  product: ProductId;
  contentType: H3ContentType;
  settingsVersion: number;
  settingsSnapshot?: SessionSettings;
  creativeSeed: number;
  creativeGenome: CreativeGenome;
  creativeFingerprint: string;
  generationBrief: H3GenerationBrief;
  referenceAssetIds: string[];
  promptId: string | null;
  submissionHash: string | null;
  archivePath: string | null;
  archiveSize: number | null;
  archiveSha256: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  /** Complete immutable execution request, persisted before any model call. */
  request?: RemoteH3GenerationRequest;
  executionState?: ComputeJobState | null;
  outputFilename?: string | null;
  outputSize?: number | null;
  outputCapturedAt?: string | null;
  archivedAt?: string | null;
  vramAudit?: H3VramReleaseAudit | null;
  releaseAttempts?: number;
  completedAt?: string | null;
  laptopSyncedAt?: string | null;
  laptopSyncPath?: string | null;
}

export interface RunnerCapabilities {
  runnerVersion: string;
  bundleSchemaVersion: number;
  mode: RunnerMode;
  listenAddress: string;
  comfyUrl: string;
  lmStudioUrl: string;
  archiveRoot: string;
  generationEnabled: boolean;
  promptSubmissionEnabled: boolean;
  canaryStartEnabled: boolean;
  maxJobsPerSession: 1 | 2 | null;
}

export interface ReadinessProbe {
  ready: boolean;
  checkedAt: string;
  error: string | null;
  details?: unknown;
}

export interface StageResult {
  staged: true;
  sessionId: string;
  revision: number;
  bundleHash: string;
  sessionDirectory: string;
  mode: RunnerMode;
}

export interface CanaryStartResult {
  started: true;
  idempotent: boolean;
  sessionId: string;
  bundleHash: string;
  revision: number;
  status: PersistedSession['status'];
  maxJobsPerSession: 1 | 2 | null;
}
