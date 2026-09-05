import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectH3WorkflowPlaceholders, h3WorkflowPlaceholders, parseComfyApiWorkflow, prepareH3ComfyWorkflow, type H3WorkflowVariables } from './comfy-workflow';
import { minimaxH3WorkflowMappings, resolveH3Resolution, traceMiniMaxH3EffectiveSteps, validateMiniMaxH3ApiWorkflowTemplate, validateMiniMaxH3GenerationRequest } from './minimax-h3-workflow';

const variables: H3WorkflowVariables = {
  prompt: 'A precise product reveal.',
  mode: 'L2VA',
  duration: 8,
  aspectRatio: '9:16',
  width: 720,
  height: 1280,
  fps: 24,
  frames: 141,
  megapixels: 0.98,
  multiple: 32,
  seed: 42,
  firstFrame: null,
  lastFrame: null,
  productReference: 'PROYA EYE CREAM - WHITE BG - Edited.png',
  mediaManifest: '{"mode":"ref2va","items":[{"type":"picture","role":"product_identity"}],"subjects":[{"id":1,"sources":["<Picture 1>"]}]}',
  outputPrefix: 'PROYA_H3_TEST'
};

describe('ComfyUI API workflow boundary', () => {
  it('keeps the actual production placeholders, required mappings, and injector in sync', () => {
    const text = readFileSync(join(process.cwd(), 'workflows/minimax-h3-api.json'), 'utf8');
    const template = parseComfyApiWorkflow(JSON.parse(text));
    const actual = collectH3WorkflowPlaceholders(template);
    expect(text).not.toContain('H3_MAX_TOKENS');
    expect(actual).toEqual([...new Set(minimaxH3WorkflowMappings.map(({ placeholder }) => placeholder))].sort());
    expect(h3WorkflowPlaceholders).not.toContain('{{H3_MAX_TOKENS}}');
    expect(actual.every((placeholder) => (h3WorkflowPlaceholders as readonly string[]).includes(placeholder))).toBe(true);
    expect(collectH3WorkflowPlaceholders(prepareH3ComfyWorkflow(template, variables))).toEqual([]);
    template['149'].inputs.unexpected = '{{H3_UNKNOWN}}';
    expect(() => validateMiniMaxH3ApiWorkflowTemplate(template)).toThrow(/placeholder contract/);
  });

  it.each([null, 0, 8192, '{{H3_MAX_TOKENS}}'])('rejects obsolete node 149 token inputs (%s)', (value) => {
    const template = parseComfyApiWorkflow(JSON.parse(readFileSync(join(process.cwd(), 'workflows/minimax-h3-api.json'), 'utf8')));
    template['149'].inputs.max_tokens = value;
    expect(() => validateMiniMaxH3ApiWorkflowTemplate(template)).toThrow(/placeholder contract|output-token inputs/);
  });

  it('has no autonomous token mapping, fallback, or settings migration', () => {
    for (const file of ['src/domain/comfy-workflow.ts', 'src/domain/settings.ts', 'src/domain/schemas.ts', 'src/domain/types.ts', 'electron/main/compute-provider.ts']) {
      expect(readFileSync(join(process.cwd(), file), 'utf8')).not.toMatch(/H3_MAX_TOKENS|\bmaxTokens\b|8192/);
    }
  });

  it('accepts API-format node maps and replaces H3 inputs', () => {
    const workflow = prepareH3ComfyWorkflow({
      '1': { class_type: 'MiniMaxH3', inputs: { prompt: '{{H3_PROMPT}}', frames: '{{H3_FRAMES}}', mode: '{{H3_MODE}}' } },
      '2': { class_type: 'SaveVideo', inputs: { filename_prefix: '{{H3_OUTPUT_PREFIX}}' } }
    }, variables);

    expect(workflow['1'].inputs.prompt).toBe(variables.prompt);
    expect(workflow['1'].inputs.frames).toBe(variables.frames);
    expect(workflow['1'].inputs.mode).toBe(variables.mode);
    expect(workflow['2'].inputs.filename_prefix).toBe(variables.outputPrefix);
  });

  it('rejects the editor workflow shape instead of sending it to POST /prompt', () => {
    expect(() => parseComfyApiWorkflow({ nodes: [], links: [], groups: [], config: {} })).toThrow(/UI workflow JSON/);
  });

  it('requires an explicit H3 prompt placeholder', () => {
    expect(() => prepareH3ComfyWorkflow({ '1': { class_type: 'MiniMaxH3', inputs: { prompt: 'old prompt' } } }, variables)).toThrow(/H3_PROMPT/);
  });

  it('supports placeholders embedded in longer strings', () => {
    const workflow = prepareH3ComfyWorkflow({ '1': { class_type: 'MiniMaxH3', inputs: { prompt: 'prefix {{H3_PROMPT}} suffix', aspect: 'ratio={{H3_ASPECT_RATIO}}' } } }, variables);
    expect(workflow['1'].inputs.prompt).toBe('prefix A precise product reveal. suffix');
    expect(workflow['1'].inputs.aspect).toBe('ratio=9:16');
  });

  it('refuses submission when a required H3 placeholder remains unresolved', () => {
    expect(() => prepareH3ComfyWorkflow({
      '1': { class_type: 'MiniMaxH3', inputs: { prompt: '{{H3_PROMPT}}', first_frame: '{{H3_FIRST_FRAME}}' } }
    }, variables)).toThrow(/H3_FIRST_FRAME/);
  });

  it('validates and maps the exact supplied MiniMax H3 Ref2VA export', () => {
    const template = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as unknown;
    const validated = validateMiniMaxH3ApiWorkflowTemplate(template);
    expect(minimaxH3WorkflowMappings).toHaveLength(27);
    expect(validated['136'].class_type).toBe('MiniMaxH3ReferenceToVideo');

    const resolution = resolveH3Resolution('9:16', 0.98, 32);
    const workflow = prepareH3ComfyWorkflow(validated, { ...variables, aspectRatio: resolution.selectorValue, width: resolution.width, height: resolution.height });
    expect(workflow['115'].inputs).toMatchObject({ aspect_ratio: '9:16 (Portrait Widescreen)', megapixels: 0.98, multiple: 32 });
    expect(workflow['129'].inputs.noise_seed).toBe(42);
    expect(workflow['130'].inputs.fps).toBe(24);
    expect(workflow['131'].inputs.expression).toBe('141 + 0');
    expect(workflow['143'].inputs.value).toBe(20);
    expect(workflow['136'].inputs.ref_image_size).toBe('match');
    expect(workflow['136'].inputs).not.toHaveProperty('ref_images.ref_image_1');
    expect(workflow['137'].inputs.image).toBe(variables.productReference);
    expect(workflow['139'].inputs.image).toBe('');
    expect(workflow['149'].inputs.media_manifest).toEqual(['153', 0]);
    expect(workflow['149'].inputs.model).toBe('qwen/qwen3.8-27b');
    expect(workflow['150'].inputs.media_manifest).toEqual(['153', 0]);
    expect(workflow['152'].inputs.model).toEqual(['149', 8]);
    expect(workflow['152'].inputs.instance_id).toEqual(['149', 9]);
    expect(workflow['153'].inputs.value).toBe(variables.mediaManifest);
    expect(workflow['124'].inputs.scheduler).toBe('simple');
  });

  it('omits an output-token limit from the explicit node 149 prompt contract', () => {
    const template = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as unknown;
    const validated = validateMiniMaxH3ApiWorkflowTemplate(template);
    const workflow = prepareH3ComfyWorkflow(validated, {
      ...variables,
      promptTimeout: 600,
      repairAttempts: 2,
      temperature: 0.2,
      disableThinking: true
    });

    expect(workflow['149'].inputs).toMatchObject({ temperature: 0.2, timeout_seconds: 600, repair_attempts: 2, disable_thinking: true });
    expect(workflow['149'].inputs).not.toHaveProperty('max_tokens');
    expect(JSON.stringify(workflow)).not.toContain('H3_MAX_TOKENS');
  });

  it('keeps the same prompt timeout for the initial rewrite and bounded repairs', () => {
    const template = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as unknown;
    const validated = validateMiniMaxH3ApiWorkflowTemplate(template);
    const firstRequest = prepareH3ComfyWorkflow(validated, { ...variables, promptTimeout: 600, repairAttempts: 0 });
    const repairedRequest = prepareH3ComfyWorkflow(validated, { ...variables, promptTimeout: 600, repairAttempts: 2 });

    expect(firstRequest['149'].inputs.timeout_seconds).toBe(600);
    expect(repairedRequest['149'].inputs.timeout_seconds).toBe(600);
    expect(repairedRequest['149'].inputs.repair_attempts).toBe(2);
  });

  it('injects the visible steps setting into the active full-step PrimitiveInt node', () => {
    const template = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as unknown;
    const validated = validateMiniMaxH3ApiWorkflowTemplate(template);
    const workflow = prepareH3ComfyWorkflow(validated, {
      ...variables,
      steps: 36
    });

    expect(workflow['143'].inputs.value).toBe(36);
    expect(workflow['142'].inputs.on_false).toEqual(['143', 0]);
    expect(workflow['146'].inputs.value).toBe(false);
  });

  it.each([4, 20, 36])('traces UI Steps=%s through the live switch graph to the effective scheduler value', (steps) => {
    const template = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as unknown;
    const validated = validateMiniMaxH3ApiWorkflowTemplate(template);
    const workflow = prepareH3ComfyWorkflow(validated, { ...variables, steps });
    const trace = traceMiniMaxH3EffectiveSteps(workflow);

    expect(workflow['124'].inputs.steps).toEqual(['142', 0]);
    expect(trace).toMatchObject({
      schedulerNodeId: '124', schedulerClassType: 'BasicScheduler', schedulerStepsInput: ['142', 0], schedulerOutputToSampler: ['124', 0],
      samplerNodeId: '125', samplerClassType: 'SamplerCustomAdvanced', samplerSigmasInput: ['124', 0], samplerSelectorNodeId: '123', samplerSelectorClassType: 'KSamplerSelect', samplerName: 'res_multistep',
      switchNodeId: '142', switchClassType: 'ComfySwitchNode', switchInput: ['146', 0],
      selectorNodeId: '146', selectorClassType: 'PrimitiveBoolean', selectorValue: false,
      falseBranch: { nodeId: '143', classType: 'PrimitiveInt', output: ['143', 0], value: steps },
      trueBranch: { nodeId: '144', classType: 'PrimitiveInt', output: ['144', 0], value: 4 },
      selectedBranch: 'on_false', selectedBranchInput: ['143', 0], effectiveSteps: steps
    });
    expect(trace.effectiveSteps).toBe(steps);
  });

  it('keeps every visible H3 workflow value exact at the prepared ComfyUI boundary', () => {
    const template = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as unknown;
    const validated = validateMiniMaxH3ApiWorkflowTemplate(template);
    const durationSeconds = 8;
    const aspectRatio = '9:16';
    const megapixels = 0.98;
    const multiple = 32;
    const fps = 24;
    const steps = 20;
    const scheduler = 'beta' as const;
    const seed = 987654321;
    const refImageSize = 'max' as const;
    const resolution = resolveH3Resolution(aspectRatio, megapixels, multiple);
    const frameLength = 192;
    const workflow = prepareH3ComfyWorkflow(validated, {
      ...variables, duration: durationSeconds, aspectRatio: resolution.selectorValue, width: resolution.width, height: resolution.height,
      fps, frames: frameLength, megapixels, multiple, steps, scheduler, seed, refImageSize
    });
    const trace = traceMiniMaxH3EffectiveSteps(workflow);

    expect(workflow['115'].inputs).toMatchObject({ aspect_ratio: resolution.selectorValue, megapixels, multiple });
    expect(workflow['131'].inputs.expression).toBe(`${frameLength} + 0`);
    expect(workflow['130'].inputs.fps).toBe(fps);
    expect(workflow['143'].inputs.value).toBe(steps);
    expect(trace.effectiveSteps).toBe(steps);
    expect(workflow['124'].inputs.scheduler).toBe(scheduler);
    expect(workflow['129'].inputs.noise_seed).toBe(seed);
    expect(workflow['136'].inputs.ref_image_size).toBe(refImageSize);
  });

  it('rejects H3 settings that do not match the supplied Ref2VA graph', () => {
    const valid = { prompt: 'Final prompt', mode: 'REF2VA' as const, duration: 4, aspectRatio: '9:16', fps: 24, frames: 107, megapixels: 0.98, multiple: 32, firstFrame: null, lastFrame: null, productReference: 'PROYA EYE CREAM - WHITE BG - Edited.png' };
    expect(() => validateMiniMaxH3GenerationRequest({ ...valid, mode: 'T2VA' })).toThrow(/Ref2VA/);
    expect(() => validateMiniMaxH3GenerationRequest({ ...valid, frames: 106 })).toThrow(/107/);
    expect(() => validateMiniMaxH3GenerationRequest({ ...valid, aspectRatio: '2:1' })).toThrow(/ResolutionSelector/);
    expect(() => validateMiniMaxH3GenerationRequest({ ...valid, productReference: null })).toThrow(/H3_REF_IMAGE_0/);
  });

  it('keeps two ordered Ref2VA image slots independent', () => {
    const template = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as unknown;
    const validated = validateMiniMaxH3ApiWorkflowTemplate(template);
    const workflow = prepareH3ComfyWorkflow(validated, {
      ...variables,
      productReference: null,
      referenceImages: ['front.png', 'back.png'],
      refImageSize: 'max',
      scheduler: 'normal'
    });

    expect(workflow['137'].inputs.image).toBe('front.png');
    expect(workflow['139'].inputs.image).toBe('back.png');
    expect(workflow['136'].inputs['ref_images.ref_image_0']).toEqual(['137', 0]);
    expect(workflow['136'].inputs['ref_images.ref_image_1']).toEqual(['139', 0]);
    expect(workflow['136'].inputs.ref_image_size).toBe('max');
    expect(workflow['124'].inputs.scheduler).toBe('normal');
  });

  it('grows the Ref2VA image inputs for a future third role without changing the first two mappings', () => {
    const template = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as unknown;
    const validated = validateMiniMaxH3ApiWorkflowTemplate(template);
    const workflow = prepareH3ComfyWorkflow(validated, {
      ...variables,
      productReference: null,
      referenceImages: ['front.png', 'back.png', 'side.png']
    });

    expect(workflow['136'].inputs['ref_images.ref_image_0']).toEqual(['137', 0]);
    expect(workflow['136'].inputs['ref_images.ref_image_1']).toEqual(['139', 0]);
    expect(workflow['136'].inputs['ref_images.ref_image_2']).toEqual(['154', 0]);
    expect(workflow['154'].class_type).toBe('LoadImage');
    expect(workflow['154'].inputs.image).toBe('side.png');
  });
});
