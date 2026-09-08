import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildH3WorkflowMappingInspection,
  createH3WorkflowSeed,
  h3WorkflowTemplateDefaults,
  isValidH3PromptEngineEndpoint,
  minimaxH3WorkflowMappings,
  readH3WorkflowTemplateDefaults,
  resolveH3Resolution,
  traceMiniMaxH3EffectiveSteps,
  validateH3WorkflowSettings,
  validateMiniMaxH3ApiWorkflowTemplate,
  validateMiniMaxH3GenerationRequest
} from './minimax-h3-workflow';
import type { H3WorkflowSettings } from './types';

const settings: H3WorkflowSettings = {
  durationSeconds: 8,
  aspectRatio: '9:16',
  megapixels: 0.98,
  multiple: 32,
  fps: 24,
  steps: 28,
  scheduler: 'beta',
  seedMode: 'fixed',
  seed: 9001,
  refImageSize: 'max'
};

describe('MiniMax H3 workflow settings boundary', () => {
  it('validates the current API export and maps every visible control to a real node', () => {
    const template = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as unknown;
    const workflow = validateMiniMaxH3ApiWorkflowTemplate(template);

    expect(readH3WorkflowTemplateDefaults(template)).toEqual(h3WorkflowTemplateDefaults);
    expect(minimaxH3WorkflowMappings.map((mapping) => mapping.nodeId)).toEqual(expect.arrayContaining(['115', '124', '129', '130', '131', '136', '143']));
    expect(workflow['143'].inputs.value).toBe('{{H3_STEPS}}');
    expect(workflow['142'].inputs.on_false).toEqual(['143', 0]);
    expect(workflow['146'].inputs.value).toBe(false);
    expect(workflow['149'].inputs.media_manifest).toEqual(['153', 0]);
    expect(workflow['149'].inputs.model).toBe('{{H3_LM_STUDIO_MODEL}}');
    expect(workflow['150'].inputs.media_manifest).toEqual(['153', 0]);
    expect(workflow['152'].inputs.model).toEqual(['149', 8]);
    expect(workflow['152'].inputs.instance_id).toEqual(['149', 9]);
  });

  it('derives frame length and ResolutionSelector dimensions without independent width/height inputs', () => {
    const snapshot = validateH3WorkflowSettings(settings);
    const resolution = resolveH3Resolution(settings.aspectRatio, settings.megapixels, settings.multiple);

    expect(snapshot).toMatchObject({ durationSeconds: 8, frameLength: 192, resolvedWidth: resolution.width, resolvedHeight: resolution.height, seed: 9001 });
    expect(snapshot.resolvedWidth).toBe(768);
    expect(snapshot.resolvedHeight).toBe(1344);
  });

  it('rejects values outside the active workflow ranges instead of clamping them', () => {
    expect(() => validateH3WorkflowSettings({ ...settings, steps: 0 })).toThrow(/positive integer/);
    expect(() => validateH3WorkflowSettings({ ...settings, multiple: 10 })).toThrow(/steps of 4/);
    expect(() => validateH3WorkflowSettings({ ...settings, megapixels: 0.01 })).toThrow(/between 0.1 and 16/);
    expect(() => validateH3WorkflowSettings({ ...settings, aspectRatio: '2:1' as H3WorkflowSettings['aspectRatio'] })).toThrow(/ResolutionSelector/);
    expect(() => validateH3WorkflowSettings({ ...settings, seed: 1.5 })).toThrow(/safe integer/);
  });

  it('keeps the request and effective snapshot exact at the POST boundary', () => {
    const snapshot = validateH3WorkflowSettings(settings);
    const request = {
      prompt: 'Final H3 direction',
      mode: 'REF2VA' as const,
      duration: snapshot.durationSeconds,
      aspectRatio: snapshot.aspectRatio,
      fps: snapshot.fps,
      frames: snapshot.frameLength,
      megapixels: snapshot.megapixels,
      multiple: snapshot.multiple,
      steps: snapshot.steps,
      seed: snapshot.seed,
      firstFrame: null,
      lastFrame: null,
      productReference: 'product.png',
      refImageSize: snapshot.refImageSize,
      scheduler: snapshot.scheduler,
      workflowSettings: snapshot
    };

    expect(validateMiniMaxH3GenerationRequest(request)).toMatchObject({ width: 768, height: 1344 });
    expect(() => validateMiniMaxH3GenerationRequest({ ...request, steps: 20 })).toThrow(/steps do not match/);
  });

  it('keeps hard validator output as the only gate and leaves quality diagnostics non-gating', () => {
    const template = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
    const workflow = validateMiniMaxH3ApiWorkflowTemplate(template);

    expect(workflow['152'].inputs.valid).toEqual(['150', 1]);
    expect(workflow['151'].inputs.valid).toEqual(['152', 1]);
    expect(workflow['151'].inputs.unload_succeeded).toEqual(['152', 3]);
    expect(workflow['151'].inputs).not.toHaveProperty('quality_valid');
    expect(workflow['136'].inputs.prompt).toEqual(['151', 0]);
    expect(workflow['152'].inputs.prompt).toEqual(['150', 0]);
  });

  it('exposes the pre-submit App → node → injected-value mapping', () => {
    const mapping = buildH3WorkflowMappingInspection(validateH3WorkflowSettings(settings));
    expect(mapping).toEqual(expect.arrayContaining([
      expect.objectContaining({ setting: 'Duration', node: '131.expression → 136.length', finalInjectedValue: '192 frames' }),
      expect.objectContaining({ setting: 'Aspect Ratio', node: '115.aspect_ratio', finalInjectedValue: '9:16 (Portrait Widescreen)' }),
      expect.objectContaining({ setting: 'Steps', node: '124.steps', intermediateTransformation: '146=false → 142.on_false → 143.value → 142.output 0', finalInjectedValue: '28 effective sampling steps' }),
      expect.objectContaining({ setting: 'Seed', node: '129.noise_seed', finalInjectedValue: '9001' }),
      expect.objectContaining({ setting: 'Ref Image Size', node: '136.ref_image_size', finalInjectedValue: 'max' })
    ]));
  });

  it('traces the current default step graph as a direct 143 → 142 → 124 value path', () => {
    const template = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as unknown;
    const workflow = validateMiniMaxH3ApiWorkflowTemplate(template);
    const finalWorkflow = { ...workflow, '143': { ...workflow['143'], inputs: { ...workflow['143'].inputs, value: 20 } } };
    const trace = traceMiniMaxH3EffectiveSteps(finalWorkflow);

    expect(trace.selectedBranch).toBe('on_false');
    expect(trace.selectedBranchInput).toEqual(['143', 0]);
    expect(trace.schedulerOutputToSampler).toEqual(['124', 0]);
    expect(trace.samplerNodeId).toBe('125');
    expect(trace.samplerClassType).toBe('SamplerCustomAdvanced');
    expect(trace.samplerSigmasInput).toEqual(['124', 0]);
    expect(trace.samplerSelectorNodeId).toBe('123');
    expect(trace.samplerSelectorClassType).toBe('KSamplerSelect');
    expect(trace.samplerName).toBe('res_multistep');
    expect(trace.effectiveSteps).toBe(20);
  });

  it('creates valid random-mode seeds', () => {
    const seed = createH3WorkflowSeed();
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
  });

  it('keeps LM Studio loopback-only at the intended native endpoint', () => {
    expect(isValidH3PromptEngineEndpoint('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isValidH3PromptEngineEndpoint('http://localhost:1234/v1/')).toBe(true);
    expect(isValidH3PromptEngineEndpoint('https://127.0.0.1:1234/v1')).toBe(false);
    expect(isValidH3PromptEngineEndpoint('http://127.0.0.1:5000/v1')).toBe(false);
    expect(isValidH3PromptEngineEndpoint('http://10.0.0.5:1234/v1')).toBe(false);
  });
});
