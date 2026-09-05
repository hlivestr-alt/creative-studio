import { h3PromptEngineModelId, h3PromptEngineProductionDefaults, type H3ReferenceImageSize, type H3Scheduler, type RemoteH3GenerationRequest } from './types';

export type ComfyWorkflowInput = string | number | boolean | null | ComfyWorkflowInput[] | { [key: string]: ComfyWorkflowInput };

export interface ComfyApiNode {
  class_type: string;
  inputs: Record<string, ComfyWorkflowInput>;
  [key: string]: unknown;
}

export type ComfyApiWorkflow = Record<string, ComfyApiNode>;

export interface H3WorkflowVariables {
  /** Legacy final prompt input; autonomous jobs leave this empty. */
  prompt?: string;
  generationBrief?: string;
  referenceContext?: string;
  /** Exact same JSON contract is linked into enhancer and validator. */
  mediaManifest?: string;
  systemPrompt?: string;
  lmStudioEndpoint?: string;
  lmStudioModel?: string;
  temperature?: number;
  repairAttempts?: number;
  disableThinking?: boolean;
  unloadModel?: boolean;
  promptTimeout?: number;
  language?: string;
  /** Raw ratio for the enhancer; ResolutionSelector still receives its expanded label. */
  promptAspectRatio?: string;
  mode: RemoteH3GenerationRequest['mode'];
  duration: number;
  aspectRatio: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  megapixels: number;
  multiple: number;
  /** Active full-step branch; legacy callers default to the workflow's 20-step value. */
  steps?: number;
  seed: number;
  firstFrame: string | null;
  lastFrame: string | null;
  productReference: string | null;
  /** Ordered remote filenames for Ref2VA image slots. */
  referenceImages?: Array<string | null>;
  /** MiniMax H3 `ref_image_size` value. */
  refImageSize?: H3ReferenceImageSize;
  /** BasicScheduler value; production defaults to `simple`. */
  scheduler?: H3Scheduler;
  outputPrefix: string;
}

/** The MiniMax H3 node exposes nine growable reference-image inputs. */
export const h3ReferenceImageSlotLimit = 9;

function normalizedReferenceImages(variables: H3WorkflowVariables): string[] {
  const explicitValues = variables.referenceImages ?? [];
  const explicitReferences = explicitValues.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (explicitReferences.length) return explicitReferences;
  return variables.productReference?.trim() ? [variables.productReference] : [];
}

function h3PlaceholderValues(variables: H3WorkflowVariables): Record<string, string | number | boolean> {
  const referenceImages = normalizedReferenceImages(variables);
  const values: Record<string, string | number | boolean> = {
    H3_PROMPT: variables.prompt ?? '',
    H3_GENERATION_BRIEF: variables.generationBrief ?? '',
    H3_REFERENCE_CONTEXT: variables.referenceContext ?? '',
    H3_MEDIA_MANIFEST: variables.mediaManifest ?? '',
    H3_SYSTEM_PROMPT: variables.systemPrompt ?? '',
    H3_LM_STUDIO_ENDPOINT: variables.lmStudioEndpoint ?? 'http://127.0.0.1:1234/v1',
    // The autonomous H3 node is hard-wired to the one supported prompt model.
    H3_LM_STUDIO_MODEL: h3PromptEngineModelId,
    H3_TEMPERATURE: variables.temperature ?? h3PromptEngineProductionDefaults.temperature,
    H3_REPAIR_ATTEMPTS: variables.repairAttempts ?? h3PromptEngineProductionDefaults.repairAttempts,
    H3_DISABLE_THINKING: variables.disableThinking ?? h3PromptEngineProductionDefaults.disableThinking,
    H3_UNLOAD_MODEL: variables.unloadModel ?? true,
    H3_PROMPT_TIMEOUT: variables.promptTimeout ?? h3PromptEngineProductionDefaults.timeoutSeconds,
    H3_LANGUAGE: variables.language ?? 'Indonesian',
    H3_PROMPT_ASPECT_RATIO: variables.promptAspectRatio ?? variables.aspectRatio,
    H3_MODE: variables.mode,
    H3_DURATION: variables.duration,
    H3_ASPECT_RATIO: variables.aspectRatio,
    H3_WIDTH: variables.width,
    H3_HEIGHT: variables.height,
    H3_FPS: variables.fps,
    H3_FRAMES: variables.frames,
    H3_MEGAPIXELS: variables.megapixels,
    H3_MULTIPLE: variables.multiple,
    H3_STEPS: variables.steps ?? 20,
    H3_SEED: variables.seed,
    H3_REF_IMAGE_SIZE: variables.refImageSize ?? 'match',
    H3_SCHEDULER: variables.scheduler ?? 'simple',
    H3_OUTPUT_PREFIX: variables.outputPrefix
  };
  for (let index = 0; index < 9; index += 1) {
    values[`H3_REF_IMAGE_${index}`] = referenceImages[index] ?? '';
  }
  if (variables.firstFrame) values.H3_FIRST_FRAME = variables.firstFrame;
  if (variables.lastFrame) values.H3_LAST_FRAME = variables.lastFrame;
  if (variables.productReference) values.H3_PRODUCT_REFERENCE = variables.productReference;
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function formatWorkflowError(message: string): Error {
  return new Error(`Invalid ComfyUI API workflow: ${message}`);
}

/**
 * Validates the prompt graph accepted by POST /prompt. ComfyUI's editor JSON
 * contains nodes/links/layout data and is deliberately rejected here; the
 * API graph is a map of node IDs to { class_type, inputs } objects.
 */
export function parseComfyApiWorkflow(value: unknown): ComfyApiWorkflow {
  if (!isRecord(value)) throw formatWorkflowError('the top level must be a node map object');
  if ('nodes' in value || 'links' in value || 'groups' in value || 'version' in value) {
    throw formatWorkflowError('the supplied file looks like UI workflow JSON; export the workflow in ComfyUI API format');
  }
  const entries = Object.entries(value);
  if (entries.length === 0) throw formatWorkflowError('the node map is empty');

  for (const [nodeId, node] of entries) {
    if (!isRecord(node) || typeof node.class_type !== 'string' || !node.class_type.trim()) {
      throw formatWorkflowError(`node ${nodeId} must contain a non-empty class_type`);
    }
    if (!isRecord(node.inputs)) throw formatWorkflowError(`node ${nodeId} must contain an inputs object`);
  }
  return cloneJson(value as ComfyApiWorkflow);
}

function replacePlaceholders(value: ComfyWorkflowInput, replacements: Record<string, string | number | boolean>): { value: ComfyWorkflowInput; replacedPrompt: boolean; replacedBrief: boolean } {
  if (typeof value === 'string') {
    let result: string | number | boolean = value;
    let replacedPrompt = false;
    let replacedBrief = false;
    for (const [name, replacement] of Object.entries(replacements)) {
      if (typeof result !== 'string') break;
      const token = `{{${name}}}`;
      if (result === token) {
        if (name === 'H3_PROMPT') replacedPrompt = true;
        if (name === 'H3_GENERATION_BRIEF') replacedBrief = true;
        result = replacement;
        break;
      }
      if (result.includes(token)) {
        result = result.replaceAll(token, String(replacement));
        if (name === 'H3_PROMPT') replacedPrompt = true;
        if (name === 'H3_GENERATION_BRIEF') replacedBrief = true;
      }
    }
    return { value: result, replacedPrompt, replacedBrief };
  }
  if (Array.isArray(value)) {
    let replacedPrompt = false;
    let replacedBrief = false;
    const next = value.map((item) => {
      const replacement = replacePlaceholders(item, replacements);
      replacedPrompt ||= replacement.replacedPrompt;
      replacedBrief ||= replacement.replacedBrief;
      return replacement.value;
    });
    return { value: next, replacedPrompt, replacedBrief };
  }
  if (isRecord(value)) {
    let replacedPrompt = false;
    let replacedBrief = false;
    const next: Record<string, ComfyWorkflowInput> = {};
    for (const [key, item] of Object.entries(value)) {
      const replacement = replacePlaceholders(item as ComfyWorkflowInput, replacements);
      replacedPrompt ||= replacement.replacedPrompt;
      replacedBrief ||= replacement.replacedBrief;
      next[key] = replacement.value;
    }
    return { value: next, replacedPrompt, replacedBrief };
  }
  return { value, replacedPrompt: false, replacedBrief: false };
}

function collectUnresolved(value: ComfyWorkflowInput, found: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/{{H3_[A-Z0-9_]+}}/g)) found.add(match[0]);
  } else if (Array.isArray(value)) {
    for (const item of value) collectUnresolved(item, found);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) collectUnresolved(item as ComfyWorkflowInput, found);
  }
}

/** Enumerates the same input placeholders that the injector must resolve. */
export function collectH3WorkflowPlaceholders(workflow: ComfyApiWorkflow): string[] {
  const found = new Set<string>();
  for (const node of Object.values(workflow)) collectUnresolved(node.inputs, found);
  return [...found].sort();
}

function referenceImageIndex(inputName: string): number | null {
  const match = /^ref_images\.ref_image_(\d+)$/.exec(inputName);
  return match ? Number(match[1]) : null;
}

function nextNumericNodeId(workflow: ComfyApiWorkflow): string {
  const numericIds = Object.keys(workflow).map((nodeId) => Number(nodeId)).filter((nodeId) => Number.isInteger(nodeId));
  return String((numericIds.length ? Math.max(...numericIds) : 0) + 1);
}

/** Adds LoadImage nodes only when a caller intentionally supplies more images than the export wires by default. */
function ensureReferenceImageInputs(workflow: ComfyApiWorkflow, referenceCount: number): void {
  const node = workflow['136'];
  if (!node || node.class_type !== 'MiniMaxH3ReferenceToVideo' || referenceCount <= 0) return;
  if (referenceCount > h3ReferenceImageSlotLimit) {
    throw formatWorkflowError(`the MiniMax H3 node supports at most ${h3ReferenceImageSlotLimit} reference image slot(s), but ${referenceCount} were supplied`);
  }
  for (let index = 0; index < referenceCount; index += 1) {
    const inputName = `ref_images.ref_image_${index}`;
    if (inputName in node.inputs) continue;
    const nodeId = nextNumericNodeId(workflow);
    workflow[nodeId] = {
      class_type: 'LoadImage',
      inputs: { image: `{{H3_REF_IMAGE_${index}}}` },
      _meta: { title: `Load Ref2VA Image ${index + 1}` }
    };
    node.inputs[inputName] = [nodeId, 0];
  }
}

/**
 * Reference image inputs are growable in ComfyUI. The supplied API export has
 * two loaders, so an unused second slot must be disconnected rather than
 * receiving a duplicate filename or an empty LoadImage input.
 */
function pruneUnusedReferenceInputs(workflow: ComfyApiWorkflow, referenceImages: Array<string | null>): void {
  const node = workflow['136'];
  if (!node || node.class_type !== 'MiniMaxH3ReferenceToVideo') return;
  const connectedInputs = Object.keys(node.inputs)
    .map(referenceImageIndex)
    .filter((index): index is number => index !== null)
    .sort((left, right) => left - right);
  const supportedCount = connectedInputs.length;
  const populatedCount = referenceImages.filter((value) => typeof value === 'string' && value.trim()).length;
  if (populatedCount > supportedCount) {
    throw formatWorkflowError(`the workflow exposes ${supportedCount} reference image slot(s), but ${populatedCount} were supplied`);
  }
  for (const inputName of Object.keys(node.inputs)) {
    const index = referenceImageIndex(inputName);
    if (index !== null && index >= populatedCount) delete node.inputs[inputName];
  }
}

/** Applies supported H3 variables only inside node inputs and rejects unresolved required inputs. */
export function prepareH3ComfyWorkflow(template: unknown, variables: H3WorkflowVariables): ComfyApiWorkflow {
  const workflow = parseComfyApiWorkflow(template);
  const replacements = h3PlaceholderValues(variables);
  const referenceImages = normalizedReferenceImages(variables);
  ensureReferenceImageInputs(workflow, referenceImages.length);
  let replacedPrompt = false;
  let replacedBrief = false;
  for (const node of Object.values(workflow)) {
    const replacement = replacePlaceholders(node.inputs, replacements);
    node.inputs = replacement.value as Record<string, ComfyWorkflowInput>;
    replacedPrompt ||= replacement.replacedPrompt;
    replacedBrief ||= replacement.replacedBrief;
  }
  if (!replacedPrompt && !replacedBrief) throw formatWorkflowError('add the {{H3_PROMPT}} or {{H3_GENERATION_BRIEF}} placeholder to the H3 prompt-engine input before submitting');
  const unresolved = new Set<string>();
  for (const node of Object.values(workflow)) collectUnresolved(node.inputs, unresolved);
  if (unresolved.size) throw formatWorkflowError(`required placeholders remain unresolved: ${Array.from(unresolved).sort().join(', ')}`);
  pruneUnusedReferenceInputs(workflow, referenceImages);
  return workflow;
}

export const h3WorkflowPlaceholders = [
  '{{H3_PROMPT}}',
  '{{H3_GENERATION_BRIEF}}',
  '{{H3_REFERENCE_CONTEXT}}',
  '{{H3_MEDIA_MANIFEST}}',
  '{{H3_SYSTEM_PROMPT}}',
  '{{H3_LM_STUDIO_ENDPOINT}}',
  '{{H3_LM_STUDIO_MODEL}}',
  '{{H3_TEMPERATURE}}',
  '{{H3_REPAIR_ATTEMPTS}}',
  '{{H3_DISABLE_THINKING}}',
  '{{H3_UNLOAD_MODEL}}',
  '{{H3_PROMPT_TIMEOUT}}',
  '{{H3_LANGUAGE}}',
  '{{H3_PROMPT_ASPECT_RATIO}}',
  '{{H3_MODE}}',
  '{{H3_DURATION}}',
  '{{H3_ASPECT_RATIO}}',
  '{{H3_WIDTH}}',
  '{{H3_HEIGHT}}',
  '{{H3_FPS}}',
  '{{H3_FRAMES}}',
  '{{H3_MEGAPIXELS}}',
  '{{H3_MULTIPLE}}',
  '{{H3_STEPS}}',
  '{{H3_SEED}}',
  '{{H3_REF_IMAGE_SIZE}}',
  '{{H3_SCHEDULER}}',
  '{{H3_REF_IMAGE_0}}',
  '{{H3_REF_IMAGE_1}}',
  '{{H3_REF_IMAGE_2}}',
  '{{H3_REF_IMAGE_3}}',
  '{{H3_REF_IMAGE_4}}',
  '{{H3_REF_IMAGE_5}}',
  '{{H3_REF_IMAGE_6}}',
  '{{H3_REF_IMAGE_7}}',
  '{{H3_REF_IMAGE_8}}',
  '{{H3_FIRST_FRAME}}',
  '{{H3_LAST_FRAME}}',
  '{{H3_PRODUCT_REFERENCE}}',
  '{{H3_OUTPUT_PREFIX}}'
] as const;
