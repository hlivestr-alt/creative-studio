import {
  h3ReferenceImageSizeOptions,
  h3SchedulerOptions,
  h3SeedModeOptions,
  h3WorkflowAspectRatioValues,
  h3PromptEngineModelId,
  type H3ReferenceImageSize,
  type H3Scheduler,
  type H3PromptEngineSettings,
  type H3WorkflowSettings,
  type H3WorkflowSettingsSnapshot,
  type ProductId,
  type RemoteH3GenerationRequest
} from './types';
import { collectH3WorkflowPlaceholders, h3ReferenceImageSlotLimit, parseComfyApiWorkflow, type ComfyWorkflowInput, type ComfyApiWorkflow } from './comfy-workflow';
import bundledMinimaxH3WorkflowTemplate from '../../workflows/minimax-h3-api.json';

export interface H3Resolution {
  selectorValue: string;
  width: number;
  height: number;
}

const comfyAspectRatios: Readonly<Record<string, { selectorValue: string; widthRatio: number; heightRatio: number }>> = {
  '1:1': { selectorValue: '1:1 (Square)', widthRatio: 1, heightRatio: 1 },
  '2:3': { selectorValue: '2:3 (Portrait Photo)', widthRatio: 2, heightRatio: 3 },
  '3:2': { selectorValue: '3:2 (Photo)', widthRatio: 3, heightRatio: 2 },
  '3:4': { selectorValue: '3:4 (Portrait Standard)', widthRatio: 3, heightRatio: 4 },
  '4:3': { selectorValue: '4:3 (Standard)', widthRatio: 4, heightRatio: 3 },
  '9:16': { selectorValue: '9:16 (Portrait Widescreen)', widthRatio: 9, heightRatio: 16 },
  '16:9': { selectorValue: '16:9 (Widescreen)', widthRatio: 16, heightRatio: 9 },
  '21:9': { selectorValue: '21:9 (Ultrawide)', widthRatio: 21, heightRatio: 9 }
};

/** The only product filename proven by the supplied working export. */
export const minimaxH3ConfirmedRemoteProductReferences: Readonly<Partial<Record<ProductId, string>>> = {
  'eye-cream': 'PROYA EYE CREAM - WHITE BG - Edited.png'
};

/**
 * The supplied Ref2VA export has two independent image connections. Picture
 * numbering is 1-based in the prompt, while the ComfyUI API input suffix is
 * zero-based in this export.
 */
export const minimaxH3ReferenceSlotMappings = [
  { pictureTag: '<Picture 1>', refInput: 'ref_images.ref_image_0', nodeId: '137', placeholder: '{{H3_REF_IMAGE_0}}', role: 'first connected reference image' },
  { pictureTag: '<Picture 2>', refInput: 'ref_images.ref_image_1', nodeId: '139', placeholder: '{{H3_REF_IMAGE_1}}', role: 'second connected reference image' }
] as const;

export const minimaxH3ReferenceImageLimit = h3ReferenceImageSlotLimit;
export const minimaxH3AspectRatioValues = h3WorkflowAspectRatioValues;
export const minimaxH3ReferenceImageSizeValues: readonly H3ReferenceImageSize[] = h3ReferenceImageSizeOptions;
export const minimaxH3SchedulerValues: readonly H3Scheduler[] = h3SchedulerOptions;

export const minimaxH3WorkflowMappings = [
  { placeholder: '{{H3_DURATION}}', nodeId: '149', inputName: 'duration_seconds', classType: 'MiniMaxH3PromptEnhancer', role: 'Requested duration for prompt enhancement' },
  { placeholder: '{{H3_LANGUAGE}}', nodeId: '149', inputName: 'dialogue_language', classType: 'MiniMaxH3PromptEnhancer', role: 'Requested dialogue language' },
  { placeholder: '{{H3_UNLOAD_MODEL}}', nodeId: '152', inputName: 'unload', classType: 'MiniMaxH3UnloadLMStudioModel', role: 'Configured LM Studio model handoff' },
  /** Kept as a disconnected migration input so older saved requests remain readable. */
  { placeholder: '{{H3_PROMPT}}', nodeId: '138', inputName: 'value', classType: 'PrimitiveStringMultiline', role: 'Prompt text linked to node 136 prompt' },
  { placeholder: '{{H3_GENERATION_BRIEF}}', nodeId: '147', inputName: 'value', classType: 'PrimitiveStringMultiline', role: 'Structured H3 brief linked to MiniMaxH3PromptEnhancer' },
  { placeholder: '{{H3_REFERENCE_CONTEXT}}', nodeId: '148', inputName: 'value', classType: 'PrimitiveStringMultiline', role: 'Reference context linked to enhancer and validator' },
  { placeholder: '{{H3_MEDIA_MANIFEST}}', nodeId: '153', inputName: 'value', classType: 'PrimitiveStringMultiline', role: 'Authoritative media manifest linked to enhancer and validator' },
  { placeholder: '{{H3_SYSTEM_PROMPT}}', nodeId: '149', inputName: 'system_prompt_override', classType: 'MiniMaxH3PromptEnhancer', role: 'Exact system-prompt override passed to the remote Qwen node' },
  { placeholder: '{{H3_LM_STUDIO_ENDPOINT}}', nodeId: '149', inputName: 'endpoint', classType: 'MiniMaxH3PromptEnhancer', role: 'LM Studio loopback endpoint on the execution PC' },
  { placeholder: '{{H3_LM_STUDIO_MODEL}}', nodeId: '149', inputName: 'model', classType: 'MiniMaxH3PromptEnhancer', role: `Fixed autonomous prompt model ${h3PromptEngineModelId}; other LM Studio models are ignored` },
  { placeholder: '{{H3_PROMPT_ASPECT_RATIO}}', nodeId: '149', inputName: 'aspect_ratio', classType: 'MiniMaxH3PromptEnhancer', role: 'Raw target aspect ratio for the enhancer' },
  { placeholder: '{{H3_TEMPERATURE}}', nodeId: '149', inputName: 'temperature', classType: 'MiniMaxH3PromptEnhancer', role: 'Exact configured prompt temperature' },
  { placeholder: '{{H3_PROMPT_TIMEOUT}}', nodeId: '149', inputName: 'timeout_seconds', classType: 'MiniMaxH3PromptEnhancer', role: 'Exact rewrite and repair request timeout' },
  { placeholder: '{{H3_REPAIR_ATTEMPTS}}', nodeId: '149', inputName: 'repair_attempts', classType: 'MiniMaxH3PromptEnhancer', role: 'Bounded sequential repair count' },
  { placeholder: '{{H3_DISABLE_THINKING}}', nodeId: '149', inputName: 'disable_thinking', classType: 'MiniMaxH3PromptEnhancer', role: 'Configured thinking switch' },
  { placeholder: '{{H3_ASPECT_RATIO}}', nodeId: '115', inputName: 'aspect_ratio', classType: 'ResolutionSelector', role: 'Resolution preset; node 115 derives width and height' },
  { placeholder: '{{H3_MEGAPIXELS}}', nodeId: '115', inputName: 'megapixels', classType: 'ResolutionSelector', role: 'Resolution pixel budget' },
  { placeholder: '{{H3_MULTIPLE}}', nodeId: '115', inputName: 'multiple', classType: 'ResolutionSelector', role: 'Resolution rounding multiple' },
  { placeholder: '{{H3_FRAMES}}', nodeId: '131', inputName: 'expression', classType: 'ComfyMathExpression', role: 'Frame count output linked to node 136 length' },
  { placeholder: '{{H3_FPS}}', nodeId: '130', inputName: 'fps', classType: 'CreateVideo', role: 'Output video FPS' },
  { placeholder: '{{H3_STEPS}}', nodeId: '143', inputName: 'value', classType: 'PrimitiveInt', role: 'UI Steps branch value routed by node 142 to BasicScheduler node 124' },
  { placeholder: '{{H3_SEED}}', nodeId: '129', inputName: 'noise_seed', classType: 'RandomNoise', role: 'Sampling noise seed' },
  { placeholder: '{{H3_REF_IMAGE_SIZE}}', nodeId: '136', inputName: 'ref_image_size', classType: 'MiniMaxH3ReferenceToVideo', role: 'Reference image sizing: match or max' },
  { placeholder: '{{H3_SCHEDULER}}', nodeId: '124', inputName: 'scheduler', classType: 'BasicScheduler', role: 'Sampling scheduler; production default is simple' },
  { placeholder: '{{H3_REF_IMAGE_0}}', nodeId: '137', inputName: 'image', classType: 'LoadImage', role: 'ref_image_0 / <Picture 1>' },
  { placeholder: '{{H3_REF_IMAGE_1}}', nodeId: '139', inputName: 'image', classType: 'LoadImage', role: 'ref_image_1 / <Picture 2>' },
  { placeholder: '{{H3_OUTPUT_PREFIX}}', nodeId: '92', inputName: 'filename_prefix', classType: 'SaveVideo', role: 'Remote output prefix' }
] as const;

/** Exact production contract; generic/custom workflow variables are separate. */
export const minimaxH3RequiredPlaceholders = [...new Set(minimaxH3WorkflowMappings.map(({ placeholder }) => placeholder))].sort();

function workflowError(message: string): Error {
  return new Error(`Invalid ComfyUI API workflow: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLink(value: ComfyWorkflowInput, nodeId: string, outputIndex: number): boolean {
  return Array.isArray(value) && value.length === 2 && value[0] === nodeId && value[1] === outputIndex;
}

/** Validates the exact node IDs, classes, input names, and graph links found in the supplied working export. */
export function validateMiniMaxH3ApiWorkflowTemplate(value: unknown): ComfyApiWorkflow {
  const workflow = parseComfyApiWorkflow(value);
  if (JSON.stringify(collectH3WorkflowPlaceholders(workflow)) !== JSON.stringify(minimaxH3RequiredPlaceholders)) {
    throw workflowError('production placeholder contract differs from the supported MiniMax H3 mappings; refresh the configured workflow file');
  }
  if ('max_tokens' in (workflow['149']?.inputs ?? {}) || 'max_output_tokens' in (workflow['149']?.inputs ?? {})) {
    throw workflowError('node 149 output-token inputs must be absent; LM Studio manages output length');
  }
  for (const mapping of minimaxH3WorkflowMappings) {
    const node = workflow[mapping.nodeId];
    if (!node || node.class_type !== mapping.classType) {
      throw workflowError(`expected node ${mapping.nodeId} to be ${mapping.classType} for ${mapping.placeholder}`);
    }
    const input = node.inputs[mapping.inputName];
    if (typeof input !== 'string' || !input.includes(mapping.placeholder)) {
      throw workflowError(`expected ${mapping.placeholder} at node ${mapping.nodeId} input ${mapping.inputName}`);
    }
  }

  const h3Node = workflow['136'];
  if (!h3Node || h3Node.class_type !== 'MiniMaxH3ReferenceToVideo') throw workflowError('expected node 136 to be MiniMaxH3ReferenceToVideo');
  const requiredLinks: ReadonlyArray<[string, string, number]> = [
    ['prompt', '151', 0], ['width', '115', 0], ['height', '115', 1], ['length', '131', 1],
    ['ref_images.ref_image_0', '137', 0], ['ref_images.ref_image_1', '139', 0]
  ];
  for (const [inputName, sourceNode, outputIndex] of requiredLinks) {
    if (!isLink(h3Node.inputs[inputName], sourceNode, outputIndex)) {
      throw workflowError(`node 136 input ${inputName} must remain linked to node ${sourceNode} output ${outputIndex}`);
    }
  }
  const enhancer = workflow['149'];
  if (!enhancer || enhancer.class_type !== 'MiniMaxH3PromptEnhancer'
    || !isLink(enhancer.inputs.basic_prompt, '147', 0)
    || !isLink(enhancer.inputs.reference_context, '148', 0)
    || !isLink(enhancer.inputs.media_manifest, '153', 0)
    || enhancer.inputs.mode !== 'ref2va'
    || !String(enhancer.inputs.system_prompt_override).includes('{{H3_SYSTEM_PROMPT}}')) {
    throw workflowError('node 149 must enhance the intermediate brief with the reference context and the final system-prompt override');
  }
  const validator = workflow['150'];
  if (!validator || validator.class_type !== 'MiniMaxH3PromptValidator'
    || !isLink(validator.inputs.prompt, '149', 0)
    || !isLink(validator.inputs.source_prompt, '147', 0)
    || !isLink(validator.inputs.reference_context, '148', 0)
    || !isLink(validator.inputs.media_manifest, '153', 0)) {
    throw workflowError('node 150 must validate the enhancer output against the original brief and reference context');
  }
  const gate = workflow['151'];
  if (!gate || gate.class_type !== 'MiniMaxH3PromptValidityGate'
    || !isLink(gate.inputs.prompt, '152', 0)
    || !isLink(gate.inputs.valid, '152', 1)
    || !isLink(gate.inputs.validation_report, '152', 2)
    || !isLink(gate.inputs.unload_succeeded, '152', 3)
    || !isLink(gate.inputs.unload_error, '152', 4)) {
    throw workflowError('node 151 must be a blocking validity gate after exact Qwen cleanup');
  }
  const unload = workflow['152'];
  if (!unload || unload.class_type !== 'MiniMaxH3UnloadLMStudioModel'
    || !isLink(unload.inputs.prompt, '150', 0)
    || !isLink(unload.inputs.valid, '150', 1)
    || !isLink(unload.inputs.validation_report, '150', 2)
    || !isLink(unload.inputs.model, '149', 8)
    || !isLink(unload.inputs.instance_id, '149', 9)) {
    throw workflowError('node 152 must unload the exact LM Studio model instance after validation and before the validity gate');
  }
  const stepsSwitch = workflow['142'];
  if (!stepsSwitch || stepsSwitch.class_type !== 'ComfySwitchNode' || !isLink(stepsSwitch.inputs.switch, '146', 0) || !isLink(stepsSwitch.inputs.on_false, '143', 0) || !isLink(stepsSwitch.inputs.on_true, '144', 0)) {
    throw workflowError('the active steps switch must remain node 142 with node 146 selecting node 143 or node 144');
  }
  const sampler = workflow['125'];
  if (!sampler || sampler.class_type !== 'SamplerCustomAdvanced' || !isLink(sampler.inputs.sigmas, '124', 0)) {
    throw workflowError('node 125 must consume the BasicScheduler sigmas output from node 124');
  }
  const samplerSelector = workflow['123'];
  if (!samplerSelector || samplerSelector.class_type !== 'KSamplerSelect' || samplerSelector.inputs.sampler_name !== 'res_multistep' || !isLink(sampler.inputs.sampler, '123', 0)) {
    throw workflowError('node 125 must use node 123 KSamplerSelect with sampler_name res_multistep');
  }
  const lightningToggle = workflow['146'];
  if (!lightningToggle || lightningToggle.class_type !== 'PrimitiveBoolean' || lightningToggle.inputs.value !== false) {
    throw workflowError('node 146 must keep Lightning LoRA disabled so node 143 is the active steps input');
  }
  return workflow;
}

export interface H3StepsTrace {
  schedulerNodeId: string;
  schedulerClassType: string;
  schedulerStepsInput: [string, number];
  schedulerOutputToSampler: [string, number];
  samplerNodeId: string;
  samplerClassType: string;
  samplerSigmasInput: [string, number];
  samplerSelectorNodeId: string;
  samplerSelectorClassType: string;
  samplerName: string;
  switchNodeId: string;
  switchClassType: string;
  switchInput: [string, number];
  selectorNodeId: string;
  selectorClassType: string;
  selectorValue: boolean;
  falseBranch: { nodeId: string; classType: string; output: [string, number]; value: number };
  trueBranch: { nodeId: string; classType: string; output: [string, number]; value: number };
  selectedBranch: 'on_false' | 'on_true';
  selectedBranchInput: [string, number];
  effectiveSteps: number;
}

function requiredWorkflowLink(value: ComfyWorkflowInput, expectedNodeId: string, expectedOutput: number, description: string): [string, number] {
  if (!isLink(value, expectedNodeId, expectedOutput)) throw workflowError(`${description} must link to node ${expectedNodeId} output ${expectedOutput}`);
  return [expectedNodeId, expectedOutput];
}

function primitiveIntegerValue(workflow: ComfyApiWorkflow, nodeId: string, description: string): { classType: string; value: number } {
  const node = workflow[nodeId];
  if (!node || node.class_type !== 'PrimitiveInt' || !Number.isInteger(node.inputs.value)) throw workflowError(`${description} must be a PrimitiveInt with an integer value`);
  return { classType: node.class_type, value: node.inputs.value as number };
}

/**
 * Evaluates the current 124 → 142 → 143/144 step graph after placeholders
 * have been injected. This is deliberately a graph trace, not a direct
 * assumption that node 143 is the sampler input.
 */
export function traceMiniMaxH3EffectiveSteps(workflow: ComfyApiWorkflow): H3StepsTrace {
  const scheduler = workflow['124'];
  if (!scheduler || scheduler.class_type !== 'BasicScheduler') throw workflowError('node 124 must be BasicScheduler for the steps trace');
  const schedulerStepsInput = requiredWorkflowLink(scheduler.inputs.steps, '142', 0, 'node 124 input steps');
  const sampler = workflow['125'];
  if (!sampler || sampler.class_type !== 'SamplerCustomAdvanced') throw workflowError('node 125 must be SamplerCustomAdvanced for the steps trace');
  const samplerSigmasInput = requiredWorkflowLink(sampler.inputs.sigmas, '124', 0, 'node 125 sigmas input');
  const samplerSelectorInput = requiredWorkflowLink(sampler.inputs.sampler, '123', 0, 'node 125 sampler input');
  const samplerSelector = workflow['123'];
  if (!samplerSelector || samplerSelector.class_type !== 'KSamplerSelect' || typeof samplerSelector.inputs.sampler_name !== 'string' || !samplerSelector.inputs.sampler_name.trim()) throw workflowError('node 123 must be KSamplerSelect with a sampler_name for the steps trace');
  const stepsSwitch = workflow['142'];
  if (!stepsSwitch || stepsSwitch.class_type !== 'ComfySwitchNode') throw workflowError('node 142 must be ComfySwitchNode for the steps trace');
  const switchInput = requiredWorkflowLink(stepsSwitch.inputs.switch, '146', 0, 'node 142 switch input');
  const selector = workflow['146'];
  if (!selector || selector.class_type !== 'PrimitiveBoolean' || typeof selector.inputs.value !== 'boolean') throw workflowError('node 146 must be PrimitiveBoolean with a boolean value for the steps trace');
  const selectorValue = selector.inputs.value;
  const falseBranchInput = requiredWorkflowLink(stepsSwitch.inputs.on_false, '143', 0, 'node 142 on_false input');
  const trueBranchInput = requiredWorkflowLink(stepsSwitch.inputs.on_true, '144', 0, 'node 142 on_true input');
  const falseValue = primitiveIntegerValue(workflow, '143', 'node 142 on_false source');
  const trueValue = primitiveIntegerValue(workflow, '144', 'node 142 on_true source');
  const selectedBranch = selectorValue ? 'on_true' : 'on_false';
  const selectedBranchInput = selectorValue ? trueBranchInput : falseBranchInput;
  const effectiveSteps = selectorValue ? trueValue.value : falseValue.value;
  if (effectiveSteps < 1) throw workflowError('the selected H3 sampling steps value must be positive');
  return {
    schedulerNodeId: '124',
    schedulerClassType: scheduler.class_type,
    schedulerStepsInput,
    schedulerOutputToSampler: samplerSigmasInput,
    samplerNodeId: '125',
    samplerClassType: sampler.class_type,
    samplerSigmasInput,
    samplerSelectorNodeId: samplerSelectorInput[0],
    samplerSelectorClassType: samplerSelector.class_type,
    samplerName: samplerSelector.inputs.sampler_name,
    switchNodeId: '142',
    switchClassType: stepsSwitch.class_type,
    switchInput,
    selectorNodeId: '146',
    selectorClassType: selector.class_type,
    selectorValue,
    falseBranch: { nodeId: '143', classType: falseValue.classType, output: falseBranchInput, value: falseValue.value },
    trueBranch: { nodeId: '144', classType: trueValue.classType, output: trueBranchInput, value: trueValue.value },
    selectedBranch,
    selectedBranchInput,
    effectiveSteps
  };
}

export function resolveH3Resolution(aspectRatio: string, megapixels: number, multiple: number): H3Resolution {
  const ratio = comfyAspectRatios[aspectRatio.trim()];
  if (!ratio) throw new Error(`H3 aspect ratio ${aspectRatio || '(empty)'} is not supported by workflow node 115 (ResolutionSelector).`);
  if (!Number.isFinite(megapixels) || megapixels < 0.1 || megapixels > 16) throw new Error('H3 megapixels must be between 0.1 and 16.');
  if (!Number.isInteger(multiple) || multiple < 8 || multiple > 128 || multiple % 4 !== 0) throw new Error('H3 resolution multiple must be an integer from 8 to 128 in steps of 4.');
  const totalPixels = megapixels * 1024 * 1024;
  const scale = Math.sqrt(totalPixels / (ratio.widthRatio * ratio.heightRatio));
  return {
    selectorValue: ratio.selectorValue,
    width: Math.round(ratio.widthRatio * scale / multiple) * multiple,
    height: Math.round(ratio.heightRatio * scale / multiple) * multiple
  };
}

function validateH3Seed(seed: number): void {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('H3 seed must be a non-negative safe integer.');
}

/** Validates editable settings and resolves every derived value before submit. */
export function validateH3WorkflowSettings(settings: H3WorkflowSettings): H3WorkflowSettingsSnapshot {
  if (!Number.isFinite(settings.durationSeconds) || settings.durationSeconds < 4 || settings.durationSeconds > 15) throw new Error('H3 duration must be between 4 and 15 seconds.');
  if (settings.fps !== 24) throw new Error('The configured MiniMax H3 workflow requires 24 FPS.');
  if (!Number.isInteger(settings.steps) || settings.steps < 1) throw new Error('H3 steps must be a positive integer.');
  if (!minimaxH3SchedulerValues.includes(settings.scheduler)) throw new Error('MiniMax H3 scheduler must be simple, normal, or beta.');
  if (!h3SeedModeOptions.includes(settings.seedMode)) throw new Error('H3 seed mode must be random or fixed.');
  validateH3Seed(settings.seed);
  if (!minimaxH3ReferenceImageSizeValues.includes(settings.refImageSize)) throw new Error('MiniMax H3 ref_image_size must be match or max.');
  const resolution = resolveH3Resolution(settings.aspectRatio, settings.megapixels, settings.multiple);
  const frameLength = 5 + 17 * Math.ceil((settings.durationSeconds * settings.fps - 5) / 17);
  return {
    ...settings,
    frameLength,
    resolvedWidth: resolution.width,
    resolvedHeight: resolution.height
  };
}

/** Reads the canonical defaults embedded in the current API workflow export. */
export function readH3WorkflowTemplateDefaults(value: unknown): H3WorkflowSettings {
  const workflow = validateMiniMaxH3ApiWorkflowTemplate(value);
  const metadata = workflow['115']?._meta;
  if (!isRecord(metadata) || !isRecord(metadata.proya_h3_workflow_defaults)) {
    throw workflowError('node 115 is missing _meta.proya_h3_workflow_defaults');
  }
  const candidate = metadata.proya_h3_workflow_defaults as unknown as H3WorkflowSettings;
  const snapshot = validateH3WorkflowSettings(candidate);
  return {
    durationSeconds: snapshot.durationSeconds,
    aspectRatio: snapshot.aspectRatio,
    megapixels: snapshot.megapixels,
    multiple: snapshot.multiple,
    fps: snapshot.fps,
    steps: snapshot.steps,
    scheduler: snapshot.scheduler,
    seedMode: snapshot.seedMode,
    seed: snapshot.seed,
    refImageSize: snapshot.refImageSize
  };
}

/** Canonical initial/reset defaults; sourced from workflows/minimax-h3-api.json. */
export const h3WorkflowTemplateDefaults: H3WorkflowSettings = readH3WorkflowTemplateDefaults(bundledMinimaxH3WorkflowTemplate);

/** Renderer-safe random seed source used for a new random-mode submission. */
export function createH3WorkflowSeed(): number {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }
  return (Date.now() ^ Math.floor(Math.random() * 4_294_967_296)) >>> 0;
}

export interface H3WorkflowMappingInspection {
  setting: string;
  appValue: string;
  node: string;
  intermediateTransformation: string;
  finalInjectedValue: string;
}

/** Human-readable pre-submit map for the exact current workflow graph. */
export function buildH3WorkflowMappingInspection(settings: H3WorkflowSettingsSnapshot): H3WorkflowMappingInspection[] {
  const resolution = resolveH3Resolution(settings.aspectRatio, settings.megapixels, settings.multiple);
  return [
    { setting: 'Duration', appValue: `${settings.durationSeconds} sec`, node: '131.expression → 136.length', intermediateTransformation: 'duration × 24 → H3 17k+5 frame grid', finalInjectedValue: `${settings.frameLength} frames` },
    { setting: 'Aspect Ratio', appValue: settings.aspectRatio, node: '115.aspect_ratio', intermediateTransformation: 'ResolutionSelector label expansion', finalInjectedValue: resolution.selectorValue },
    { setting: 'Megapixels', appValue: `${settings.megapixels} MP`, node: '115.megapixels', intermediateTransformation: 'ResolutionSelector pixel budget', finalInjectedValue: String(settings.megapixels) },
    { setting: 'Multiple', appValue: String(settings.multiple), node: '115.multiple', intermediateTransformation: 'ResolutionSelector dimension rounding', finalInjectedValue: String(settings.multiple) },
    { setting: 'FPS', appValue: `${settings.fps} FPS`, node: '130.fps', intermediateTransformation: 'none', finalInjectedValue: String(settings.fps) },
    { setting: 'Steps', appValue: String(settings.steps), node: '124.steps', intermediateTransformation: '146=false → 142.on_false → 143.value → 142.output 0', finalInjectedValue: `${settings.steps} effective sampling steps` },
    { setting: 'Scheduler', appValue: settings.scheduler, node: '124.scheduler', intermediateTransformation: 'none', finalInjectedValue: settings.scheduler },
    { setting: 'Seed', appValue: settings.seedMode === 'fixed' ? `Fixed ${settings.seed}` : 'Random', node: '129.noise_seed', intermediateTransformation: settings.seedMode === 'random' ? 'fresh valid seed generated at submission' : 'none', finalInjectedValue: String(settings.seed) },
    { setting: 'Ref Image Size', appValue: settings.refImageSize, node: '136.ref_image_size', intermediateTransformation: 'none', finalInjectedValue: settings.refImageSize }
  ];
}

export function validateMiniMaxH3GenerationRequest(request: RemoteH3GenerationRequest): H3Resolution {
  const hasAutonomousBrief = Boolean(request.generationBrief && request.generationBriefText?.trim());
  if (!hasAutonomousBrief && !request.prompt?.trim()) throw new Error('H3 generation requires a structured generation brief.');
  if (request.mode !== 'REF2VA') throw new Error(`The configured workflow is MiniMax H3 Ref2VA, but the request resolved ${request.mode}. REF2VA is locked for this workflow.`);
  if (!Number.isFinite(request.duration) || request.duration < 4 || request.duration > 15) throw new Error('H3 duration must be between 4 and 15 seconds.');
  if (request.fps !== 24) throw new Error('The configured MiniMax H3 workflow requires 24 FPS.');
  const expectedFrames = 5 + 17 * Math.ceil((request.duration * request.fps - 5) / 17);
  if (!Number.isInteger(request.frames) || request.frames !== expectedFrames) throw new Error(`H3 frame count must be ${expectedFrames} for ${request.duration} seconds at 24 FPS.`);
  if (request.firstFrame || request.lastFrame || request.firstFramePath || request.lastFramePath) throw new Error('The configured Ref2VA workflow does not expose first-frame or last-frame inputs. Use a matching I2VA/FL2VA/L2VA API workflow for endpoint frames.');
  if (request.refImageSize !== undefined && !minimaxH3ReferenceImageSizeValues.includes(request.refImageSize)) throw new Error('MiniMax H3 ref_image_size must be match or max.');
  if (request.scheduler !== undefined && !minimaxH3SchedulerValues.includes(request.scheduler)) throw new Error('MiniMax H3 scheduler must be simple, normal, or beta.');
  if (request.steps !== undefined && (!Number.isInteger(request.steps) || request.steps < 1)) throw new Error('H3 steps must be a positive integer.');
  if (request.seed !== undefined) validateH3Seed(request.seed);
  if (request.promptEngine) {
    validateH3PromptEngineSettings(request.promptEngine);
  }
  if (request.generationBrief) {
    if (request.generationBrief.workflowMode !== 'REF2VA') throw new Error('The H3 generation brief must keep workflow mode REF2VA.');
    if (request.generationBrief.duration !== request.duration || request.generationBrief.aspectRatio !== request.aspectRatio) throw new Error('H3 generation brief target values do not match the direct workflow settings.');
    const expectedManifest = request.generationBrief.mediaManifest?.trim();
    if (!expectedManifest) throw new Error('The autonomous H3 generation brief is missing its authoritative media_manifest contract.');
    if (request.mediaManifest?.trim() && request.mediaManifest.trim() !== expectedManifest) throw new Error('H3 media_manifest does not match the generation brief contract.');
    if (request.allowedReferenceLabels && JSON.stringify(request.allowedReferenceLabels) !== JSON.stringify(request.generationBrief.allowedReferenceLabels)) throw new Error('H3 allowed reference labels do not match the generation brief contract.');
  }
  if (request.workflowSettings) {
    const snapshot = validateH3WorkflowSettings(request.workflowSettings);
    if (request.duration !== snapshot.durationSeconds || request.frames !== snapshot.frameLength) throw new Error('H3 request values do not match its workflow settings snapshot for duration or frame length.');
    if (request.aspectRatio !== snapshot.aspectRatio || request.megapixels !== snapshot.megapixels || request.multiple !== snapshot.multiple || request.fps !== snapshot.fps) throw new Error('H3 request values do not match its workflow settings snapshot.');
    if (request.steps !== undefined && request.steps !== snapshot.steps) throw new Error('H3 request steps do not match its workflow settings snapshot.');
    if (request.scheduler !== undefined && request.scheduler !== snapshot.scheduler) throw new Error('H3 request scheduler does not match its workflow settings snapshot.');
    if (request.refImageSize !== undefined && request.refImageSize !== snapshot.refImageSize) throw new Error('H3 request ref_image_size does not match its workflow settings snapshot.');
    if (request.seed !== undefined && request.seed !== snapshot.seed) throw new Error('H3 request seed does not match its workflow settings snapshot.');
  }
  const referenceImages = request.referenceImages?.filter((reference) => Boolean(
    reference.filename?.trim()
    || reference.path?.trim()
    || reference.remoteFilename?.trim()
    || reference.localPath?.trim()
  )) ?? [];
  if (referenceImages.length > minimaxH3ReferenceImageLimit) throw new Error(`The configured Ref2VA workflow supports at most ${minimaxH3ReferenceImageLimit} reference image slots.`);
  if (request.generationBrief) {
    const declaredPictureCount = request.generationBrief.references.filter((reference) => reference.source !== 'none').length;
    const physicalPictureCount = referenceImages.length || (request.productReference?.trim() || request.productReferencePath?.trim() ? 1 : 0);
    if (declaredPictureCount !== physicalPictureCount) throw new Error(`H3 reference contract declares ${declaredPictureCount} connected picture(s), but ${physicalPictureCount} physical reference input(s) were supplied.`);
  }
  if (request.generationBrief && !request.productReference?.trim() && !request.productReferencePath?.trim()) throw new Error('The autonomous Ref2VA workflow requires a product reference path for <Picture 1>.');
  if (!referenceImages.length && !request.productReference?.trim() && !request.productReferencePath?.trim()) throw new Error('The configured Ref2VA workflow requires {{H3_REF_IMAGE_0}}, but no local or remote reference image is available.');
  return resolveH3Resolution(request.aspectRatio, request.megapixels, request.multiple);
}

/** Validates the exact Prompt Engine contract that node 149 receives. */
export function validateH3PromptEngineSettings(settings: H3PromptEngineSettings): H3PromptEngineSettings {
  if (settings.provider !== 'lmstudio-remote') throw new Error('H3 Prompt Engine must use the remote LM Studio provider.');
  if (!isValidH3PromptEngineEndpoint(settings.endpoint)) throw new Error('H3 Prompt Engine endpoint must be http://127.0.0.1:1234/v1 on the execution PC.');
  if (settings.model !== h3PromptEngineModelId) throw new Error(`H3 Prompt Engine model is fixed to ${h3PromptEngineModelId}.`);
  if (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 2) throw new Error('H3 Prompt Engine temperature must be between 0 and 2.');
  if (!Number.isInteger(settings.repairAttempts) || settings.repairAttempts < 0 || settings.repairAttempts > 5) throw new Error('H3 Prompt Engine repair attempts must be an integer between 0 and 5.');
  if (typeof settings.disableThinking !== 'boolean') throw new Error('H3 Prompt Engine disable thinking must be a boolean.');
  if (typeof settings.unloadModelBeforeH3 !== 'boolean') throw new Error('H3 Prompt Engine unload setting must be a boolean.');
  if (!Number.isInteger(settings.timeoutSeconds) || settings.timeoutSeconds < 10 || settings.timeoutSeconds > 900) throw new Error('H3 Prompt Engine timeout must be an integer between 10 and 900 seconds.');
  return { ...settings };
}

/**
 * Normalize the autonomous request to the one supported LM Studio model. The
 * remote ComfyUI node verifies that model exists and returns the exact
 * instance ID actually used.
 */
export function normalizeAutonomousH3PromptEngineSettings(settings: H3PromptEngineSettings): H3PromptEngineSettings {
  // Autonomous prompt jobs always finalize the exact Qwen instance before the
  // validity decision. This is cleanup policy, not a user-selectable H3
  // runtime setting.
  return { ...settings, model: h3PromptEngineModelId, unloadModelBeforeH3: true };
}

/** LM Studio is intentionally reachable only through ComfyUI on the execution PC. */
export function isValidH3PromptEngineEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:'
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
      && parsed.port === '1234'
      && /^\/v1\/?$/.test(parsed.pathname)
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}
