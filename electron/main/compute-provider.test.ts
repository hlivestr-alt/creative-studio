import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyH3PromptEngineError, executionMetadata, extractComfyOutputs, h3PromptEngineErrorMessage, LocalComputeProvider, normalizeComfyUrl, parseComfySystemStats, parsePromptEngineDiscovery, RemoteComfyComputeProvider, type ComfyFetch, type ComfyWebSocket, type ComputeProvider } from './compute-provider';
import { calculateH3FrameLength, createOptionalH3ReferencePlan } from '../../src/domain/h3';
import { planCreativeGenome } from '../../src/domain/creative-diversity';
import { buildH3GenerationBrief, buildH3ReferenceContext, serializeH3GenerationBrief } from '../../src/domain/h3-generation-brief';
import { getProduct } from '../../src/domain/data';
import { h3PromptEngineModelId } from '../../src/domain/types';
import type { ComputeJobState, H3PromptEngineSettings, H3VideoBrief, RemoteH3GenerationRequest } from '../../src/domain/types';

let temporaryDirectory: string | undefined;
afterEach(() => { if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = undefined; });

const remotePromptId = '550e8400-e29b-41d4-a716-446655440000';
const secondRemotePromptId = '550e8400-e29b-41d4-a716-446655440001';

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    prompt: 'Final H3 direction', mode: 'REF2VA' as const, duration: 4, aspectRatio: '9:16', fps: 24, frames: 107, megapixels: 0.98, multiple: 32,
    firstFrame: null, lastFrame: null, productReference: 'PROYA EYE CREAM - WHITE BG - Edited.png', ...overrides
  };
}

const autonomousEngine: H3PromptEngineSettings = {
  provider: 'lmstudio-remote',
  endpoint: 'http://127.0.0.1:1234/v1',
  model: h3PromptEngineModelId,
  temperature: 0.2,
  repairAttempts: 2,
  disableThinking: true,
  unloadModelBeforeH3: true,
  timeoutSeconds: 600
};

function autonomousRequest(overrides: Partial<RemoteH3GenerationRequest> = {}): RemoteH3GenerationRequest {
  const product = getProduct('cleanser')!;
  const brief: H3VideoBrief = {
    product: product.id,
    contentType: 'Product B-Roll',
    creativeVariety: 'Balanced',
    videoIdea: 'A bright greenhouse product reveal with a restrained orange particle halo.',
    language: 'English',
    musicOnly: true,
    captions: false,
    subtitles: false,
    goal: 'Product reveal',
    customGoal: '',
    duration: 8,
    aspectRatio: '9:16',
    customAspectRatio: '',
    qualityPreset: 'Custom',
    megapixels: 0.98,
    multiple: 32,
    fps: 24,
    steps: 20,
    seedMode: 'fixed',
    seed: 42,
    refImageSize: 'max',
    workflowMode: 'REF2VA',
    cameraMotion: 'Cinematic',
    actionIntensity: 'High',
    pacing: 'Balanced',
    productFidelity: 'Exact',
    scheduler: 'simple',
    ending: 'Hero Shot',
    customEnding: '',
    sound: 'Music Only',
    promptDetail: 'Production',
    referenceFidelity: 'High',
    lockedProductPlateMode: 'Off',
    specialInstructions: 'Keep the tube front-facing and premium.',
    references: {
      ...createOptionalH3ReferencePlan(product),
      productReference: { source: 'selected-product', description: `${product.officialName} packaging reference`, path: 'cleanser.png' }
    }
  };
  const plan = planCreativeGenome({
    product,
    contentFamily: 'Product B-Roll',
    userIdea: brief.videoIdea,
    specialInstructions: brief.specialInstructions,
    recentHistory: [],
    variety: 'Balanced',
    seed: 42,
    generationJobId: 'autonomous-h3-test'
  });
  const generationBrief = buildH3GenerationBrief({ product, brief: { ...brief, creativeGenome: plan.genome }, genome: plan.genome });
  return {
    generationBrief,
    generationBriefText: serializeH3GenerationBrief(generationBrief),
    referenceContext: buildH3ReferenceContext(generationBrief),
    mediaManifest: generationBrief.mediaManifest,
    allowedReferenceLabels: generationBrief.allowedReferenceLabels,
    promptEngine: { ...autonomousEngine },
    systemPromptOverride: 'EXACT TEST SYSTEM PROMPT\\nKEEP THIS VERBATIM',
    mode: 'REF2VA',
    duration: 8,
    aspectRatio: '9:16',
    fps: 24,
    frames: 192,
    megapixels: 0.98,
    multiple: 32,
    steps: 20,
    seed: 42,
    firstFrame: null,
    lastFrame: null,
    productReference: 'cleanser.png',
    productReferencePath: null,
    referenceImages: [{ filename: 'cleanser.png' }],
    refImageSize: 'max',
    scheduler: 'simple',
    product: 'cleanser',
    localJobId: 'autonomous-h3-job',
    ...overrides
  };
}

function autonomousDiscoveryFetch(
  onPrompt: (payload: Record<string, unknown>) => void,
  models: string[] = [autonomousEngine.model],
  onDiscovery?: (payload: Record<string, unknown>) => void,
  promptIds: string[] = [remotePromptId]
): ComfyFetch {
  let promptIndex = 0;
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' }, devices: [{ name: 'RTX 5090' }] }), { status: 200 });
    if (url.endsWith('/object_info')) return new Response(JSON.stringify(patchedPromptEngineObjectInfo()), { status: 200 });
    if (url.endsWith('/minimax_h3_prompt_enhancer/models')) {
      onDiscovery?.(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(JSON.stringify({ models }), { status: 200 });
    }
    if (url.endsWith('/prompt')) {
      onPrompt(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const promptId = promptIds[Math.min(promptIndex++, promptIds.length - 1)] ?? remotePromptId;
      return new Response(JSON.stringify({ prompt_id: promptId, number: 1 }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
}

function patchedPromptEngineObjectInfo(): Record<string, unknown> {
  return {
    MiniMaxH3PromptEnhancer: {
      output_name: ['enhanced_prompt', 'validation_report', 'enhancement_manifest', 'duration_seconds', 'aspect_ratio', 'treatment_warnings', 'width', 'height', 'llm_model_id', 'llm_instance_id']
    },
    MiniMaxH3PromptValidator: {},
    MiniMaxH3PromptValidityGate: {},
    MiniMaxH3UnloadLMStudioModel: {
      output_name: ['prompt', 'valid', 'validation_report', 'unload_succeeded', 'unload_error', 'instance_id', 'unload_duration_ms'],
      input_order: { required: ['prompt', 'valid', 'validation_report', 'endpoint', 'model', 'instance_id', 'unload'] }
    }
  };
}

describe('RemoteComfyComputeProvider', () => {
  it('classifies prompt-engine timeout and availability failures independently', () => {
    expect(classifyH3PromptEngineError('Client disconnected. Stopping generation…')).toBe('PROMPT_GENERATION_TIMEOUT');
    expect(classifyH3PromptEngineError('LLM request timed out after 600 seconds.')).toBe('PROMPT_GENERATION_TIMEOUT');
    expect(classifyH3PromptEngineError('Cannot reach LLM endpoint http://127.0.0.1:1234/v1: connection refused')).toBe('LLM_UNAVAILABLE');
    expect(classifyH3PromptEngineError('Configured model is unavailable')).toBe('LLM_UNAVAILABLE');
    expect(classifyH3PromptEngineError('LLM endpoint returned HTTP 503: model unavailable')).toBe('LLM_UNAVAILABLE');
    expect(h3PromptEngineErrorMessage('Client disconnected. Stopping generation…', autonomousEngine)).toContain('600-second');
  });

  it('finds only the canonical Qwen model and ignores every other LM Studio model', () => {
    expect(parsePromptEngineDiscovery({ models: [] })).toMatchObject({ models: [], observedModelId: null, observedInstanceId: null, error: 'qwen/qwen3.8-27b is not available in LM Studio on the remote PC.' });
    expect(parsePromptEngineDiscovery({ models: ['qwen/a', 'qwen/b'] })).toMatchObject({ models: [], observedModelId: null, observedInstanceId: null, error: 'qwen/qwen3.8-27b is not available in LM Studio on the remote PC.' });
    expect(parsePromptEngineDiscovery({ models: ['qwen/a', 'qwen/qwen3.8-27b', 'qwen/b'], observed_model_id: 'qwen/other', observed_instance_id: 'other-instance' })).toMatchObject({ models: [h3PromptEngineModelId], observedModelId: h3PromptEngineModelId, observedInstanceId: null, error: null });
    expect(parsePromptEngineDiscovery({ models: ['qwen/a', h3PromptEngineModelId], observed_model_id: h3PromptEngineModelId, observed_instance_id: 'instance-a' })).toMatchObject({ models: [h3PromptEngineModelId], observedModelId: h3PromptEngineModelId, observedInstanceId: 'instance-a', error: null });
  });

  it('pins the upstream rewrite and repair contract to one timeout and one in-process Qwen lane', () => {
    const patchText = readFileSync(join(process.cwd(), 'patches', 'ComfyUI-MiniMax-H3-Prompt-Enhancer', '0001-proya-autonomous-h3.patch'), 'utf8');
    const transportPatchText = readFileSync(join(process.cwd(), 'patches', 'ComfyUI-MiniMax-H3-Prompt-Enhancer', '0002-proya-direct-qwen-timeout.patch'), 'utf8');
    const tokenOwnershipPatchText = readFileSync(join(process.cwd(), 'patches', 'ComfyUI-MiniMax-H3-Prompt-Enhancer', '0003-proya-lmstudio-managed-output-tokens.patch'), 'utf8');
    expect(patchText).toContain('"timeout_seconds": ("INT", {"default": 600');
    expect(tokenOwnershipPatchText).toContain('native_payload["max_output_tokens"] = int(max_tokens)');
    expect(tokenOwnershipPatchText).toContain('payload["max_tokens"] = int(max_tokens)');
    expect(tokenOwnershipPatchText).toContain('remote_max_tokens');
    expect(tokenOwnershipPatchText).toContain('"max_tokens": ("INT", {"default": 0');
    expect(patchText).toContain('with _LM_STUDIO_ENHANCEMENT_LOCK:');
    expect(transportPatchText).toContain('connection.sock.settimeout(int(read_timeout))');
    expect(transportPatchText).toContain('connect_timeout=connect_timeout, read_timeout=read_timeout');
    expect(transportPatchText).toContain('httpOverallTimeoutSeconds"] = None');
    expect(transportPatchText).not.toContain('ProxyHandler');
    expect(patchText).toContain('"instance_id"');
    expect(patchText).toContain('{"instance_id": target_instance_id}');
    expect(patchText).toContain('"unload_duration_ms"');
    expect(patchText).toContain('"proya_h3_structured_output"');
    expect(patchText).toContain('PROMPT_ENGINE_MODEL_ID = "qwen/qwen3.8-27b"');
    expect(patchText).toContain('from .prompt_enhancer import PROMPT_ENGINE_MODEL_ID, enhance_prompt');
    expect(patchText).toContain('from prompt_enhancer import PROMPT_ENGINE_MODEL_ID, enhance_prompt');
    expect(patchText).toContain('"default": PROMPT_ENGINE_MODEL_ID');
    const appliedSource = patchText.split(/\r?\n/).filter((line) => !line.startsWith('-')).join('\n');
    expect(appliedSource).not.toContain('"reasoning": "off"');
    expect(appliedSource).not.toContain('chat_template_kwargs');
    expect(appliedSource).not.toContain('reasoning_effort');
    expect(appliedSource).not.toContain('_compact_model_rank');
    expect(appliedSource).not.toContain('ambiguous prompt model');
    expect(patchText).not.toMatch(/chatgpt/i);
    expect(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')).not.toMatch(/chatgpt/i);
  });

  it('prefers structured enhancer, validator, and unload captures over raw history', () => {
    const metadata = executionMetadata({
      '149': {
        result: ['RAW ENHANCER PROMPT', 'RAW ENHANCER REPORT', JSON.stringify({ repairAttemptsUsed: 99 })],
        proya_h3_structured_output: [JSON.stringify({
           schemaVersion: 1,
           enhanced_prompt: 'STRUCTURED ENHANCED PROMPT',
           model_id: h3PromptEngineModelId,
           model_instance_id: 'exact-lmstudio-instance',
           enhancement_manifest: { repairAttemptsUsed: 2, diagnosticsDigest: 'digest-2' },
          repair_attempts_used: 2,
          rewrite_diagnostics: { repaired: true, reason: 'canonical payload' }
        })]
      },
      '150': {
        text: ['RAW VALIDATOR PROMPT', 'RAW VALIDATOR REPORT'],
        ui: {
          proya_h3_structured_output: [JSON.stringify({
            schemaVersion: 1,
            prompt: 'STRUCTURED ENHANCED PROMPT',
            valid: true,
            validation_report: 'STRUCTURED VALIDATION REPORT'
          })]
        }
      },
      '152': {
        result: ['STRUCTURED ENHANCED PROMPT', true, 'STRUCTURED VALIDATION REPORT', true, 'legacy error', 'legacy-instance', 999],
        ui: {
          proya_h3_structured_output: [JSON.stringify({
            schemaVersion: 1,
            instance_id: 'exact-lmstudio-instance',
            unload_succeeded: true,
            unload_error: null,
            unload_duration_ms: 321
          })]
        }
      }
    });

    expect(metadata).toMatchObject({
      finalEnhancedPrompt: 'STRUCTURED ENHANCED PROMPT',
      validationReport: 'STRUCTURED VALIDATION REPORT',
      repairAttemptsUsed: 2,
      promptCaptureSource: 'structured',
      validationCaptureSource: 'structured',
      llmInstanceId: 'exact-lmstudio-instance',
      llmModelId: h3PromptEngineModelId,
      llmModel: h3PromptEngineModelId,
      llmUnloadSucceeded: true,
      llmUnloadDurationMs: 321
    });
    expect(metadata.llmUnloadError).toBeNull();
    expect(JSON.parse(metadata.enhancementManifest ?? '{}')).toMatchObject({ repairAttemptsUsed: 2, diagnosticsDigest: 'digest-2' });
    expect(JSON.parse(metadata.rewriteDiagnostics ?? '{}')).toMatchObject({ repaired: true });
  });

  it('recovers the real canary text slots and records zero repairs when no structured payload exists', () => {
    const metadata = executionMetadata({
      '149': { minimax_h3_diagnostics: ['enhancer diagnostics only'] },
      '150': { text: ['CANARY FALLBACK PROMPT', 'CANARY FALLBACK REPORT'], minimax_h3_diagnostics: ['validator diagnostics'] }
    });

    expect(metadata).toMatchObject({
      finalEnhancedPrompt: 'CANARY FALLBACK PROMPT',
      validationReport: 'CANARY FALLBACK REPORT',
      repairAttemptsUsed: 0,
      promptCaptureSource: 'fallback_raw_history',
      validationCaptureSource: 'fallback_raw_history'
    });
  });

  it('keeps an explicit unload failure tied to the exact resolved LM Studio instance', () => {
    const metadata = executionMetadata({
      '152': {
        ui: {
          proya_h3_structured_output: [JSON.stringify({
            schemaVersion: 1,
            instance_id: 'exact-failed-instance',
            unload_succeeded: false,
            unload_error: 'LM Studio unload timed out',
            unload_duration_ms: 1204
          })]
        },
        result: ['PROMPT', true, 'REPORT', false, 'different raw error', 'guessed-instance', 1]
      }
    });

    expect(metadata).toMatchObject({ llmUnloadSucceeded: false, llmUnloadError: 'LM Studio unload timed out', llmInstanceId: 'exact-failed-instance', llmUnloadDurationMs: 1204 });
  });

  it('normalizes the configured endpoint and reads standard system stats shapes', () => {
    expect(normalizeComfyUrl('https://comfy.example.test///')).toBe('https://comfy.example.test');
    expect(parseComfySystemStats({ system: { comfyui_version: '0.3.50' }, devices: [{ name: 'RTX 5090', vram_total: 32_000, vram_free: 20_000 }] }, 'https://comfy.example.test', 17)).toMatchObject({ connected: true, comfyVersion: '0.3.50', gpuName: 'RTX 5090', vramTotalBytes: 32_000, vramFreeBytes: 20_000, latencyMs: 17 });
    expect(parseComfySystemStats({ cuda: { gpu: 'Fallback GPU', vram_total: 1024, vram_free: 512 } }, 'https://comfy.example.test', 3)).toMatchObject({ gpuName: 'Fallback GPU', vramTotalBytes: 1024, vramFreeBytes: 512 });
  });

  it('extracts image and video metadata into safe remote view URLs', () => {
    const outputs = extractComfyOutputs('https://comfy.example.test', {
      '7': { images: [{ filename: 'frame 001.png', subfolder: 'proya', type: 'output' }], videos: [{ filename: 'clip.mp4', subfolder: '', type: 'output' }] }
    });
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toMatchObject({ nodeId: '7', kind: 'image', filename: 'frame 001.png', subfolder: 'proya', type: 'output' });
    expect(outputs[0].url).toContain('/view?filename=frame+001.png');
    expect(outputs[1]).toMatchObject({ kind: 'video', filename: 'clip.mp4' });
  });

  it('submits the validated API graph and returns the ComfyUI prompt ID', async () => {
    const workflowPath = join(process.cwd(), 'workflows', 'minimax-h3-api.json');
    let posted: Record<string, unknown> | undefined;
    const fetchImpl: ComfyFetch = async (input, init) => {
      if (String(input).endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' }, devices: [{ name: 'RTX 5090' }] }), { status: 200 });
      posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ prompt_id: remotePromptId, number: 4 }), { status: 200 });
    };
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test/', workflowPath, fetchImpl, webSocketFactory: undefined, includeSubmissionJson: true });
    const state = await provider.submitH3({ prompt: 'Final H3 direction', mode: 'REF2VA', duration: 4, aspectRatio: '9:16', fps: 24, frames: 107, megapixels: 0.98, multiple: 32, firstFrame: null, lastFrame: null, productReference: 'PROYA EYE CREAM - WHITE BG - Edited.png', localJobId: 'local-h3-job-123' });
    const workflow = (posted?.prompt ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
    expect(state).toMatchObject({ localJobId: 'local-h3-job-123', remotePromptId, status: 'queued', queuePosition: 4, serverUrl: 'https://comfy.example.test' });
    expect(workflow['138'].inputs.value).toBe('Final H3 direction');
    expect(workflow['131'].inputs.expression).toBe('107 + 0');
    expect(workflow['115'].inputs.aspect_ratio).toBe('9:16 (Portrait Widescreen)');
    expect(workflow['137'].inputs.image).toBe('PROYA EYE CREAM - WHITE BG - Edited.png');
    expect(posted?.client_id).toEqual(expect.any(String));
    expect(posted).not.toHaveProperty('prompt_id');
    expect(JSON.parse(state.submissionJson ?? '{}')).toEqual(posted);
  });

  it('submits the visible steps and fixed seed values exactly', async () => {
    let posted: Record<string, unknown> | undefined;
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: async (input, init) => {
        if (String(input).endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), { status: 200 });
        posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ prompt_id: remotePromptId, number: 1 }), { status: 200 });
      },
      webSocketFactory: undefined,
      includeSubmissionJson: true
    });

    await provider.submitH3(validRequest({ steps: 36, seed: 987654321 }));
    const workflow = (posted?.prompt ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
    expect(workflow['143'].inputs.value).toBe(36);
    expect(workflow['129'].inputs.noise_seed).toBe(987654321);
  });

  it('runs the autonomous brief through Qwen discovery and the blocking Ref2VA graph', async () => {
    let posted: Record<string, unknown> | undefined;
    let discoveryRequest: Record<string, unknown> | undefined;
    const request = autonomousRequest();
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: autonomousDiscoveryFetch((payload) => { posted = payload; }, [autonomousEngine.model], (payload) => { discoveryRequest = payload; }),
      webSocketFactory: undefined,
      includeSubmissionJson: true
    });

    const lifecycle: ComputeJobState[] = [];
    const state = await provider.submitH3(request, (next) => lifecycle.push(next));
    const workflow = (posted?.prompt ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
    const enhancer = workflow['149'];

    expect(state).toMatchObject({ status: 'queued', pipelineStage: 'QUEUED_H3', lmStudioModelId: h3PromptEngineModelId, llmModelId: h3PromptEngineModelId, llmModel: h3PromptEngineModelId, llmTemperature: 0.2, llmTimeoutSeconds: 600, llmRepairAttempts: 2, llmDisableThinking: true, mediaManifest: request.mediaManifest, allowedReferenceLabels: request.allowedReferenceLabels, physicalReferenceMap: [{ pictureTag: '<Picture 1>', subjectTag: '<Subject 1>', physicalInput: 'ref_images.ref_image_0', nodeId: '137', uploadedFilename: 'cleanser.png' }] });
    expect(state).not.toHaveProperty('llmMaxTokens');
    expect(state).toMatchObject({ repairAttemptsConfigured: 2, llmUnloadRequested: true });
    expect(discoveryRequest).toMatchObject({ endpoint: autonomousEngine.endpoint, api_key: '', allow_remote_endpoint: false });
    expect(discoveryRequest).not.toHaveProperty('model');
    expect(discoveryRequest).not.toHaveProperty('context_length');
    expect(discoveryRequest).not.toHaveProperty('gpu');
    expect(discoveryRequest).not.toHaveProperty('offload');
    expect(discoveryRequest).not.toHaveProperty('quantization');
    expect(discoveryRequest).not.toHaveProperty('flash_attention');
    expect(discoveryRequest).not.toHaveProperty('chat_template');
    expect(discoveryRequest).not.toHaveProperty('reasoning');
    expect(workflow['147'].inputs.value).toContain('WORKFLOW MODE LOCK: REF2VA.');
    expect(workflow['148'].inputs.value).toContain('<Picture 1>');
    expect(enhancer.inputs.basic_prompt).toEqual(['147', 0]);
    expect(enhancer.inputs.reference_context).toEqual(['148', 0]);
    expect(enhancer.inputs.media_manifest).toEqual(['153', 0]);
    expect(workflow['150'].inputs.media_manifest).toEqual(['153', 0]);
    expect(workflow['153'].inputs.value).toBe(request.mediaManifest);
    expect(enhancer.inputs.mode).toBe('ref2va');
    expect(enhancer.inputs.model).toBe(h3PromptEngineModelId);
    expect(enhancer.inputs.temperature).toBe(0.2);
    expect(enhancer.inputs).not.toHaveProperty('max_tokens');
    expect(enhancer.inputs.timeout_seconds).toBe(600);
    expect(enhancer.inputs.repair_attempts).toBe(2);
    expect(enhancer.inputs.disable_thinking).toBe(true);
    expect(enhancer.inputs.system_prompt_override).toBe(request.systemPromptOverride);
    expect(workflow['150'].inputs.prompt).toEqual(['149', 0]);
    expect(workflow['151'].inputs.valid).toEqual(['150', 1]);
    expect(workflow['152'].inputs.prompt).toEqual(['151', 0]);
    expect(workflow['152'].inputs.model).toEqual(['149', 8]);
    expect(workflow['152'].inputs.instance_id).toEqual(['149', 9]);
    expect(workflow['136'].inputs.prompt).toEqual(['152', 0]);
    expect(workflow['138'].inputs.value).toBe('');
    expect(JSON.stringify(workflow)).not.toContain('subject_definitions');
    expect(lifecycle.map((next) => next.pipelineStage)).toEqual(expect.arrayContaining(['PREPARING', 'WRITING_PROMPT', 'QUEUED_H3']));
  });

  it('repeats autonomous discovery for subsequent jobs without reselecting a model in Creative Studio', async () => {
    const modelInputs: string[] = [];
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: autonomousDiscoveryFetch((payload) => {
        const prompt = payload.prompt as Record<string, Record<string, Record<string, unknown>>>;
        modelInputs.push(String(prompt['149'].inputs.model));
      }, [autonomousEngine.model], undefined, [remotePromptId, secondRemotePromptId]),
      webSocketFactory: undefined
    });

    const first = await provider.submitH3(autonomousRequest());
    const second = await provider.submitH3(autonomousRequest({ localJobId: 'autonomous-h3-job-2' }));

    expect(first.remotePromptId).toBe(remotePromptId);
    expect(second.remotePromptId).toBe(secondRemotePromptId);
    expect(modelInputs).toEqual([h3PromptEngineModelId, h3PromptEngineModelId]);
  });

  it('propagates the requested duration through brief, enhancer, validator, and native H3 frame nodes', async () => {
    let posted: Record<string, unknown> | undefined;
    const base = autonomousRequest();
    const duration = 15;
    const frames = calculateH3FrameLength(duration);
    const generationBrief = { ...base.generationBrief!, duration };
    const request = {
      ...base,
      generationBrief,
      generationBriefText: serializeH3GenerationBrief(generationBrief),
      referenceContext: buildH3ReferenceContext(generationBrief),
      mediaManifest: generationBrief.mediaManifest,
      allowedReferenceLabels: generationBrief.allowedReferenceLabels,
      duration,
      frames
    };
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: autonomousDiscoveryFetch((payload) => { posted = payload; }),
      webSocketFactory: undefined,
      includeSubmissionJson: true
    });

    await provider.submitH3(request);
    const workflow = (posted?.prompt ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
    expect(workflow['147'].inputs.value).toContain('Target duration seconds: 15');
    expect(workflow['149'].inputs.duration_seconds).toBe(15);
    expect(workflow['149'].inputs.frame_count).toBe(frames);
    expect(workflow['150'].inputs.duration_seconds).toBe(15);
    expect(workflow['150'].inputs.frame_count).toBe(frames);
    expect(workflow['131'].inputs.expression).toBe(`${frames} + 0`);
    expect(workflow['136'].inputs.length).toEqual(['131', 1]);
  });

  it('fails closed before H3 when LM Studio exposes zero prompt models', async () => {
    let promptPosted = false;
    const lifecycle: ComputeJobState[] = [];
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: autonomousDiscoveryFetch(() => { promptPosted = true; }, []),
      webSocketFactory: undefined
    });

    await expect(provider.submitH3(autonomousRequest(), (next) => lifecycle.push(next))).rejects.toThrow('qwen/qwen3.8-27b is not available in LM Studio on the remote PC.');
    expect(lifecycle.at(-1)).toMatchObject({ status: 'failed', pipelineStage: 'LLM_UNAVAILABLE', failureStage: 'LLM_UNAVAILABLE' });
    expect(promptPosted).toBe(false);
  });

  it('ignores every other LM Studio model when the canonical target is present', async () => {
    let promptPosted = false;
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: autonomousDiscoveryFetch(() => { promptPosted = true; }, [h3PromptEngineModelId, 'qwen/a', 'qwen/b']),
      webSocketFactory: undefined
    });

    const state = await provider.submitH3(autonomousRequest());
    expect(state).toMatchObject({ status: 'queued', lmStudioModelId: h3PromptEngineModelId, llmModelId: h3PromptEngineModelId });
    expect(promptPosted).toBe(true);
  });

  it('reports a stopped LM Studio instance as LLM_UNAVAILABLE before H3 can queue', async () => {
    let promptPosted = false;
    const lifecycle: ComputeJobState[] = [];
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), { status: 200 });
        if (url.endsWith('/object_info')) return new Response(JSON.stringify(patchedPromptEngineObjectInfo()), { status: 200 });
        if (url.endsWith('/minimax_h3_prompt_enhancer/models')) return new Response('LM Studio stopped', { status: 503 });
        if (url.endsWith('/prompt')) promptPosted = true;
        return new Response(JSON.stringify({}), { status: 200 });
      },
      webSocketFactory: undefined
    });

    await expect(provider.submitH3(autonomousRequest(), (next) => lifecycle.push(next))).rejects.toThrow(/LM Studio discovery/);
    expect(lifecycle.at(-1)).toMatchObject({ status: 'failed', pipelineStage: 'LLM_UNAVAILABLE', failureStage: 'LLM_UNAVAILABLE' });
    expect(promptPosted).toBe(false);
  });

  it('blocks autonomous submission when the patched gate or unload node is missing', async () => {
    let discoveryCalled = false;
    let promptPosted = false;
    const lifecycle: ComputeJobState[] = [];
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), { status: 200 });
        if (url.endsWith('/object_info')) return new Response(JSON.stringify({ MiniMaxH3PromptEnhancer: {}, MiniMaxH3PromptValidator: {} }), { status: 200 });
        if (url.endsWith('/minimax_h3_prompt_enhancer/models')) { discoveryCalled = true; return new Response(JSON.stringify({ models: [autonomousEngine.model] }), { status: 200 }); }
        if (url.endsWith('/prompt')) promptPosted = true;
        return new Response(JSON.stringify({}), { status: 200 });
      },
      webSocketFactory: undefined
    });

    await expect(provider.submitH3(autonomousRequest(), (next) => lifecycle.push(next))).rejects.toThrow(/apply the Proya autonomous-H3 patch/);
    expect(lifecycle.at(-1)).toMatchObject({ status: 'failed', pipelineStage: 'PROMPT_GENERATION_FAILED', failureStage: 'PROMPT_GENERATION_FAILED' });
    expect(discoveryCalled).toBe(false);
    expect(promptPosted).toBe(false);
  });

  it('marks a reference upload failure and never queues the autonomous graph', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-comfy-autonomous-upload-'));
    const localPath = join(temporaryDirectory, 'cleanser.png');
    writeFileSync(localPath, Buffer.from('reference-image-fixture'));
    let promptPosted = false;
    const lifecycle: ComputeJobState[] = [];
    const request = autonomousRequest({
      productReferencePath: localPath,
      referenceImages: [{ localPath }],
      productReference: null
    });
    const fetchImpl: ComfyFetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), { status: 200 });
      if (url.endsWith('/object_info')) return new Response(JSON.stringify(patchedPromptEngineObjectInfo()), { status: 200 });
      if (url.endsWith('/minimax_h3_prompt_enhancer/models')) return new Response(JSON.stringify({ models: [autonomousEngine.model] }), { status: 200 });
      if (url.endsWith('/upload/image')) return new Response('upload failed', { status: 503 });
      if (url.endsWith('/prompt')) promptPosted = true;
      return new Response(JSON.stringify({}), { status: 200 });
    };
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'), fetchImpl, webSocketFactory: undefined, localReferenceRoots: [temporaryDirectory] });

    await expect(provider.submitH3(request, (next) => lifecycle.push(next))).rejects.toThrow(/upload failed/);
    expect(lifecycle.at(-1)).toMatchObject({ status: 'failed', pipelineStage: 'REFERENCE_UPLOAD_FAILED', failureStage: 'REFERENCE_UPLOAD_FAILED' });
    expect(promptPosted).toBe(false);
  });

  it('marks ComfyUI queue rejection as H3_QUEUE_FAILED after prompt-engine setup', async () => {
    let promptPosted = false;
    const lifecycle: ComputeJobState[] = [];
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), { status: 200 });
        if (url.endsWith('/object_info')) return new Response(JSON.stringify(patchedPromptEngineObjectInfo()), { status: 200 });
        if (url.endsWith('/minimax_h3_prompt_enhancer/models')) return new Response(JSON.stringify({ models: [autonomousEngine.model] }), { status: 200 });
        if (url.endsWith('/prompt')) {
          promptPosted = Boolean(init?.body);
          return new Response(JSON.stringify({ error: { message: 'queue rejected for test' } }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      },
      webSocketFactory: undefined
    });

    await expect(provider.submitH3(autonomousRequest(), (next) => lifecycle.push(next))).rejects.toThrow(/queue rejected/);
    expect(lifecycle.at(-1)).toMatchObject({ status: 'failed', pipelineStage: 'H3_QUEUE_FAILED', failureStage: 'H3_QUEUE_FAILED' });
    expect(promptPosted).toBe(true);
  });

  it('rejects a malformed ComfyUI prompt ID instead of adopting a local identifier', async () => {
    let posted: Record<string, unknown> | undefined;
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: async (input, init) => {
        if (String(input).endsWith('/system_stats')) return new Response(JSON.stringify({}), { status: 200 });
        posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ prompt_id: 'legacy-local-job-123', number: 1 }), { status: 200 });
      },
      webSocketFactory: undefined
    });

    await expect(provider.submitH3({ ...validRequest(), localJobId: 'legacy-local-job-123' })).rejects.toThrow(/canonical prompt UUID/);
    expect(posted).not.toHaveProperty('prompt_id');
    await expect(provider.getJobState('legacy-local-job-123')).rejects.toThrow(/canonical prompt UUID/);
  });

  it('uploads one local reference into Picture 1 only and disconnects Picture 2', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-comfy-upload-'));
    const localPath = join(temporaryDirectory, 'serum.png');
    writeFileSync(localPath, Buffer.from('reference-image-fixture'));
    let uploadCount = 0;
    let posted: Record<string, unknown> | undefined;
    const fetchImpl: ComfyFetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), { status: 200 });
      if (url.endsWith('/upload/image')) {
        uploadCount += 1;
        const form = init?.body as FormData;
        const image = form.get('image') as File;
        expect(image.name).toMatch(/^PROYA_H3_REF_serum_[a-f0-9]{16}\.png$/);
        expect(form.get('type')).toBe('input');
        expect(form.get('overwrite')).toBe('false');
        return new Response(JSON.stringify({ name: 'uploaded-serum.png', subfolder: '', type: 'input' }), { status: 200 });
      }
      posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ prompt_id: remotePromptId, number: 1 }), { status: 200 });
    };
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'), fetchImpl, webSocketFactory: undefined, localReferenceRoots: [temporaryDirectory], includeSubmissionJson: true });
    const state = await provider.submitH3(validRequest({ product: 'serum', productReference: null, productReferencePath: localPath }));
    const workflow = (posted?.prompt ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
    expect(uploadCount).toBe(1);
    expect(workflow['137'].inputs.image).toBe('uploaded-serum.png');
    expect(workflow['139'].inputs.image).toBe('');
    expect(workflow['136'].inputs).not.toHaveProperty('ref_images.ref_image_1');
    expect(JSON.stringify(posted)).not.toContain(localPath);
    expect(state).toMatchObject({ localJobId: null, remotePromptId, remoteUploadedFilename: 'uploaded-serum.png', referenceUploads: [{ sourcePath: localPath, filename: 'uploaded-serum.png' }] });
  });

  it('submits two independent remote reference filenames in connection order', async () => {
    let posted: Record<string, unknown> | undefined;
    const fetchImpl: ComfyFetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), { status: 200 });
      posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ prompt_id: remotePromptId, number: 1 }), { status: 200 });
    };
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'), fetchImpl, webSocketFactory: undefined, includeSubmissionJson: true });
    await provider.submitH3(validRequest({ productReference: null, referenceImages: [{ filename: 'front.png' }, { filename: 'back.png' }], refImageSize: 'max', scheduler: 'beta' }));
    const workflow = (posted?.prompt ?? {}) as Record<string, Record<string, Record<string, unknown>>>;

    expect(workflow['137'].inputs.image).toBe('front.png');
    expect(workflow['139'].inputs.image).toBe('back.png');
    expect(workflow['136'].inputs['ref_images.ref_image_0']).toEqual(['137', 0]);
    expect(workflow['136'].inputs['ref_images.ref_image_1']).toEqual(['139', 0]);
    expect(workflow['136'].inputs.ref_image_size).toBe('max');
    expect(workflow['124'].inputs.scheduler).toBe('beta');
  });

  it('uploads an explicitly authorized file outside configured reference folders', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-comfy-upload-'));
    const configuredDirectory = join(temporaryDirectory, 'configured');
    const desktopDirectory = join(temporaryDirectory, 'Desktop');
    mkdirSync(configuredDirectory, { recursive: true });
    mkdirSync(desktopDirectory, { recursive: true });
    const localPath = join(desktopDirectory, 'selected.png');
    writeFileSync(localPath, Buffer.from('reference-image-fixture'));
    let uploadCount = 0;
    let posted: Record<string, unknown> | undefined;
    const fetchImpl: ComfyFetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), { status: 200 });
      if (url.endsWith('/upload/image')) {
        uploadCount += 1;
        return new Response(JSON.stringify({ name: 'explicitly-authorized.png', subfolder: '', type: 'input' }), { status: 200 });
      }
      posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ prompt_id: secondRemotePromptId, number: 1 }), { status: 200 });
    };
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'), fetchImpl, webSocketFactory: undefined, localReferenceRoots: [configuredDirectory], includeSubmissionJson: true });
    const state = await provider.submitH3(validRequest({ product: 'serum', productReference: null, productReferencePath: localPath }), undefined, { productReferencePath: realpathSync(localPath) });
    const workflow = (posted?.prompt ?? {}) as Record<string, Record<string, Record<string, unknown>>>;

    expect(uploadCount).toBe(1);
    expect(workflow['137'].inputs.image).toBe('explicitly-authorized.png');
    expect(workflow['139'].inputs.image).toBe('');
    expect(workflow['136'].inputs).not.toHaveProperty('ref_images.ref_image_1');
    expect(state.referenceUploads[0]?.sourcePath).toBe(localPath);
  });

  it('rejects a different outside file when the trusted authorization names another exact file', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-comfy-upload-'));
    const localPath = join(temporaryDirectory, 'selected.webp');
    const tamperedPath = join(temporaryDirectory, 'tampered.webp');
    writeFileSync(localPath, Buffer.from('selected-reference'));
    writeFileSync(tamperedPath, Buffer.from('tampered-reference'));
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'), fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }), webSocketFactory: undefined, localReferenceRoots: [] });

    await expect(provider.submitH3(validRequest({ productReference: null, productReferencePath: tamperedPath }), undefined, { productReferencePath: realpathSync(localPath) })).rejects.toThrow(/not the explicitly selected file/);
  });

  it('reports upload lifecycle state and never queues when reference upload fails', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-comfy-upload-'));
    const localPath = join(temporaryDirectory, 'reference.jpg');
    writeFileSync(localPath, Buffer.from('reference-image-fixture'));
    const calls: string[] = [];
    const fetchImpl: ComfyFetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({}), { status: 200 });
      if (url.endsWith('/upload/image')) return new Response('upload failed', { status: 503 });
      return new Response(JSON.stringify({ prompt_id: 'must-not-queue' }), { status: 200 });
    };
    const lifecycle: string[] = [];
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'), fetchImpl, webSocketFactory: undefined, localReferenceRoots: [temporaryDirectory] });
    await expect(provider.submitH3(validRequest({ product: 'serum', productReference: null, productReferencePath: localPath }), (state) => lifecycle.push(state.status))).rejects.toThrow(/upload failed/);
    expect(lifecycle).toEqual(expect.arrayContaining(['preparing', 'uploading_reference', 'failed']));
    expect(calls.some((url) => url.endsWith('/prompt'))).toBe(false);
  });

  it('reuses the uploaded reference for both LoadImage nodes and caches it for the session', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-comfy-upload-'));
    const localPath = join(temporaryDirectory, 'eye-cream.webp');
    writeFileSync(localPath, Buffer.from('reference-image-fixture'));
    let uploadCount = 0;
    const fetchImpl: ComfyFetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({}), { status: 200 });
      if (url.endsWith('/upload/image')) {
        uploadCount += 1;
        return new Response(JSON.stringify({ name: 'cached-reference.webp', subfolder: '', type: 'input' }), { status: 200 });
      }
      return new Response(JSON.stringify({ prompt_id: remotePromptId, number: 1 }), { status: 200 });
    };
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'), fetchImpl, webSocketFactory: undefined, localReferenceRoots: [temporaryDirectory] });
    const request = validRequest({ product: 'eye-cream', productReference: null, productReferencePath: localPath });
    await provider.submitH3(request);
    await provider.submitH3(request);
    expect(uploadCount).toBe(1);
  });

  it('maps completed history and output descriptors into a terminal job state', async () => {
    let requestedPath = '';
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: '', fetchImpl: async (input) => {
      requestedPath = String(input);
      return new Response(JSON.stringify({
        [secondRemotePromptId]: { status: { status_str: 'success', completed: true }, outputs: { '13': { videos: [{ filename: 'result.mp4', subfolder: 'proya', type: 'output' }] } } }
      }), { status: 200 });
    } });
    await expect(provider.getJobState(secondRemotePromptId)).resolves.toMatchObject({ localJobId: null, remotePromptId: secondRemotePromptId, status: 'completed', progress: 1, outputs: [{ kind: 'video', filename: 'result.mp4' }] });
    expect(requestedPath).toContain(`/history/${secondRemotePromptId}`);
  });

  it('matches WebSocket execution events by the returned remote prompt UUID', async () => {
    const socketHolder: { current: ComfyWebSocket | null } = { current: null };
    const states: Array<{ status: string; remotePromptId: string | null }> = [];
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }), { status: 200 });
        if (url.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: remotePromptId, number: 1 }), { status: 200 });
        if (url.includes(`/history/${remotePromptId}`) || url.endsWith('/queue')) return new Response(JSON.stringify({}), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200 });
      },
      webSocketFactory: () => {
        const socket: ComfyWebSocket = { onopen: null, onmessage: null, onerror: null, onclose: null, close: () => undefined };
        socketHolder.current = socket;
        return socket;
      },
      pollIntervalMs: 250
    });
    await provider.submitH3({ ...validRequest(), localJobId: 'local-h3-job-123' });
    const stop = provider.watchJob(remotePromptId, (state) => states.push({ status: state.status, remotePromptId: state.remotePromptId }));
    for (let attempt = 0; attempt < 20 && !socketHolder.current?.onmessage; attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    const activeSocket = socketHolder.current;
    if (!activeSocket) throw new Error('WebSocket was not created');
    expect(activeSocket.onmessage).toBeTypeOf('function');
    activeSocket.onmessage?.({ data: JSON.stringify({ type: 'execution_start', data: { prompt_id: secondRemotePromptId } }) });
    expect(states.at(-1)?.status).not.toBe('running');
    activeSocket.onmessage?.({ data: JSON.stringify({ type: 'execution_start', data: { prompt_id: remotePromptId } }) });
    expect(states.at(-1)).toEqual({ status: 'running', remotePromptId });
    stop();
  });

  it('preserves the Qwen prompt and validation diagnostics when H3 execution fails', async () => {
    const socketHolder: { current: ComfyWebSocket | null } = { current: null };
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: autonomousDiscoveryFetch(() => undefined),
      webSocketFactory: () => {
        const socket: ComfyWebSocket = { onopen: null, onmessage: null, onerror: null, onclose: null, close: () => undefined };
        socketHolder.current = socket;
        return socket;
      },
      pollIntervalMs: 250
    });
    await provider.submitH3(autonomousRequest());
    const states: ComputeJobState[] = [];
    const stop = provider.watchJob(remotePromptId, (next) => states.push(next));
    for (let attempt = 0; attempt < 20 && !socketHolder.current?.onmessage; attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    const socket = socketHolder.current;
    if (!socket?.onmessage) throw new Error('WebSocket was not created');
    socket.onmessage({ data: JSON.stringify({ type: 'executed', data: { prompt_id: remotePromptId, node: '149', output: { result: ['FINAL QWEN PROMPT', '', JSON.stringify({ repairAttemptsUsed: 1 })] } } }) });
    socket.onmessage({ data: JSON.stringify({ type: 'executed', data: { prompt_id: remotePromptId, node: '150', output: { result: ['FINAL QWEN PROMPT', true, 'validation passed'] } } }) });
    socket.onmessage({ data: JSON.stringify({ type: 'execution_error', data: { prompt_id: remotePromptId, node: '125', exception_message: 'H3 sampler failed for test' } }) });
    expect(states.at(-1)).toMatchObject({ status: 'failed', pipelineStage: 'H3_GENERATION_FAILED', failureStage: 'H3_GENERATION_FAILED', finalEnhancedPrompt: 'FINAL QWEN PROMPT', validationReport: 'validation passed', repairAttemptsUsed: 1 });
    stop();
  });

  it('maps a node 149 timeout to PROMPT_GENERATION_TIMEOUT and retains the effective audit', async () => {
    const socketHolder: { current: ComfyWebSocket | null } = { current: null };
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: autonomousDiscoveryFetch(() => undefined),
      webSocketFactory: () => {
        const socket: ComfyWebSocket = { onopen: null, onmessage: null, onerror: null, onclose: null, close: () => undefined };
        socketHolder.current = socket;
        return socket;
      },
      pollIntervalMs: 250
    });
    await provider.submitH3(autonomousRequest());
    const states: ComputeJobState[] = [];
    const stop = provider.watchJob(remotePromptId, (next) => states.push(next));
    for (let attempt = 0; attempt < 20 && !socketHolder.current?.onmessage; attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    const socket = socketHolder.current;
    if (!socket?.onmessage) throw new Error('WebSocket was not created');
    socket.onmessage({ data: JSON.stringify({ type: 'execution_error', data: { prompt_id: remotePromptId, node: '149', exception_message: 'Client disconnected. Stopping generation…' } }) });
    expect(states.at(-1)).toMatchObject({ status: 'failed', currentNode: '149', pipelineStage: 'PROMPT_GENERATION_TIMEOUT', failureStage: 'PROMPT_GENERATION_TIMEOUT', llmTimeoutSeconds: 600, llmRepairAttempts: 2, llmDisableThinking: true });
    expect(states.at(-1)).not.toHaveProperty('llmMaxTokens');
    expect(states.at(-1)?.llmModel ?? null).toBe(h3PromptEngineModelId);
    expect(states.at(-1)?.error).toContain('600-second');
    stop();
  });

  it('blocks H3 when the validator remains invalid after the enhancer repairs', async () => {
    const socketHolder: { current: ComfyWebSocket | null } = { current: null };
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: autonomousDiscoveryFetch(() => undefined),
      webSocketFactory: () => {
        const socket: ComfyWebSocket = { onopen: null, onmessage: null, onerror: null, onclose: null, close: () => undefined };
        socketHolder.current = socket;
        return socket;
      },
      pollIntervalMs: 250
    });
    await provider.submitH3(autonomousRequest());
    const states: ComputeJobState[] = [];
    const stop = provider.watchJob(remotePromptId, (next) => states.push(next));
    for (let attempt = 0; attempt < 20 && !socketHolder.current?.onmessage; attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    const socket = socketHolder.current;
    if (!socket?.onmessage) throw new Error('WebSocket was not created');
    socket.onmessage({ data: JSON.stringify({ type: 'executed', data: { prompt_id: remotePromptId, node: '149', output: { result: ['INVALID PROMPT', '', JSON.stringify({ repairAttemptsUsed: 2 })] } } }) });
    socket.onmessage({ data: JSON.stringify({ type: 'execution_error', data: { prompt_id: remotePromptId, node: '151', exception_message: 'invalid after all repair attempts' } }) });
    expect(states.at(-1)).toMatchObject({ status: 'failed', pipelineStage: 'PROMPT_VALIDATION_FAILED', failureStage: 'PROMPT_VALIDATION_FAILED', finalEnhancedPrompt: 'INVALID PROMPT', repairAttemptsUsed: 2 });
    stop();
  });

  it('surfaces a Qwen unload failure before H3 sampling', async () => {
    const socketHolder: { current: ComfyWebSocket | null } = { current: null };
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://comfy.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: autonomousDiscoveryFetch(() => undefined),
      webSocketFactory: () => {
        const socket: ComfyWebSocket = { onopen: null, onmessage: null, onerror: null, onclose: null, close: () => undefined };
        socketHolder.current = socket;
        return socket;
      },
      pollIntervalMs: 250
    });
    await provider.submitH3(autonomousRequest());
    const states: ComputeJobState[] = [];
    const stop = provider.watchJob(remotePromptId, (next) => states.push(next));
    for (let attempt = 0; attempt < 20 && !socketHolder.current?.onmessage; attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    const socket = socketHolder.current;
    if (!socket?.onmessage) throw new Error('WebSocket was not created');
    socket.onmessage({ data: JSON.stringify({ type: 'execution_error', data: { prompt_id: remotePromptId, node: '152', exception_message: 'LM Studio unload failed for test' } }) });
    expect(states.at(-1)).toMatchObject({ status: 'failed', pipelineStage: 'LLM_UNLOAD_FAILED', failureStage: 'LLM_UNLOAD_FAILED', error: 'LM Studio unload failed for test' });
    stop();
  });

  it('prefers the SaveVideo node 92 video when discovering completed outputs', async () => {
    const outputs = extractComfyOutputs('https://comfy.example.test', {
      '7': { images: [{ filename: 'preview.png', subfolder: '', type: 'output' }] },
      '92': { gifs: [{ filename: 'final.mp4', subfolder: 'proya', type: 'output' }] }
    });
    expect(outputs.find((output) => output.nodeId === '92')?.kind).toBe('video');
    expect(outputs.filter((output) => output.nodeId === '92')).toHaveLength(1);
  });

  it('downloads a remote output atomically and chooses a duplicate-safe local filename', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-comfy-download-'));
    const output = { nodeId: '92', kind: 'video', filename: 'result.mp4', subfolder: 'proya', type: 'output', url: '' };
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: '', fetchImpl: async (input) => {
      expect(String(input)).toContain('/view?filename=result.mp4');
      return new Response(Buffer.from('video-fixture'), { status: 200 });
    }, webSocketFactory: undefined });
    const first = await provider.downloadOutput(output, temporaryDirectory);
    const second = await provider.downloadOutput(output, temporaryDirectory);
    expect(readFileSync(first.localPath, 'utf8')).toBe('video-fixture');
    expect(readFileSync(second.localPath, 'utf8')).toBe('video-fixture');
    expect(second.localPath).toContain('result (1).mp4');
  });

  it('cleans up an interrupted output download without leaving a partial result', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-comfy-download-'));
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: '', fetchImpl: async () => { throw new Error('connection dropped'); }, webSocketFactory: undefined });
    await expect(provider.downloadOutput({ nodeId: '92', kind: 'video', filename: 'result.mp4', subfolder: '', type: 'output', url: '' }, temporaryDirectory)).rejects.toThrow(/connection dropped/);
    expect(readdirSync(temporaryDirectory)).toEqual([]);
  });

  it('keeps a malicious remote filename inside the configured output folder', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-comfy-download-'));
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: '', fetchImpl: async () => new Response(Buffer.from('video-fixture'), { status: 200 }), webSocketFactory: undefined });
    const result = await provider.downloadOutput({ nodeId: '92', kind: 'video', filename: '..', subfolder: '', type: 'output', url: '' }, temporaryDirectory);
    expect(result.localPath).toBe(join(temporaryDirectory, 'comfy-output'));
    expect(readdirSync(temporaryDirectory)).toEqual(['comfy-output']);
  });

  it('requires an explicit local reference root before uploading a source file', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-comfy-upload-'));
    const localPath = join(temporaryDirectory, 'reference.png');
    writeFileSync(localPath, Buffer.from('reference-image-fixture'));
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'), fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }), webSocketFactory: undefined });
    await expect(provider.submitH3(validRequest({ productReference: null, productReferencePath: localPath }))).rejects.toThrow(/allowed local product\/reference folder/);
  });

  it('refuses to post when the configured remote server is unavailable', async () => {
    let postAttempted = false;
    const provider = new RemoteComfyComputeProvider({
      baseUrl: 'https://unavailable.example.test',
      workflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      fetchImpl: async (_input, init) => {
        postAttempted ||= init?.method === 'POST';
        throw new Error('network unavailable');
      }
    });
    await expect(provider.submitH3({ prompt: 'Final prompt', mode: 'REF2VA', duration: 4, aspectRatio: '9:16', fps: 24, frames: 107, megapixels: 0.98, multiple: 32, firstFrame: null, lastFrame: null, productReference: 'PROYA EYE CREAM - WHITE BG - Edited.png' })).rejects.toThrow(/network unavailable/);
    expect(postAttempted).toBe(false);
  });

  it('keeps local mode from accidentally submitting a remote job', async () => {
    const provider: ComputeProvider = new LocalComputeProvider();
    await expect(provider.submitH3({ prompt: 'x', mode: 'T2VA', duration: 4, aspectRatio: '9:16', fps: 24, frames: 107, megapixels: 0.5, multiple: 32, firstFrame: null, lastFrame: null, productReference: null })).rejects.toThrow(/Local mode/);
  });
});


describe('Auto H3 provider identity and lost response integration', () => {
  it('persists submission identity before POST and adopts matching queue entry after disconnect', async () => {
    const identity = 'h3-auto-test-session-cycle-product-content-unique';
    let postCount = 0;
    let posted: Record<string, unknown> = {};
    const lifecycle: ComputeJobState[] = [];
    const provider = new RemoteComfyComputeProvider({ baseUrl: 'https://comfy.example.test', workflowPath: join(process.cwd(), 'workflows/minimax-h3-api.json'), fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }));
      if (url.endsWith('/prompt')) {
        postCount++; posted = JSON.parse(String(init?.body));
        expect(lifecycle.some(s => s.submissionJson?.includes(identity))).toBe(true);
        throw new Error('Cloudflare connection reset after acceptance');
      }
      if (url.endsWith('/queue')) return new Response(JSON.stringify({ queue_running: [[0, remotePromptId, posted.prompt, posted.extra_data]], queue_pending: [] }));
      return new Response('{}');
    } });
    const result = await provider.submitH3(validRequest({ localJobId: identity, autoJobId: identity, autoSessionId: 'session', autoCycleNumber: 2 }), state => lifecycle.push(state));
    expect(result.remotePromptId).toBe(remotePromptId);
    expect(postCount).toBe(1);
    expect(JSON.stringify(posted.prompt)).toContain(identity);
    expect(posted.extra_data).toMatchObject({ autoJobId: identity, sessionId: 'session', cycleNumber: 2 });
  });
});
