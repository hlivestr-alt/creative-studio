export const productIds = ['cleanser', 'toner', 'serum', 'eye-cream', 'skin-cream', 'mask', 'full-series'] as const;
export type ProductId = (typeof productIds)[number];
export type ProductSelection = ProductId | 'auto';
export type HistoryStatus = 'Prepared' | 'Used' | 'Rejected' | 'Archived';
export type Language = 'Indonesian' | 'English';
export type PostFormat = 'Instagram Feed 4:5' | 'Square 1:1' | 'Story / TikTok 9:16';
export type Creativity = 'Safe' | 'Balanced' | 'Experimental';
export type TextAmount = 'No Text' | 'Minimal' | 'Educational' | 'Promotional';
export const captionModes = ['SHORT', 'STANDARD', 'DETAILED', 'NONE'] as const;
export type CaptionMode = (typeof captionModes)[number];
export type WorkspaceLayout = 'split' | 'controls' | 'chatgpt';
export const workflowModes = ['DIRECT_IMAGE', 'EXPLORE_IDEAS'] as const;
export type WorkflowMode = (typeof workflowModes)[number];

export const computeModes = ['local', 'remote'] as const;
export type ComputeMode = (typeof computeModes)[number];
export const computeModeOptions: ReadonlyArray<{ value: ComputeMode; label: string; description: string }> = [
  { value: 'local', label: 'Local (legacy)', description: 'Keep legacy non-autonomous compute behavior for development and troubleshooting.' },
  { value: 'remote', label: 'Remote', description: 'Submit an API-format H3 workflow to the configured remote ComfyUI PC.' }
];

export interface RemoteComfySystemInfo {
  connected: boolean;
  url: string;
  comfyVersion: string | null;
  gpuName: string | null;
  vramTotalBytes: number | null;
  vramFreeBytes: number | null;
  latencyMs: number | null;
  error?: string;
}

/** The user-visible state machine for the autonomous H3 control plane. */
export const h3PipelineStages = [
  'PREPARING',
  'UPLOADING_REFERENCES',
  'WRITING_PROMPT',
  'VALIDATING_PROMPT',
  'UNLOADING_LLM',
  'QUEUED_H3',
  'GENERATING_H3',
  'RELEASING_H3_VRAM',
  'DOWNLOADING',
  'COMPLETE',
  'REFERENCE_UPLOAD_FAILED',
  'LLM_UNAVAILABLE',
  'PROMPT_GENERATION_FAILED',
  'PROMPT_GENERATION_TIMEOUT',
  'PROMPT_VALIDATION_FAILED',
  'LLM_UNLOAD_FAILED',
  'H3_QUEUE_FAILED',
  'H3_GENERATION_FAILED',
  'DOWNLOAD_FAILED'
] as const;
export type H3PipelineStage = (typeof h3PipelineStages)[number];

/** The only LM Studio prompt model used by autonomous MiniMax H3 jobs. */
export const h3PromptEngineModelId = 'qwen/qwen3.8-27b' as const;

/** Human-readable label for the fixed H3 prompt model. */
export const h3PromptEngineModelLabel = 'Qwen 3.8 27B' as const;

/** Production defaults for the LM Studio prompt rewrite and bounded repair loop. */
export const h3PromptEngineProductionDefaults = {
  temperature: 0.2,
  repairAttempts: 2,
  disableThinking: true,
  timeoutSeconds: 600
} as const;

/** Settings for the fixed Qwen instance reached only through the ComfyUI node. */
export interface H3PromptEngineSettings {
  provider: 'lmstudio-remote';
  /** Loopback endpoint on the China execution PC, never called by the laptop. */
  endpoint: string;
  /** Fixed canonical model ID; retained in the contract but never user-editable. */
  model: string;
  temperature: number;
  repairAttempts: number;
  disableThinking: boolean;
  unloadModelBeforeH3: boolean;
  timeoutSeconds: number;
}

export interface H3PromptEngineStatus {
  enhancerInstalled: boolean;
  validatorInstalled: boolean;
  requiredNodesInstalled: boolean;
  lmStudioConnected: boolean;
  /** Models and identity observed by the remote discovery proxy. */
  models: string[];
  observedModelId: string | null;
  observedInstanceId: string | null;
  /** @deprecated Use observedModelId; retained for older renderer/state payloads. */
  selectedModel: string | null;
  qwenReady: boolean;
  error: string | null;
  checkedAt: string;
}

/** Where Creative Studio obtained a canonical prompt or validation value. */
export const h3CaptureSources = ['structured', 'fallback_raw_history'] as const;
export type H3CaptureSource = (typeof h3CaptureSources)[number];

export interface H3CreativeDirection {
  concept: string;
  visualHook: string;
  creativeArchetype: string;
  environment: string;
  composition: string;
  cameraPath: string;
  framing: string;
  lightingStyle: string;
  primaryMotion: string;
  secondaryMotion: string;
  materialEffect: string;
  pacing: string;
  openingDevice: string;
  transitionLanguage: string;
  endingDevice: string;
  audioCharacter: string;
}

export interface H3GenerationBriefReference {
  pictureTag: string;
  slot: number;
  role: string;
  description: string;
  source: H3ReferenceSource;
  /** Optional authoritative subject owned by this connected picture. */
  subjectTag?: string;
}

/** Labels the remote enhancer and validator are allowed to emit for this job. */
export interface H3AllowedReferenceLabels {
  subjects: string[];
  pictures: string[];
  videos: string[];
  audios: string[];
}

/** Physical binding retained for the development inspector and job audit. */
export interface H3ReferenceBinding extends H3GenerationBriefReference {
  physicalInput: string;
  nodeId: string | null;
  uploadedFilename: string | null;
}

/** Intermediate brief sent to MiniMaxH3PromptEnhancer; it is not final prompt text. */
export interface H3GenerationBrief {
  schemaVersion: 1;
  workflowMode: 'REF2VA';
  product: ProductId;
  contentType: H3ContentType;
  contentFamily: H3ContentType;
  duration: number;
  aspectRatio: H3WorkflowAspectRatio;
  language: Language;
  videoIdea: string;
  creativeDirection: H3CreativeDirection;
  productCorrections: string[];
  references: H3GenerationBriefReference[];
  /** Exact legacy-compatible JSON passed to both Prompt Enhancer and Validator. */
  mediaManifest: string;
  /** Positive allow-list derived from the same ordered reference contract. */
  allowedReferenceLabels: H3AllowedReferenceLabels;
  musicOnly: boolean;
  captions: boolean;
  subtitles: boolean;
  sound: H3Sound;
  specialInstructions: string;
}

/**
 * Remote H3 lifecycle states. `submitted` and `error` remain accepted for
 * records created by the first Remote Compute implementation.
 */
export type ComputeJobStatus = 'preparing' | 'uploading_reference' | 'submitted' | 'queued' | 'running' | 'completed' | 'failed' | 'error';

export interface ComfyOutputFile {
  nodeId: string;
  kind: string;
  filename: string;
  subfolder: string;
  type: string;
  url: string;
}

export interface ComfyUploadedFile {
  sourcePath: string;
  filename: string;
  subfolder: string;
  type: string;
}

export interface ComfyDownloadResult {
  output: ComfyOutputFile;
  localPath: string;
  downloadedAt: string;
}

export interface H3VramSnapshot {
  capturedAt: string;
  devices: { name: string | null; type: string | null; vramTotalBytes: number | null; vramFreeBytes: number | null; torchReservedBytes: number | null }[];
}

export interface H3VramReleaseAudit {
  h3VramReleaseRequested?: boolean;
  /** null means the idle wait finished but GPU telemetry could not verify release. */
  h3VramReleaseSucceeded?: boolean | null;
  h3VramReleaseDurationMs?: number | null;
  h3VramReleaseError?: string | null;
  h3VramBeforeRelease?: H3VramSnapshot | null;
  h3VramAfterRelease?: H3VramSnapshot | null;
}

export interface ComputeJobState extends H3VramReleaseAudit {
  /** Creative Studio's stable local identifier for this tracked job. */
  localJobId: string | null;
  /** The authoritative prompt identifier returned by ComfyUI. */
  remotePromptId: string | null;
  status: ComputeJobStatus;
  progress: number | null;
  currentNode: string | null;
  queuePosition: number | null;
  queueRemaining: number | null;
  outputs: ComfyOutputFile[];
  referenceUploads: ComfyUploadedFile[];
  remoteUploadedFilename: string | null;
  localResultPath: string | null;
  downloadError: string | null;
  error: string | null;
  connectionError: string | null;
  serverUrl: string;
  updatedAt: string;
  /** Development-only copy of the exact POST /prompt body. */
  submissionJson?: string;
  /** Autonomous H3 stage; legacy records may omit this field. */
  pipelineStage?: H3PipelineStage;
  failureStage?: H3PipelineStage;
  generationBrief?: H3GenerationBrief | null;
  referenceMap?: H3GenerationBriefReference[];
  mediaManifest?: string | null;
  allowedReferenceLabels?: H3AllowedReferenceLabels | null;
  physicalReferenceMap?: H3ReferenceBinding[];
  systemPromptHash?: string | null;
  lmStudioModelId?: string | null;
  /** Canonical model identifier captured for this H3 job. */
  llmModelId?: string | null;
  temperature?: number | null;
  /** Effective values sent to node 149 for this job. */
  llmModel?: string | null;
  llmTemperature?: number | null;
  llmTimeoutSeconds?: number | null;
  llmRepairAttempts?: number | null;
  /** Canonical configured repair budget. */
  repairAttemptsConfigured?: number | null;
  llmDisableThinking?: boolean | null;
  repairAttemptsUsed?: number | null;
  /** Canonical enhancer output and rewrite diagnostics. */
  enhancementManifest?: string | null;
  rewriteDiagnostics?: string | null;
  finalEnhancedPrompt?: string | null;
  validationReport?: string | null;
  promptCaptureSource?: H3CaptureSource | null;
  validationCaptureSource?: H3CaptureSource | null;
  promptEngine?: H3PromptEngineSettings | null;
  llmUnloadRequested?: boolean;
  llmUnloadSucceeded?: boolean | null;
  llmUnloadError?: string | null;
  llmInstanceId?: string | null;
  llmUnloadDurationMs?: number | null;
  stageTimings?: Record<string, number>;
}

export interface RemoteH3GenerationRequest {
  /** @deprecated Legacy caller field. Autonomous H3 submits generationBrief instead. */
  prompt?: string;
  /** Structured brief consumed by the remote MiniMax H3 prompt-engine nodes. */
  generationBrief?: H3GenerationBrief;
  /** Serialized intermediate brief; retained in the request for auditability. */
  generationBriefText?: string;
  /** Reference descriptions are passed separately from the brief. */
  referenceContext?: string;
  /** Exact manifest generated from the immutable H3 reference contract. */
  mediaManifest?: string;
  /** Positive label allow-list generated with mediaManifest. */
  allowedReferenceLabels?: H3AllowedReferenceLabels;
  promptEngine?: H3PromptEngineSettings;
  /** Main process injects the exact file contents; never populated by the renderer. */
  systemPromptOverride?: string;
  mode: H3ResolvedWorkflowMode;
  duration: number;
  aspectRatio: string;
  fps: number;
  frames: number;
  megapixels: number;
  multiple: number;
  /** Active PrimitiveInt value used by the supplied workflow's full-steps branch. */
  steps?: number;
  /** Exact seed injected into RandomNoise for this submitted job. */
  seed?: number;
  firstFrame: string | null;
  lastFrame: string | null;
  productReference: string | null;
  /** MiniMax H3 reference image sizing: `max` favors identity fidelity at a higher cost. */
  refImageSize?: H3ReferenceImageSize;
  /** Optional ordered image inputs for Ref2VA. Legacy productReference fields remain supported. */
  referenceImages?: RemoteH3ReferenceImage[];
  /** BasicScheduler choice. The supplied production workflow defaults to `simple`. */
  scheduler?: H3Scheduler;
  /** Immutable effective settings snapshot for this submitted job. */
  workflowSettings?: H3WorkflowSettingsSnapshot;
  /** Local source paths are consumed only by the Electron main process. */
  firstFramePath?: string | null;
  lastFramePath?: string | null;
  productReferencePath?: string | null;
  product?: ProductId;
  promptRecordId?: number | null;
  /** Internal stable local identifier used while upload is in progress. */
  localJobId?: string;
  /** @deprecated Kept only to read older requests; it is never sent as ComfyUI prompt_id. */
  clientJobId?: string;
}

export interface RemoteH3JobRecord extends H3VramReleaseAudit {
  localJobId: string;
  remotePromptId: string | null;
  createdAt: string;
  updatedAt: string;
  promptRecordId: number | null;
  product: ProductId | null;
  workflowMode: H3ResolvedWorkflowMode;
  prompt: string;
  generationBrief?: H3GenerationBrief | null;
  generationBriefText?: string | null;
  referenceContext?: string | null;
  promptEngine?: H3PromptEngineSettings | null;
  systemPromptHash?: string | null;
  lmStudioModelId?: string | null;
  llmModelId?: string | null;
  /** Effective values sent to node 149 for this job. */
  llmModel?: string | null;
  llmTemperature?: number | null;
  llmTimeoutSeconds?: number | null;
  llmRepairAttempts?: number | null;
  llmDisableThinking?: boolean | null;
  repairAttemptsConfigured?: number | null;
  repairAttemptsUsed?: number | null;
  enhancementManifest?: string | null;
  rewriteDiagnostics?: string | null;
  finalEnhancedPrompt?: string | null;
  validationReport?: string | null;
  promptCaptureSource?: H3CaptureSource | null;
  validationCaptureSource?: H3CaptureSource | null;
  referenceMap?: H3GenerationBriefReference[];
  mediaManifest?: string | null;
  allowedReferenceLabels?: H3AllowedReferenceLabels | null;
  physicalReferenceMap?: H3ReferenceBinding[];
  timings?: Record<string, number> | null;
  pipelineStage?: H3PipelineStage | null;
  llmUnloadRequested?: boolean | null;
  llmUnloadSucceeded?: boolean | null;
  llmUnloadError?: string | null;
  llmInstanceId?: string | null;
  llmUnloadDurationMs?: number | null;
  request: RemoteH3GenerationRequest;
  /** Effective values submitted to the workflow, including the final seed. */
  workflowSettings?: H3WorkflowSettingsSnapshot;
  localSourceReferencePath: string | null;
  remoteUploadedFilename: string | null;
  outputMetadata: ComfyOutputFile[];
  localDownloadedPath: string | null;
  status: ComputeJobStatus;
  state: ComputeJobState;
}

export const h3WorkflowModes = ['AUTO', 'T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA'] as const;
export type H3WorkflowMode = (typeof h3WorkflowModes)[number];
export type H3ResolvedWorkflowMode = Exclude<H3WorkflowMode, 'AUTO'>;
/** Exact aspect-ratio values accepted by the live ResolutionSelector node. */
export const h3WorkflowAspectRatioValues = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'] as const;
export type H3WorkflowAspectRatio = (typeof h3WorkflowAspectRatioValues)[number];
/** Includes the legacy Custom value so older saved H3 records can still be read. */
export type H3AspectRatio = H3WorkflowAspectRatio | 'Custom';
export const h3ContentTypes = ['Cinematic Product Ad', 'UGC Content', 'Product Demo', 'Product B-Roll', 'Product Transformation', 'Educational', 'Ingredient / Texture', 'Custom'] as const;
export type H3ContentType = (typeof h3ContentTypes)[number];
export const creativeDiversityFallbackReasons = ['compatible_pool_exhausted', 'novelty_threshold_missed'] as const;
export type CreativeDiversityFallbackReason = (typeof creativeDiversityFallbackReasons)[number];

/** Selection diagnostics; novelty/history can explain a choice but never become an execution gate. */
export interface CreativeDiversityDiagnostics {
  selectedContentType: H3ContentType;
  resolvedCreativeFamily: H3ContentType;
  candidateFamilySearched: H3ContentType;
  candidateCount: number;
  hardCompatibleCandidateCount: number;
  historyFilteredCandidateCount: number;
  noveltyThreshold: number;
  noveltyThresholdMissed: boolean;
  diversityFallbackUsed: boolean;
  diversityFallbackReason: CreativeDiversityFallbackReason | null;
  rerollsUsed: number;
  noveltyScore: number;
}
export type H3QualityPreset = 'Draft' | 'Preview' | 'Final' | 'Custom';
export type H3CameraMotion = 'Static' | 'Low' | 'Medium' | 'High' | 'Cinematic';
export type H3ActionIntensity = 'Low' | 'Medium' | 'High' | 'Extreme';
export type H3Pacing = 'Slow' | 'Balanced' | 'Fast';
export type H3ProductFidelity = 'Auto' | 'Normal' | 'High' | 'Exact';
export type H3Ending = 'Hero Shot' | 'Close-Up' | 'Hold' | 'Loopable' | 'Custom';
export type H3Sound = 'Auto' | 'Sound + Music' | 'Sound Only' | 'Music Only' | 'Silent' | 'Sound Design + Music' | 'Sound Design Only';
export type H3PromptDetail = 'Simple' | 'Production' | 'Maximum Detail';
export const h3ReferenceFidelityOptions = ['Standard', 'High'] as const;
export type H3ReferenceFidelity = (typeof h3ReferenceFidelityOptions)[number];
export type H3ReferenceImageSize = 'match' | 'max';
export const h3ReferenceImageSizeOptions = ['match', 'max'] as const;
export const h3SchedulerOptions = ['simple', 'normal', 'beta'] as const;
export type H3Scheduler = (typeof h3SchedulerOptions)[number];
export const h3SeedModeOptions = ['random', 'fixed'] as const;
export type H3SeedMode = (typeof h3SeedModeOptions)[number];

/**
 * The editable H3 settings model. Every field maps to a value in the supplied
 * MiniMax H3 API workflow; there is no quality/fidelity alias in this model.
 */
export interface H3WorkflowSettings {
  durationSeconds: number;
  aspectRatio: H3WorkflowAspectRatio;
  megapixels: number;
  multiple: number;
  fps: number;
  steps: number;
  scheduler: H3Scheduler;
  seedMode: H3SeedMode;
  /** Fixed-seed preference; a random-mode job replaces it with a fresh seed. */
  seed: number;
  refImageSize: H3ReferenceImageSize;
}

/** Exact effective values captured with a submitted job. */
export interface H3WorkflowSettingsSnapshot extends H3WorkflowSettings {
  frameLength: number;
  resolvedWidth: number;
  resolvedHeight: number;
}

export const h3ReferenceRoles = ['product-front', 'product-back', 'product-side', 'style', 'other'] as const;
export type H3ReferenceRole = (typeof h3ReferenceRoles)[number];
export const h3LockedProductPlateModes = ['Off', 'Full Shot', 'Opening Hero', 'Final Hero'] as const;
export type H3LockedProductPlateMode = (typeof h3LockedProductPlateModes)[number];
export const h3LockedProductPlateModeOptions: ReadonlyArray<{ value: H3LockedProductPlateMode; label: string; description: string }> = [
  { value: 'Off', label: 'Off', description: 'Let H3 generate the complete shot as it does today.' },
  { value: 'Full Shot', label: 'Full Shot', description: 'Keep the original product plate locked from first frame through final frame.' },
  { value: 'Opening Hero', label: 'Opening Hero', description: 'Lock the original product plate during the opening hero beat.' },
  { value: 'Final Hero', label: 'Final Hero', description: 'Lock the original product plate during the final hero beat.' }
];
export type H3ReferenceSource = 'none' | 'selected-product' | 'local-file' | 'custom';

/**
 * Controls how far the local H3 creative planner should move from recent
 * executions. Product identity and verified product data are never part of
 * this control.
 */
export const creativeVarietyOptions = ['Consistent', 'Balanced', 'Exploratory'] as const;
export type CreativeVariety = (typeof creativeVarietyOptions)[number];

/** Local lifecycle for a planned H3 concept and its eventual render job. */
export type H3GenerationStatus = 'planned' | 'prepared' | 'queued' | 'running' | 'completed' | 'failed' | 'rejected' | 'archived';

export const creativeGenomeAxes = [
  'visualHook',
  'creativeArchetype',
  'environment',
  'composition',
  'cameraPath',
  'framing',
  'lightingStyle',
  'primaryMotion',
  'secondaryMotion',
  'materialEffect',
  'pacing',
  'openingDevice',
  'transitionLanguage',
  'endingDevice',
  'audioCharacter'
] as const;
export type CreativeGenomeAxis = (typeof creativeGenomeAxes)[number];

/**
 * A creative plan contains choices about execution only. It deliberately has
 * no packaging, claim, ingredient, or other product-truth fields.
 */
export interface CreativeGenome {
  schemaVersion: 1;
  contentFamily: H3ContentType;
  creativeArchetype: string;
  visualHook: string;
  environment: string;
  composition: string;
  cameraPath: string;
  framing: string;
  lightingStyle: string;
  primaryMotion: string;
  secondaryMotion: string;
  materialEffect: string;
  pacing: string;
  openingDevice: string;
  transitionLanguage: string;
  endingDevice: string;
  audioCharacter: string;
}

/** A comparable, stable fingerprint derived from a CreativeGenome. */
export interface CreativeFingerprint extends CreativeGenome {
  signature: string;
  majorDimensions: CreativeGenomeAxis[];
}

export interface CreativePenaltySource {
  axis: CreativeGenomeAxis;
  value: string;
  occurrences: number;
  penalty: number;
  recentGenerationIds: string[];
}

export interface H3ReferenceAsset {
  source: H3ReferenceSource;
  description: string;
  path: string | null;
}

/** Ordered Ref2VA image slot. Picture numbers are assigned from this array. */
export interface H3ReferenceImageSlot {
  role: H3ReferenceRole;
  asset: H3ReferenceAsset;
}

/** Remote image input; either a remote ComfyUI filename or a local path is supplied. */
export interface RemoteH3ReferenceImage {
  filename?: string | null;
  path?: string | null;
  /** Aliases accepted for callers that distinguish remote and local values. */
  remoteFilename?: string | null;
  localPath?: string | null;
}

export interface H3ReferencePlan {
  firstFrame: H3ReferenceAsset;
  lastFrame: H3ReferenceAsset;
  productReference: H3ReferenceAsset;
  styleReference: H3ReferenceAsset;
  /** Optional explicit ordered Ref2VA references for future multi-angle workflows. */
  referenceImages?: H3ReferenceImageSlot[];
}

export interface H3RecommendedSettings {
  mode: H3ResolvedWorkflowMode;
  modeReason: string;
  duration: number;
  aspectRatio: string;
  /** Legacy preset label; new workflow settings are megapixels/multiple directly. */
  quality?: H3QualityPreset;
  megapixels: number;
  multiple: number;
  fps: number;
  frames: number;
  productFidelity: H3ProductFidelity;
  audio: H3Sound;
  references: string[];
  /** UI-facing fidelity choice; omitted only on legacy persisted settings. */
  referenceFidelity?: H3ReferenceFidelity;
  /** Workflow-facing mapping for MiniMaxH3ReferenceToVideo.ref_image_size. */
  refImageSize?: H3ReferenceImageSize;
  /** BasicScheduler value used by the API workflow. */
  scheduler?: H3Scheduler;
  /** Active PrimitiveInt steps value used by the API workflow. */
  steps?: number;
  /** Effective UI seed policy and fixed-seed preference. */
  seedMode?: H3SeedMode;
  seed?: number;
  /** ResolutionSelector output dimensions derived from aspect ratio, MP, and multiple. */
  resolvedWidth?: number;
  resolvedHeight?: number;
}

export interface H3VideoBrief {
  product: ProductId;
  /** Optional for backward compatibility with H3 records created before content types were added. */
  contentType?: H3ContentType;
  /** Optional for backward compatibility; new H3 plans default to Balanced. */
  creativeVariety?: CreativeVariety;
  /** Seed used to reproduce the local creative selection. */
  creativeSeed?: number;
  /** The selected creative execution; it never replaces product truth. */
  creativeGenome?: CreativeGenome | null;
  videoIdea: string;
  language: Language;
  musicOnly: boolean;
  captions: boolean;
  subtitles: boolean;
  goal: string;
  customGoal: string;
  duration: number;
  aspectRatio: H3AspectRatio;
  customAspectRatio: string;
  /** Direct workflow settings; optional only for legacy saved briefs. */
  steps?: number;
  seedMode?: H3SeedMode;
  seed?: number;
  refImageSize?: H3ReferenceImageSize;
  qualityPreset: H3QualityPreset;
  megapixels: number;
  multiple: number;
  fps: number;
  workflowMode: H3WorkflowMode;
  cameraMotion: H3CameraMotion;
  actionIntensity: H3ActionIntensity;
  pacing: H3Pacing;
  productFidelity: H3ProductFidelity;
  ending: H3Ending;
  customEnding: string;
  sound: H3Sound;
  promptDetail: H3PromptDetail;
  /** Optional for backward compatibility; new exact product-reference jobs default to High. */
  referenceFidelity?: H3ReferenceFidelity;
  /** Optional for backward compatibility; production default remains simple. */
  scheduler?: H3Scheduler;
  /** Optional for backward compatibility with H3 records created before plate planning was added. */
  lockedProductPlateMode?: H3LockedProductPlateMode;
  specialInstructions: string;
  references: H3ReferencePlan;
}

export interface H3Concept {
  id: string;
  title: string;
  description: string;
  visualHook: string;
  mainAction: string;
  recommendedMode: H3ResolvedWorkflowMode;
  recommendedDuration: number;
  referenceRecommendation: string;
  cameraApproach: string;
  /** Optional local diversity plan associated with this concept. */
  creativeGenome?: CreativeGenome | null;
  noveltyScore?: number | null;
}

export interface H3TimelineSegment {
  start: number;
  end: number;
  label: string;
  detail: string;
}

export interface H3PromptRecord {
  id: number;
  createdAt: string;
  product: ProductId;
  contentType: H3ContentType;
  brief: H3VideoBrief;
  concept: H3Concept | null;
  resolvedMode: H3ResolvedWorkflowMode;
  referencePlan: H3ReferencePlan;
  timeline: H3TimelineSegment[];
  chatGptRequest: string;
  recommendedSettings: H3RecommendedSettings | null;
  prompt: string;
  /** Persistent Creative Diversity Engine metadata. */
  generationJobId?: string | null;
  generationStatus?: H3GenerationStatus;
  creativeSeed?: number | null;
  creativeGenome?: CreativeGenome | null;
  creativeFingerprint?: CreativeFingerprint | null;
  conceptSummary?: string | null;
  noveltyScore?: number | null;
  repetitionPenaltySources?: CreativePenaltySource[];
  diversityFallbackUsed?: boolean | null;
  diversityFallbackReason?: CreativeDiversityFallbackReason | null;
  rerollsUsed?: number | null;
  noveltyThresholdMissed?: boolean | null;
  creativeDiversityDiagnostics?: CreativeDiversityDiagnostics | null;
  /** Autonomous H3 intermediate contract and execution audit fields. */
  generationBrief?: H3GenerationBrief | null;
  generationBriefText?: string | null;
  referenceContext?: string | null;
  promptEngine?: H3PromptEngineSettings | null;
  systemPromptHash?: string | null;
  lmStudioModelId?: string | null;
  llmModelId?: string | null;
  temperature?: number | null;
  llmModel?: string | null;
  llmTemperature?: number | null;
  llmTimeoutSeconds?: number | null;
  llmRepairAttempts?: number | null;
  llmDisableThinking?: boolean | null;
  repairAttemptsConfigured?: number | null;
  repairAttemptsUsed?: number | null;
  enhancementManifest?: string | null;
  rewriteDiagnostics?: string | null;
  finalEnhancedPrompt?: string | null;
  validationReport?: string | null;
  promptCaptureSource?: H3CaptureSource | null;
  validationCaptureSource?: H3CaptureSource | null;
  referenceMap?: H3GenerationBriefReference[];
  timings?: Record<string, number> | null;
  remotePromptId?: string | null;
  outputPath?: string | null;
  pipelineStage?: H3PipelineStage | null;
  llmUnloadRequested?: boolean | null;
  llmUnloadSucceeded?: boolean | null;
  llmUnloadError?: string | null;
  llmInstanceId?: string | null;
  llmUnloadDurationMs?: number | null;
}

export type H3PromptInput = Omit<H3PromptRecord, 'id' | 'createdAt' | 'contentType' | 'chatGptRequest' | 'recommendedSettings'>
  & Partial<Pick<H3PromptRecord, 'contentType' | 'chatGptRequest' | 'recommendedSettings'>>;
export interface H3PromptUpdate {
  contentType?: H3ContentType;
  brief?: H3VideoBrief;
  concept?: H3Concept | null;
  resolvedMode?: H3ResolvedWorkflowMode;
  referencePlan?: H3ReferencePlan;
  timeline?: H3TimelineSegment[];
  chatGptRequest?: string;
  recommendedSettings?: H3RecommendedSettings | null;
  prompt?: string;
  generationJobId?: string | null;
  generationStatus?: H3GenerationStatus;
  creativeSeed?: number | null;
  creativeGenome?: CreativeGenome | null;
  creativeFingerprint?: CreativeFingerprint | null;
  conceptSummary?: string | null;
  noveltyScore?: number | null;
  repetitionPenaltySources?: CreativePenaltySource[];
  diversityFallbackUsed?: boolean | null;
  diversityFallbackReason?: CreativeDiversityFallbackReason | null;
  rerollsUsed?: number | null;
  noveltyThresholdMissed?: boolean | null;
  creativeDiversityDiagnostics?: CreativeDiversityDiagnostics | null;
  generationBrief?: H3GenerationBrief | null;
  generationBriefText?: string | null;
  referenceContext?: string | null;
  promptEngine?: H3PromptEngineSettings | null;
  systemPromptHash?: string | null;
  lmStudioModelId?: string | null;
  llmModelId?: string | null;
  temperature?: number | null;
  llmModel?: string | null;
  llmTemperature?: number | null;
  llmTimeoutSeconds?: number | null;
  llmRepairAttempts?: number | null;
  llmDisableThinking?: boolean | null;
  repairAttemptsConfigured?: number | null;
  repairAttemptsUsed?: number | null;
  enhancementManifest?: string | null;
  rewriteDiagnostics?: string | null;
  finalEnhancedPrompt?: string | null;
  validationReport?: string | null;
  promptCaptureSource?: H3CaptureSource | null;
  validationCaptureSource?: H3CaptureSource | null;
  referenceMap?: H3GenerationBriefReference[];
  timings?: Record<string, number> | null;
  remotePromptId?: string | null;
  outputPath?: string | null;
  pipelineStage?: H3PipelineStage | null;
  llmUnloadRequested?: boolean | null;
  llmUnloadSucceeded?: boolean | null;
  llmUnloadError?: string | null;
  llmInstanceId?: string | null;
  llmUnloadDurationMs?: number | null;
}

export const postStructures = ['SINGLE_IMAGE', 'CAROUSEL'] as const;
export type PostStructure = (typeof postStructures)[number];
export const slideCountOptions = ['AUTO', 3, 4, 5, 6, 7, 8] as const;
export type RequestedSlideCount = (typeof slideCountOptions)[number];

export const workflowModeOptions: ReadonlyArray<{ value: WorkflowMode; label: string; description: string }> = [
  { value: 'DIRECT_IMAGE', label: 'Direct Image Prompt', description: 'Create one finished image concept and prompt ready for approval.' },
  { value: 'EXPLORE_IDEAS', label: 'Explore 3 Ideas', description: 'Generate three creative directions before choosing one.' }
];

export const postStructureOptions: ReadonlyArray<{ value: PostStructure; label: string; description: string }> = [
  { value: 'SINGLE_IMAGE', label: 'Single Image', description: 'Create one complete Instagram image.' },
  { value: 'CAROUSEL', label: 'Carousel', description: 'Create a coordinated multi-slide Instagram carousel.' }
];

export const captionModeOptions: ReadonlyArray<{ value: CaptionMode; label: string; description: string }> = [
  { value: 'STANDARD', label: 'Standard', description: 'About 80–150 words.' },
  { value: 'SHORT', label: 'Short', description: 'About 30–70 words.' },
  { value: 'DETAILED', label: 'Detailed', description: 'About 150–250 words.' },
  { value: 'NONE', label: 'None', description: 'Do not generate a caption or hashtags.' }
];

export interface ChatPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface Product {
  id: ProductId;
  officialName: string;
  shortName: string;
  size: string;
  role: string;
  imagePath: string;
  referenceImagePaths?: string[];
  packagingDescription: string;
  physicalIdentity: ProductPhysicalIdentity;
  ingredients: string[];
  benefitTerritories: string[];
  safeCopy: string[];
  topics: string[];
  visualMotifs: string[];
  textureCues: string[];
  usagePosition: string;
  packagingRestrictions: string[];
  isHero: boolean;
}

export interface ProductPhysicalIdentity {
  packageType: string;
  /** Components that physically belong to the package, independent of how they are staged in a photograph. */
  packageComponents: string[];
  size: string;
  shape: string;
  proportions: string;
  closureType: string;
  /** Manufacturing material only. Unknown values must stay unknown rather than being inferred from appearance. */
  physicalMaterial: string;
  /** What the package surface visibly looks like, independent of manufacturing material. */
  surfaceAppearance: string;
  transparency: string;
  visibleGlassTransparency: boolean;
  /** Exact appearance of the printed front face. */
  frontSurfaceAppearance: ProductSurfaceAppearance;
  /** Verified appearance of the rear face; this is authoritative during rear reveals. */
  rearSurfaceAppearance: ProductSurfaceAppearance;
  /** Verified appearance of the side faces; this is authoritative during side reveals. */
  sideSurfaceAppearance: ProductSurfaceAppearance;
  /** Package-level opacity behavior, separate from physical manufacturing material. */
  opacityBehavior: string;
  /** Whether real contents can be seen through package walls or only through an opening/exposure. */
  contentsVisibility: string;
  colorAppearance: string;
  labelAppearance: string;
  referenceAuthority: string;
  /** Reference-only arrangement; these states must never be promoted into permanent package geometry. */
  referencePresentationState: string[];
  /** Verified behavior of rear and otherwise unprinted surfaces when choreography reveals them. */
  unprintedSurfaceAppearance: ProductUnprintedSurfaceAppearance;
  /** Authoritative real-world measurements; component values are never implicitly additive. */
  dimensions: ProductDimensions;
  /** Verified product contents, distinct from the package material and surface. */
  contentsAppearance?: ProductContentsAppearance;
  forbiddenInterpretations: string[];
}

/**
 * Surface-specific packaging truth. `content` is intentionally descriptive:
 * rear and side surfaces use the literal value `blank`, while front surfaces
 * identify the official printed artwork. The old unprintedSurfaceAppearance
 * field remains in the data for saved-record compatibility; prompt generation
 * uses these explicit front/rear/side records as the source of truth.
 */
export interface ProductSurfaceAppearance {
  appliesTo: string;
  verification: string;
  content: string;
  printedArtwork: string;
  text: string;
  graphics: string;
  logos: string;
  barcode: string;
  regulatoryCopy: string;
  instructions: string;
  labels: string;
  finish: string;
  continuity: string;
}

export interface ProductComponentMeasurement {
  component: string;
  heightCm?: number;
  widthCm?: number;
  notes?: string;
}

export interface ProductDimensions {
  measurementAuthority: string;
  overallHeightCm?: number;
  widthCm?: number;
  widthBottomCm?: number;
  widthTopCm?: number;
  diameterCm?: number;
  componentMeasurements: ProductComponentMeasurement[];
  notes: string[];
}

export interface ProductContentsAppearance {
  appliesTo: string;
  verification: string;
  color: string;
  transparency: string;
  visualConsistency: string;
  visibleThroughPackageWalls: boolean;
  packageVisibility: string;
  forbiddenColorInterpretations: string[];
  stylingSeparation: string;
}

export interface ProductUnprintedSurfaceAppearance {
  appliesTo: string;
  verification: string;
  content: 'blank';
  text: 'none';
  graphics: 'none';
  logos: 'none';
  barcode: 'none';
  regulatoryCopy: 'none';
  instructions: 'none';
  labels: 'none';
  finish: string;
}

export interface CreativeSettings {
  product: ProductSelection;
  workflowMode: WorkflowMode;
  postStructure: PostStructure;
  requestedSlideCount: RequestedSlideCount;
  postType: string;
  topic: string;
  visualStyle: string;
  textAmount: TextAmount;
  captionMode: CaptionMode;
  language: Language;
  format: PostFormat;
  creativity: Creativity;
}

export interface AppSettings {
  chatGptUrl: string;
  computeMode: ComputeMode;
  remoteComfyUrl: string;
  remoteComfyWorkflowPath: string;
  remoteOutputDirectory: string;
  remoteAutoDownload: boolean;
  defaultLanguage: Language;
  defaultFormat: PostFormat;
  defaultCreativity: Creativity;
  defaultWorkflowMode: WorkflowMode;
  defaultPostStructure: PostStructure;
  defaultCaptionMode: CaptionMode;
  recentHistoryWindow: number;
  productAssetsDirectory: string;
  referencesDirectory: string;
  splitRatio: number;
  h3WorkflowSettings: H3WorkflowSettings;
  /** Exact system-prompt file consumed by the remote enhancer node. */
  h3SystemPromptPath: string;
  h3PromptEngine: H3PromptEngineSettings;
}

export interface HistoryRecord {
  id: number;
  createdAt: string;
  product: ProductId;
  workflowMode: WorkflowMode;
  postStructure: PostStructure;
  requestedSlideCount: RequestedSlideCount | null;
  captionMode: CaptionMode;
  postType: string;
  topic: string;
  visualStyle: string;
  creativityLevel: Creativity;
  format: PostFormat;
  language: Language;
  preparedBrief: string;
  conceptTitle: string | null;
  headline: string | null;
  status: HistoryStatus;
  notes: string | null;
}

export type HistoryInput = Omit<HistoryRecord, 'id' | 'createdAt'>;

export interface HistoryUpdate {
  status?: HistoryStatus;
  conceptTitle?: string | null;
  headline?: string | null;
  notes?: string | null;
}

export interface RotationRecommendation {
  productId: ProductId;
  reason: string;
  scores: Record<string, number>;
}

export interface DashboardSummary {
  recommendation: RotationRecommendation;
  recent: HistoryRecord[];
  usedCounts: Record<string, number>;
}
