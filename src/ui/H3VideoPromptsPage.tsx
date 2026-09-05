import { Cloud, Download, ExternalLink, FolderOpen, History, RefreshCw, Server, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  applyH3WorkflowSettings,
  buildH3ReferenceSlotMappings,
  createOptionalH3ReferencePlan,
  h3AspectRatioOptions as h3AspectRatioValues,
  h3ContentTypeOptions as h3ContentTypeValues,
  h3LanguageOptions as h3LanguageValues,
  h3RefImageSizeOptions as h3RefImageSizeValues,
  h3SchedulerOptions as h3SchedulerValues,
  h3SoundOptions,
  h3WorkflowSettingsFromBrief
} from '../domain/h3';
import { buildH3GenerationBrief, buildH3ReferenceContext, serializeH3GenerationBrief } from '../domain/h3-generation-brief';
import { h3WorkflowTemplateDefaults, validateH3WorkflowSettings } from '../domain/minimax-h3-workflow';
import { defaultH3PromptEngineSettings } from '../domain/settings';
import { planCreativeGenome, resolveCreativeFamilyForH3VideoType } from '../domain/creative-diversity';
import { getProduct, products } from '../domain/data';
import { creativeVarietyOptions as creativeVarietyValues, h3PromptEngineModelId, h3PromptEngineModelLabel, type AppSettings, type ComputeJobState, type CreativeVariety, type H3PromptEngineSettings, type H3PromptEngineStatus, type H3PromptRecord, type H3ReferenceAsset, type H3ReferencePlan, type H3ReferenceSource, type H3Scheduler, type H3Sound, type H3VideoBrief, type Product, type ProductId } from '../domain/types';
import { ProductCard } from './ProductCard';
import { useApp } from './AppContext';

const defaultProductId: ProductId = 'skin-cream';
const localReferenceAccept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
const supportedLocalReferenceExtension = /\.(png|jpe?g|webp)$/i;
const maxLocalReferenceUploadBytes = 25 * 1024 * 1024;
type ReferenceSlotName = 'firstFrame' | 'lastFrame' | 'productReference' | 'styleReference';

const h3ContentTypeOptions = h3ContentTypeValues.map((value) => ({ value, label: value }));
const h3LanguageOptions = h3LanguageValues.map((value) => ({ value, label: value }));
const h3AspectRatioOptions = h3AspectRatioValues.map((value) => ({ value, label: value }));
const h3RefImageSizeOptions = h3RefImageSizeValues.map((value) => ({ value, label: value }));
const h3SchedulerOptions = h3SchedulerValues.map((value) => ({ value, label: value }));
const creativeVarietyOptions = creativeVarietyValues.map((value) => ({ value, label: value }));

export function isSupportedLocalReferenceImage(filePath: string): boolean {
  const filename = filePath.replaceAll('\\', '/').split('/').pop() ?? '';
  return supportedLocalReferenceExtension.test(filename);
}

function isAbsoluteLocalFilePath(filePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\') || filePath.startsWith('/');
}

export function localReferenceFilename(filePath: string): string {
  return filePath.replaceAll('\\', '/').split('/').pop()?.trim() || 'selected image';
}

export function createLocalProductReference(filePath: string): H3ReferenceAsset {
  const normalizedPath = filePath.trim();
  if (!normalizedPath || !isAbsoluteLocalFilePath(normalizedPath)) throw new Error('Could not access the selected local image path. Please choose the image again.');
  if (!isSupportedLocalReferenceImage(normalizedPath)) throw new Error('Product reference image must be a PNG, JPG, JPEG, or WebP file.');
  return { source: 'local-file', path: normalizedPath, description: `Local product reference: ${localReferenceFilename(normalizedPath)}` };
}

export function clearProductReference(): H3ReferenceAsset {
  return { source: 'none', description: '', path: null };
}

export function remoteProductReferencePath(asset: H3ReferenceAsset): string | null {
  if (asset.source !== 'selected-product' && asset.source !== 'local-file') return null;
  return asset.path?.trim() || null;
}

export function referenceAssetForSource(currentAsset: H3ReferenceAsset, source: H3ReferenceSource, product: Product, slot: ReferenceSlotName): H3ReferenceAsset {
  if (source === 'none') return clearProductReference();
  if (source === 'selected-product') {
    const description = slot === 'productReference'
      ? `${product.officialName} packaging reference`
      : `Selected ${product.shortName} asset as ${slot === 'firstFrame' ? 'opening' : slot === 'lastFrame' ? 'ending' : 'reference'} image`;
    return { source, description, path: product.imagePath };
  }
  if (source === 'local-file') return currentAsset.source === 'local-file' ? currentAsset : { source, description: '', path: null };
  return { source, description: currentAsset.description, path: null };
}

function createSimpleH3Brief(productId: ProductId, workflowSettings: typeof h3WorkflowTemplateDefaults = h3WorkflowTemplateDefaults): H3VideoBrief {
  const product = getProduct(productId)!;
  const references = createOptionalH3ReferencePlan(product);
  return {
    product: product.id,
    contentType: 'Cinematic Product Ad',
    creativeVariety: 'Balanced',
    videoIdea: '',
    language: 'Indonesian',
    musicOnly: false,
    captions: false,
    subtitles: false,
    goal: 'Product reveal',
    customGoal: '',
    duration: workflowSettings.durationSeconds,
    aspectRatio: workflowSettings.aspectRatio,
    customAspectRatio: '',
    qualityPreset: 'Custom',
    megapixels: workflowSettings.megapixels,
    multiple: workflowSettings.multiple,
    fps: workflowSettings.fps,
    steps: workflowSettings.steps,
    seedMode: workflowSettings.seedMode,
    seed: workflowSettings.seed,
    refImageSize: workflowSettings.refImageSize,
    workflowMode: 'REF2VA',
    cameraMotion: 'Cinematic',
    actionIntensity: 'High',
    pacing: 'Balanced',
    productFidelity: 'Exact',
    scheduler: workflowSettings.scheduler,
    ending: 'Hero Shot',
    customEnding: '',
    sound: 'Auto',
    promptDetail: 'Production',
    referenceFidelity: 'High',
    lockedProductPlateMode: 'Off',
    specialInstructions: '',
    references: { ...references, productReference: referenceAssetForSource(references.productReference, 'selected-product', product, 'productReference') }
  };
}

function createCreativeSeed(): number {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xFFFF_FFFF)) >>> 0;
}

function createCreativeGenerationJobId(seed: number): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `h3-${seed.toString(36)}-${suffix}`;
}

function generationStatusFromCompute(status: ComputeJobState['status']): H3PromptRecord['generationStatus'] {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'running') return 'running';
  return 'queued';
}

function formatStageTime(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return '—';
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} sec`;
}

function defaultPromptEngine(settings: AppSettings | null): H3PromptEngineSettings {
  return settings?.h3PromptEngine ?? { ...defaultH3PromptEngineSettings };
}

export function promptEngineStatusSnapshot(status: H3PromptEngineStatus | null): { connection: string; model: string; status: string } {
  return {
    connection: status?.lmStudioConnected ? 'Connected' : status ? 'Unavailable' : 'Checking…',
    model: h3PromptEngineModelLabel,
    status: status?.qwenReady ? 'Ready' : status ? 'Needs attention' : 'Checking…'
  };
}

function referenceRequests(plan: H3ReferencePlan, productAssetsDirectory: string): { referenceImages: Array<{ localPath?: string; filename?: string }>; productReferencePath: string | null } {
  const referenceImages: Array<{ localPath?: string; filename?: string }> = [];
  const toUploadPath = (asset: H3ReferenceAsset): string | null => {
    const path = remoteProductReferencePath(asset);
    if (!path || asset.source !== 'selected-product' || isAbsoluteLocalFilePath(path)) return path;
    return `${productAssetsDirectory.replace(/[\\/]+$/, '')}\\${localReferenceFilename(path)}`;
  };
  const productPath = toUploadPath(plan.productReference);
  for (const mapping of buildH3ReferenceSlotMappings(plan)) {
    const path = toUploadPath(mapping.asset);
    if (path) referenceImages.push({ localPath: path });
  }
  return { referenceImages, productReferencePath: productPath };
}

export function H3VideoPromptsPage() {
  const { h3History, settings: appSettings, loading, createH3Prompt, updateH3Prompt, saveSettings } = useApp();
  const [brief, setBrief] = useState<H3VideoBrief>(() => createSimpleH3Brief(defaultProductId));
  const [generatedRecordId, setGeneratedRecordId] = useState<number | null>(null);
  const [remoteJob, setRemoteJob] = useState<ComputeJobState | null>(null);
  const [promptEngineStatus, setPromptEngineStatus] = useState<H3PromptEngineStatus | null>(null);
  const [testingPromptEngine, setTestingPromptEngine] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resettingWorkflowDefaults, setResettingWorkflowDefaults] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showDebugPrompt, setShowDebugPrompt] = useState(false);
  const workflowSettingsInitialized = useRef(false);
  const restoredRemoteJobs = useRef(false);
  const localJobRef = useRef<string | null>(null);
  const generatedRecordIdRef = useRef<number | null>(null);

  const product = getProduct(brief.product) ?? products[0];
  const workflowSettings = useMemo(() => h3WorkflowSettingsFromBrief(brief), [brief]);
  const workflowSettingsPreview = useMemo(() => {
    try { return validateH3WorkflowSettings(workflowSettings); } catch { return null; }
  }, [workflowSettings]);
  const promptEngine = defaultPromptEngine(appSettings);
  const productReferenceReady = brief.references.productReference.source === 'selected-product' || brief.references.productReference.source === 'local-file';
  const canGenerate = Boolean(appSettings && workflowSettingsPreview && productReferenceReady && promptEngineStatus?.qwenReady);
  const videoOutput = remoteJob?.outputs.find((output) => output.kind === 'video' && output.nodeId === '92') ?? remoteJob?.outputs.find((output) => output.kind === 'video');

  useEffect(() => {
    if (!appSettings || workflowSettingsInitialized.current) return;
    workflowSettingsInitialized.current = true;
    setBrief((current) => applyH3WorkflowSettings(current, appSettings.h3WorkflowSettings ?? h3WorkflowTemplateDefaults));
  }, [appSettings]);

  useEffect(() => {
    generatedRecordIdRef.current = generatedRecordId;
  }, [generatedRecordId]);

  const promptEngineSettingsForDiscovery = appSettings?.h3PromptEngine;
  const remoteComfyUrlForDiscovery = appSettings?.remoteComfyUrl;

  useEffect(() => {
    if (!remoteComfyUrlForDiscovery || !promptEngineSettingsForDiscovery) return;
    void window.proya.compute.testPromptEngine(remoteComfyUrlForDiscovery, promptEngineSettingsForDiscovery)
      .then(setPromptEngineStatus)
      .catch((reason: unknown) => setPromptEngineStatus({ enhancerInstalled: false, validatorInstalled: false, requiredNodesInstalled: false, lmStudioConnected: false, models: [], observedModelId: null, observedInstanceId: null, selectedModel: null, qwenReady: false, error: reason instanceof Error ? reason.message : 'Could not inspect the remote H3 prompt engine.', checkedAt: new Date().toISOString() }))
      .finally(() => setTestingPromptEngine(false));
  }, [promptEngineSettingsForDiscovery, remoteComfyUrlForDiscovery]);

  useEffect(() => {
    const unsubscribe = window.proya.compute.onJobState((state) => {
      if (state.localJobId !== localJobRef.current) return;
      setRemoteJob((current) => ({ ...state, submissionJson: state.submissionJson ?? current?.submissionJson }));
      const recordId = generatedRecordIdRef.current;
      if (recordId !== null) {
        void updateH3Prompt(recordId, {
          generationStatus: generationStatusFromCompute(state.status),
          prompt: state.finalEnhancedPrompt ?? undefined,
          generationBrief: state.generationBrief ?? undefined,
          referenceMap: state.referenceMap,
          systemPromptHash: state.systemPromptHash,
          lmStudioModelId: state.lmStudioModelId,
          llmModelId: state.llmModelId,
          temperature: state.temperature,
          llmModel: state.llmModel,
          llmTemperature: state.llmTemperature,
          llmTimeoutSeconds: state.llmTimeoutSeconds,
          llmRepairAttempts: state.llmRepairAttempts,
          llmDisableThinking: state.llmDisableThinking,
          repairAttemptsUsed: state.repairAttemptsUsed,
          finalEnhancedPrompt: state.finalEnhancedPrompt,
          validationReport: state.validationReport,
          remotePromptId: state.remotePromptId,
          outputPath: state.localResultPath,
          pipelineStage: state.pipelineStage,
          llmUnloadRequested: state.llmUnloadRequested,
          llmUnloadSucceeded: state.llmUnloadSucceeded,
          llmUnloadError: state.llmUnloadError,
          llmInstanceId: state.llmInstanceId,
          timings: state.stageTimings
        }).catch(() => undefined);
      }
    });
    return unsubscribe;
  }, [updateH3Prompt]);

  useEffect(() => () => { void window.proya.files.clearReferenceAuthorization(); }, []);

  useEffect(() => {
    if (loading || restoredRemoteJobs.current) return;
    restoredRemoteJobs.current = true;
    void window.proya.compute.listJobs(100).then((jobs) => {
      const job = jobs.find((item) => item.promptRecordId !== null && h3History.some((record) => record.id === item.promptRecordId)) ?? jobs[0];
      if (!job) return;
      const record = job.promptRecordId === null ? null : h3History.find((item) => item.id === job.promptRecordId) ?? null;
      if (record) {
        setBrief({ ...record.brief, product: record.product, references: record.referencePlan, workflowMode: 'REF2VA' });
        setGeneratedRecordId(record.id);
      }
      localJobRef.current = job.localJobId;
      setRemoteJob(job.state);
    }).catch(() => undefined);
  }, [h3History, loading]);

  const resetSession = () => {
    setGeneratedRecordId(null);
    generatedRecordIdRef.current = null;
    localJobRef.current = null;
    setRemoteJob(null);
    setError('');
  };

  const updateBrief = <K extends keyof H3VideoBrief>(key: K, value: H3VideoBrief[K]) => {
    setBrief((current) => ({ ...current, [key]: value }));
    resetSession();
  };

  const updateMusicOnly = (enabled: boolean) => {
    setBrief((current) => ({
      ...current,
      musicOnly: enabled,
      sound: enabled ? 'Music Only' : current.sound === 'Music Only' ? 'Auto' : current.sound,
      subtitles: enabled ? false : current.subtitles
    }));
    resetSession();
  };

  const persistWorkflowSettings = (nextBrief: H3VideoBrief) => {
    if (!appSettings) return;
    try {
      const candidate = h3WorkflowSettingsFromBrief(nextBrief);
      validateH3WorkflowSettings(candidate);
      void saveSettings({ ...appSettings, h3WorkflowSettings: candidate }).catch(() => undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The H3 workflow setting is not valid.');
    }
  };

  const updateWorkflowSetting = <K extends 'duration' | 'aspectRatio' | 'megapixels' | 'multiple' | 'fps' | 'steps' | 'scheduler' | 'seedMode' | 'seed' | 'refImageSize'>(key: K, value: H3VideoBrief[K]) => {
    const nextBrief = { ...brief, [key]: value } as H3VideoBrief;
    setBrief(nextBrief);
    persistWorkflowSettings(nextBrief);
    resetSession();
  };

  const resetH3WorkflowDefaults = async () => {
    if (!appSettings || resettingWorkflowDefaults) return;
    setResettingWorkflowDefaults(true);
    try {
      const defaults = await window.proya.compute.getWorkflowDefaults();
      validateH3WorkflowSettings(defaults);
      const nextBrief = applyH3WorkflowSettings(brief, defaults);
      setBrief(nextBrief);
      await saveSettings({ ...appSettings, h3WorkflowSettings: defaults });
      resetSession();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reload the H3 workflow defaults.');
    } finally {
      setResettingWorkflowDefaults(false);
    }
  };

  const selectProduct = (productId: ProductId) => {
    const nextProduct = getProduct(productId);
    if (!nextProduct) return;
    if (brief.references.productReference.source === 'local-file') void window.proya.files.clearReferenceAuthorization();
    const references = createOptionalH3ReferencePlan(nextProduct);
    setBrief((current) => ({ ...current, product: productId, references: { ...references, productReference: referenceAssetForSource(references.productReference, 'selected-product', nextProduct, 'productReference') } }));
    resetSession();
  };

  const updateReference = (slot: ReferenceSlotName, source: H3ReferenceSource) => {
    if (slot === 'productReference' && brief.references.productReference.source === 'local-file' && source !== 'local-file') void window.proya.files.clearReferenceAuthorization();
    setBrief((current) => ({ ...current, references: { ...current.references, [slot]: referenceAssetForSource(current.references[slot], source, product, slot) } }));
    resetSession();
  };

  const chooseLocalProductReference = (filePath: string) => {
    try {
      setBrief((current) => ({ ...current, references: { ...current.references, productReference: createLocalProductReference(filePath) } }));
      resetSession();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The selected product reference image is invalid.');
    }
  };

  const clearLocalProductReference = () => {
    void window.proya.files.clearReferenceAuthorization();
    setBrief((current) => ({ ...current, references: { ...current.references, productReference: clearProductReference() } }));
    resetSession();
  };

  const updateReferenceDescription = (slot: ReferenceSlotName, description: string) => {
    setBrief((current) => ({ ...current, references: { ...current.references, [slot]: { ...current.references[slot], description } } }));
    resetSession();
  };

  const refreshPromptEngine = async () => {
    if (!appSettings || testingPromptEngine) return;
    setTestingPromptEngine(true);
    setError('');
    try { setPromptEngineStatus(await window.proya.compute.testPromptEngine(appSettings.remoteComfyUrl, appSettings.h3PromptEngine)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not inspect the remote H3 prompt engine.'); }
    finally { setTestingPromptEngine(false); }
  };

  const generate = async () => {
    if (!appSettings || !workflowSettingsPreview) { setError('Correct the H3 Generation Settings before generating.'); return; }
    if (!productReferenceReady) { setError('Select a Product Reference Image before generating.'); return; }
    if (!promptEngineStatus?.qwenReady) { setError(promptEngineStatus?.error ?? 'Prompt Engine is not ready on the China execution PC.'); return; }
    setError('');
    setSubmitting(true);
    const seed = createCreativeSeed();
    const generationJobId = createCreativeGenerationJobId(seed);
    try {
      const selectedContentType = resolveCreativeFamilyForH3VideoType(brief.contentType);
      const sessionBrief = { ...brief, contentType: selectedContentType, workflowMode: 'REF2VA' as const, creativeSeed: seed, creativeVariety: brief.creativeVariety ?? 'Balanced' };
      const selectedPlan = planCreativeGenome({
        product,
        contentFamily: selectedContentType,
        userIdea: sessionBrief.videoIdea,
        specialInstructions: sessionBrief.specialInstructions,
        recentHistory: h3History,
        variety: sessionBrief.creativeVariety ?? 'Balanced',
        seed,
        generationJobId
      });
      const plannedBrief = { ...sessionBrief, creativeGenome: selectedPlan.genome };
      const nextGenerationBrief = buildH3GenerationBrief({ product, brief: plannedBrief, genome: selectedPlan.genome, references: plannedBrief.references });
      const nextGenerationBriefText = serializeH3GenerationBrief(nextGenerationBrief);
      const referenceContext = buildH3ReferenceContext(nextGenerationBrief);
      const effectiveEngine = { ...promptEngine, model: h3PromptEngineModelId };
      const references = referenceRequests(plannedBrief.references, appSettings.productAssetsDirectory);
      const record = await createH3Prompt({
        product: product.id,
        contentType: plannedBrief.contentType,
        brief: plannedBrief,
        concept: null,
        resolvedMode: 'REF2VA',
        referencePlan: plannedBrief.references,
        timeline: [],
        chatGptRequest: '',
        recommendedSettings: null,
        prompt: '',
        generationJobId,
        generationStatus: 'prepared',
        creativeSeed: selectedPlan.creativeSeed,
        creativeGenome: selectedPlan.genome,
        creativeFingerprint: selectedPlan.fingerprint,
        conceptSummary: selectedPlan.conceptSummary,
        noveltyScore: selectedPlan.noveltyScore,
        repetitionPenaltySources: selectedPlan.repetitionPenaltySources,
        diversityFallbackUsed: selectedPlan.diversityFallbackUsed,
        diversityFallbackReason: selectedPlan.diversityFallbackReason,
        rerollsUsed: selectedPlan.rerollsUsed,
        noveltyThresholdMissed: selectedPlan.noveltyThresholdMissed,
        creativeDiversityDiagnostics: selectedPlan.diversityDiagnostics,
        generationBrief: nextGenerationBrief,
        generationBriefText: nextGenerationBriefText,
        referenceContext,
        promptEngine: effectiveEngine,
        llmModelId: null,
        llmModel: effectiveEngine.model,
        llmTemperature: effectiveEngine.temperature,
        llmTimeoutSeconds: effectiveEngine.timeoutSeconds,
        llmRepairAttempts: effectiveEngine.repairAttempts,
        llmDisableThinking: effectiveEngine.disableThinking,
        referenceMap: nextGenerationBrief.references,
        pipelineStage: 'PREPARING',
        llmUnloadRequested: effectiveEngine.unloadModelBeforeH3
      });
      setBrief(plannedBrief);
      setGeneratedRecordId(record.id);
      generatedRecordIdRef.current = record.id;
      localJobRef.current = generationJobId;
      const initial = await window.proya.compute.submitH3({
        generationBrief: nextGenerationBrief,
        generationBriefText: nextGenerationBriefText,
        referenceContext,
        mediaManifest: nextGenerationBrief.mediaManifest,
        allowedReferenceLabels: nextGenerationBrief.allowedReferenceLabels,
        promptEngine: effectiveEngine,
        mode: 'REF2VA',
        duration: workflowSettingsPreview.durationSeconds,
        aspectRatio: workflowSettingsPreview.aspectRatio,
        fps: workflowSettingsPreview.fps,
        frames: workflowSettingsPreview.frameLength,
        megapixels: workflowSettingsPreview.megapixels,
        multiple: workflowSettingsPreview.multiple,
        steps: workflowSettingsPreview.steps,
        seed: workflowSettingsPreview.seed,
        firstFrame: null,
        lastFrame: null,
        productReference: null,
        productReferencePath: references.productReferencePath,
        referenceImages: references.referenceImages,
        refImageSize: workflowSettingsPreview.refImageSize,
        scheduler: workflowSettingsPreview.scheduler,
        workflowSettings: workflowSettingsPreview,
        product: product.id,
        promptRecordId: record.id,
        localJobId: generationJobId
      });
      setRemoteJob(initial);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The autonomous H3 job could not be started.');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadResult = async () => {
    if (!remoteJob?.localJobId) return;
    try { setRemoteJob(await window.proya.compute.downloadResult(remoteJob.localJobId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not download the H3 result.'); }
  };

  const reopen = (record: H3PromptRecord) => {
    setBrief({ ...record.brief, product: record.product, references: record.referencePlan, workflowMode: 'REF2VA' });
    setGeneratedRecordId(record.id);
    localJobRef.current = record.generationJobId ?? null;
    void window.proya.compute.listJobs(100).then((jobs) => {
      const job = jobs.find((item) => item.promptRecordId === record.id || item.localJobId === record.generationJobId);
      if (job) setRemoteJob(job.state);
    }).catch(() => undefined);
  };

  const copyFinalPrompt = async () => {
    const value = remoteJob?.finalEnhancedPrompt ?? '';
    if (!value.trim()) return;
    await window.proya.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (!appSettings) return <div className="loading-screen"><span className="spinner" /> Loading settings…</div>;

  return <div className="h3-page h3-autonomous-page">
    <div className="h3-autonomous-layout">
      <main className="h3-control-panel">
        <header className="page-header h3-page-header">
          <div><span className="eyebrow">Autonomous H3 video control plane</span><h1>MiniMax H3 Setup</h1><p>Write a compact creative brief on this laptop. Qwen and ComfyUI execute the prompt and video on the China RTX 5090 PC.</p></div>
          <span className="h3-header-badge"><Cloud size={14} /> Remote Qwen · REF2VA</span>
        </header>

        <div className="h3-boundary-note"><Server size={15} /><span>Creative Studio never calls LM Studio or writes final prompt text. The remote ComfyUI workflow owns enhancement, validation, unload, and H3 generation.</span></div>

        <section className="h3-section"><H3SectionHeading title="Product" note="The product reference is required for REF2VA." /><div className="h3-product-grid">{products.map((item) => <ProductCard key={item.id} product={item} selected={item.id === brief.product} onSelect={(id) => { if (id !== 'auto') selectProduct(id); }} />)}</div><div className="h3-product-lock"><span className="ready-dot" /><div><strong>{product.officialName}</strong><span>Identity reference locked to selected product</span></div><small>{productReferenceReady ? 'Ready' : 'Select a reference'}</small></div></section>

        <section className="h3-section"><H3SectionHeading title="Creative brief" note="Qwen receives this intermediate brief." /><label className="h3-field h3-field-wide"><span>Content type</span><select aria-label="H3 content type" value={brief.contentType} onChange={(event) => updateBrief('contentType', event.target.value as H3VideoBrief['contentType'])}>{h3ContentTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="h3-field h3-field-wide"><span>Video idea</span><textarea aria-label="H3 video idea" value={brief.videoIdea} onChange={(event) => updateBrief('videoIdea', event.target.value)} placeholder="Describe the product moment, action, or emotional beat you want." rows={4} /></label><label className="h3-field h3-field-wide"><span>Special instructions</span><textarea aria-label="H3 special instructions" value={brief.specialInstructions} onChange={(event) => updateBrief('specialInstructions', event.target.value)} placeholder="Optional constraints or staging details." rows={3} /></label><label className="h3-field h3-field-wide"><span>Creative diversity</span><select value={brief.creativeVariety} onChange={(event) => updateBrief('creativeVariety', event.target.value as CreativeVariety)}>{creativeVarietyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></section>

        <section className="h3-section"><H3SectionHeading title="Audio & language" note="These constraints become part of H3GenerationBrief." /><div className="h3-form-grid"><label className="h3-field"><span>Language</span><select aria-label="H3 language" value={brief.language} onChange={(event) => updateBrief('language', event.target.value as H3VideoBrief['language'])}>{h3LanguageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="h3-field"><span>Sound</span><select aria-label="H3 sound" value={brief.sound} onChange={(event) => { const sound = event.target.value as H3Sound; setBrief((current) => ({ ...current, sound, musicOnly: sound === 'Music Only' ? true : current.musicOnly })); resetSession(); }}>{h3SoundOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></div><div className="h3-engine-flags h3-audio-flags"><label><input type="checkbox" checked={brief.musicOnly} onChange={(event) => updateMusicOnly(event.target.checked)} /> Music Only</label><label><input type="checkbox" checked={brief.captions} onChange={(event) => updateBrief('captions', event.target.checked)} /> Allow generated captions</label><label><input type="checkbox" checked={brief.subtitles} disabled={brief.musicOnly} onChange={(event) => updateBrief('subtitles', event.target.checked)} /> Allow generated subtitles</label></div></section>

        <section className="h3-section"><H3SectionHeading title="H3 Generation Settings" note="Direct values are injected into the API workflow." /><div className="h3-setting-grid"><label className="h3-field"><span>Duration</span><input aria-label="H3 duration" type="number" min={4} max={15} step={0.01} value={brief.duration} onChange={(event) => updateWorkflowSetting('duration', Number(event.target.value))} /></label><label className="h3-field"><span>Aspect ratio</span><select aria-label="H3 aspect ratio" value={brief.aspectRatio} onChange={(event) => updateWorkflowSetting('aspectRatio', event.target.value as H3VideoBrief['aspectRatio'])}>{h3AspectRatioOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="h3-field"><span>Megapixels</span><input aria-label="H3 megapixels" type="number" min={0.1} max={16} step={0.01} value={brief.megapixels} onChange={(event) => updateWorkflowSetting('megapixels', Number(event.target.value))} /></label><label className="h3-field"><span>Multiple</span><input aria-label="H3 multiple" type="number" min={8} max={128} step={4} value={brief.multiple} onChange={(event) => updateWorkflowSetting('multiple', Number(event.target.value))} /></label><label className="h3-field"><span>Steps</span><input aria-label="H3 steps" type="number" min={1} value={brief.steps ?? workflowSettings.steps} onChange={(event) => updateWorkflowSetting('steps', Number(event.target.value))} /></label><label className="h3-field"><span>Scheduler</span><select aria-label="H3 scheduler" value={brief.scheduler} onChange={(event) => updateWorkflowSetting('scheduler', event.target.value as H3Scheduler)}>{h3SchedulerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div><div className="h3-calculated-grid"><div className="h3-calculated-setting"><span>FPS</span><strong>24</strong></div><div className="h3-calculated-setting"><span>Frames</span><strong>{workflowSettingsPreview?.frameLength ?? '—'}</strong></div><div className="h3-calculated-setting"><span>Resolution</span><strong>{workflowSettingsPreview ? `${workflowSettingsPreview.resolvedWidth} × ${workflowSettingsPreview.resolvedHeight}` : '—'}</strong></div></div><div className="h3-setting-actions"><label className="h3-field"><span>Ref image size</span><select aria-label="H3 ref image size" value={brief.refImageSize} onChange={(event) => updateWorkflowSetting('refImageSize', event.target.value as H3VideoBrief['refImageSize'])}>{h3RefImageSizeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button className="button secondary small" type="button" onClick={() => void resetH3WorkflowDefaults()} disabled={resettingWorkflowDefaults}><RefreshCw size={14} className={resettingWorkflowDefaults ? 'spin' : ''} />{resettingWorkflowDefaults ? 'Reloading…' : 'Reset to workflow defaults'}</button></div></section>

        <section className="h3-section"><H3SectionHeading title="References" note="Only concrete connected images receive Picture labels." /><div className="h3-reference-grid"><ReferenceSlot slot="productReference" asset={brief.references.productReference} product={product} onSourceChange={(source) => updateReference('productReference', source)} onDescriptionChange={(description) => updateReferenceDescription('productReference', description)} onLocalFileSelect={chooseLocalProductReference} onClearLocalFile={clearLocalProductReference} onError={setError} /><ReferenceSlot slot="styleReference" asset={brief.references.styleReference} product={product} onSourceChange={(source) => updateReference('styleReference', source)} onDescriptionChange={(description) => updateReferenceDescription('styleReference', description)} onError={setError} /></div><div className="h3-reference-mapping"><strong>Authoritative REF2VA mapping</strong>{buildH3ReferenceSlotMappings(brief.references).length > 0 ? buildH3ReferenceSlotMappings(brief.references).map((mapping) => <span key={mapping.pictureTag}><b>{mapping.pictureTag}</b> → LoadImage → <b>{mapping.refInput}</b> · {mapping.role}</span>) : <span>No connected reference image. Generation is blocked.</span>}</div></section>

        <PromptEngineSettings status={promptEngineStatus} testing={testingPromptEngine} onRefresh={() => void refreshPromptEngine()} />

        <section className="h3-generate-panel"><div><span className="eyebrow">One-click autonomous pipeline</span><h2>Ready to generate?</h2><p>Creative Diversity runs first, then the remote graph writes, validates, unloads the exact prompt-model instance, and queues H3.</p></div><button className="h3-generate-button" type="button" aria-label="Generate H3 video" onClick={() => void generate()} disabled={!canGenerate || submitting}><Sparkles size={18} />{submitting ? 'Starting remote H3…' : 'Generate H3 video'}<span>→</span></button>{!productReferenceReady && <small className="h3-help">Select a product reference to enable generation.</small>}{!promptEngineStatus?.qwenReady && <small className="h3-help">Prompt Engine must be ready on the China execution PC.</small>}{error && <p className="error-note h3-error">{error}</p>}</section>
      </main>

      <aside className="h3-right-rail">
        <RemoteH3Status job={remoteJob} onOpenOutput={(output) => void window.proya.compute.openOutput(output)} onDownloadResult={() => void downloadResult()} onOpenResult={() => { if (remoteJob?.localJobId) void window.proya.compute.openResult(remoteJob.localJobId); }} />
        <section className="h3-preview-card"><div className="h3-rail-heading"><div><span className="eyebrow">Output</span><h2>Video preview</h2></div>{videoOutput && <span className="h3-status-pill complete">Ready</span>}</div>{videoOutput ? <video className="h3-video-preview" controls preload="metadata" src={videoOutput.url}>Your browser cannot preview this video.</video> : <div className="h3-video-empty"><Cloud size={22} /><span>{remoteJob?.pipelineStage === 'COMPLETE' ? 'Video downloaded to this laptop.' : 'The generated video will appear here after ComfyUI completes.'}</span></div>}{remoteJob?.localResultPath && <div className="h3-local-result"><span>Downloaded result</span><strong title={remoteJob.localResultPath}>{remoteJob.localResultPath}</strong><button type="button" onClick={() => { if (remoteJob.localJobId) void window.proya.compute.openResult(remoteJob.localJobId); }}><ExternalLink size={13} />Open result</button></div>}</section>
        <section className="h3-debug-card"><div className="h3-rail-heading"><div><span className="eyebrow">Read-only debug</span><h2>Final prompt</h2></div><button className="button secondary small" type="button" onClick={() => void copyFinalPrompt()} disabled={!remoteJob?.finalEnhancedPrompt}>{copied ? 'Copied' : 'Copy'}</button></div><p>Only the remote enhancer output is shown here. This panel never edits or feeds the job.</p><button className="h3-debug-toggle" type="button" onClick={() => setShowDebugPrompt((value) => !value)}>{showDebugPrompt ? 'Hide final prompt' : 'Show final prompt'}</button>{showDebugPrompt && <pre className="h3-final-prompt">{remoteJob?.finalEnhancedPrompt ?? 'Waiting for MiniMaxH3PromptEnhancer output.'}</pre>}</section>
        <H3ReferenceContractInspector job={remoteJob} />
        <H3PromptEngineInspector configured={promptEngine} job={remoteJob} />
        <H3History records={h3History} activeId={generatedRecordId} onReopen={reopen} />
      </aside>
    </div>
  </div>;
}

function H3ReferenceContractInspector({ job }: { job: ComputeJobState | null }) {
  if (!import.meta.env.DEV) return null;
  const labels = job?.allowedReferenceLabels ?? job?.generationBrief?.allowedReferenceLabels;
  const bindings = job?.physicalReferenceMap ?? [];
  return <section className="h3-debug-card h3-contract-inspector"><div className="h3-rail-heading"><div><span className="eyebrow">Development inspector</span><h2>Reference contract</h2></div></div><p>This read-only audit shows the contract shared by the physical H3 inputs, Qwen context, enhancer, validator, and repair loop.</p><div className="h3-contract-labels"><div><span>Allowed subjects</span><code>{labels?.subjects.join(', ') || 'none'}</code></div><div><span>Allowed pictures</span><code>{labels?.pictures.join(', ') || 'none'}</code></div><div><span>Allowed videos</span><code>{labels?.videos.join(', ') || 'none'}</code></div><div><span>Allowed audios</span><code>{labels?.audios.join(', ') || 'none'}</code></div></div><div className="h3-contract-bindings">{bindings.length > 0 ? bindings.map((binding) => <div key={binding.pictureTag}><strong>{binding.pictureTag}</strong><span>{binding.subjectTag ?? 'no subject binding'} · {binding.physicalInput} · node {binding.nodeId ?? 'dynamic'} · {binding.uploadedFilename ?? 'not uploaded'}</span></div>) : <span>Waiting for the immutable reference binding.</span>}</div><details><summary>Exact media_manifest</summary><pre className="h3-final-prompt">{job?.mediaManifest ?? job?.generationBrief?.mediaManifest ?? 'Waiting for the authoritative manifest.'}</pre></details></section>;
}

function H3PromptEngineInspector({ configured, job }: { configured: H3PromptEngineSettings; job: ComputeJobState | null }) {
  if (!import.meta.env.DEV) return null;
  const effective = job;
  const value = (candidate: string | number | boolean | null | undefined): string => candidate === null || candidate === undefined || candidate === '' ? '—' : String(candidate);
  return <section className="h3-debug-card h3-contract-inspector"><div className="h3-rail-heading"><div><span className="eyebrow">Development inspector</span><h2>Prompt Engine audit</h2></div></div><p>Runtime identity is observed from node 149. Request constants remain internal; Creative Studio does not configure LM Studio runtime settings.</p><div className="h3-prompt-audit"><div className="h3-prompt-audit-heading"><span>Setting</span><strong>Internal</strong><strong>Observed</strong></div>{[
    ['Model ID', '—', value(effective?.llmModelId ?? effective?.llmModel ?? effective?.lmStudioModelId)],
    ['Instance ID', '—', value(effective?.llmInstanceId)],
    ['Temperature', value(configured.temperature), value(effective?.llmTemperature)],
    ['Output token limit', 'LM Studio managed', 'LM Studio managed'],
    ['Configured LLM timeout', `${value(configured.timeoutSeconds)} sec`, `${value(effective?.llmTimeoutSeconds)} sec`],
    ['Effective node 149 timeout', `${value(effective?.llmTimeoutSeconds ?? configured.timeoutSeconds)} sec`, `${value(effective?.llmTimeoutSeconds)} sec`],
    ['HTTP client read timeout', `${value(configured.timeoutSeconds)} sec`, `${value(effective?.llmTimeoutSeconds)} sec`],
    ['Repair attempts', value(configured.repairAttempts), value(effective?.llmRepairAttempts)],
    ['Disable thinking', value(configured.disableThinking), value(effective?.llmDisableThinking)]
  ].map(([label, configuredValue, effectiveValue]) => <div className="h3-prompt-audit-row" key={label}><span>{label}</span><code>{configuredValue}</code><code>{effectiveValue}</code></div>)}</div></section>;
}

function PromptEngineSettings({ status, testing, onRefresh }: { status: H3PromptEngineStatus | null; testing: boolean; onRefresh: () => void }) {
  const snapshot = promptEngineStatusSnapshot(status);
  return (
    <section className="h3-section h3-prompt-engine">
      <H3SectionHeading title="Prompt Engine" note="LM Studio on the China PC owns runtime configuration." />
      <div className="h3-engine-status">
        <span className={`h3-status-dot ${status?.qwenReady ? 'ready' : status ? 'error' : 'checking'}`} />
        <div>
          <strong>Prompt Engine {snapshot.status}</strong>
          <small>{status?.error ?? 'Checking qwen/qwen3.8-27b through the remote ComfyUI bridge.'}</small>
        </div>
        <button className="button secondary small" type="button" onClick={onRefresh} disabled={testing}>
          <RefreshCw size={14} className={testing ? 'spin' : ''} />{testing ? 'Checking…' : 'Test Prompt Engine'}
        </button>
      </div>
      <div className="h3-engine-readonly" aria-label="Prompt Engine status">
        <div><span>LM Studio</span><strong className={status?.lmStudioConnected ? 'ready' : status ? 'missing' : ''}>{snapshot.connection}</strong></div>
        <div><span>Model</span><strong title={snapshot.model}>{snapshot.model}</strong></div>
        <div><span>Status</span><strong className={status?.qwenReady ? 'ready' : status ? 'missing' : ''}>{snapshot.status}</strong></div>
      </div>
      <small className="h3-engine-readonly-note">Model selection, context, GPU/offload, quantization, template, and reasoning settings stay in LM Studio. Creative Studio sends no model-management overrides.</small>
    </section>
  );
}

function RemoteH3Status({ job: inputJob, onOpenOutput, onDownloadResult, onOpenResult }: { job: ComputeJobState | null; onOpenOutput: (output: ComputeJobState['outputs'][number]) => void; onDownloadResult: () => void; onOpenResult: () => void }) {
  // The button is rendered only when videoOutput exists, which implies inputJob is non-null.
  // Keep the assertion local so the rest of the rail can continue using optional rendering.
  const job = inputJob as ComputeJobState;
  const successStages = ['PREPARING', 'UPLOADING_REFERENCES', 'WRITING_PROMPT', 'VALIDATING_PROMPT', 'UNLOADING_LLM', 'QUEUED_H3', 'GENERATING_H3', 'RELEASING_H3_VRAM', 'DOWNLOADING', 'COMPLETE'] as const;
  const currentIndex = job?.pipelineStage ? successStages.indexOf(job.pipelineStage as (typeof successStages)[number]) : -1;
  const statusLabel = job?.pipelineStage?.replaceAll('_', ' ') ?? 'READY';
  const videoOutput = job?.outputs.find((output) => output.kind === 'video' && output.nodeId === '92') ?? job?.outputs.find((output) => output.kind === 'video');
  return <section className="h3-status-card"><div className="h3-rail-heading"><div><span className="eyebrow">Execution</span><h2>Remote job status</h2></div><span className={`h3-status-pill ${job?.status === 'failed' || job?.status === 'error' ? 'error' : job?.pipelineStage === 'COMPLETE' ? 'complete' : 'active'}`}>{statusLabel}</span></div><div className="h3-stage-list">{successStages.map((stage, index) => <div className={`h3-stage ${index <= currentIndex ? 'done' : ''} ${job?.pipelineStage === stage ? 'current' : ''}`} key={stage}><span>{index < currentIndex || job?.pipelineStage === 'COMPLETE' && stage === 'COMPLETE' ? '✓' : index + 1}</span><strong>{stage.replaceAll('_', ' ')}</strong></div>)}</div>{job?.failureStage && <div className="h3-failure-stage"><strong>{job.failureStage.replaceAll('_', ' ')}</strong><span>{job.error ?? job.downloadError ?? 'The pipeline stopped at this stage.'}</span></div>}{job && <div className="h3-job-meta"><span>Local Job ID</span><strong>{job.localJobId ?? '—'}</strong>{job.remotePromptId && <><span>ComfyUI prompt UUID</span><strong>{job.remotePromptId}</strong></>}{job.lmStudioModelId && <><span>Qwen model</span><strong>{job.lmStudioModelId}</strong></>}{job.repairAttemptsUsed !== undefined && job.repairAttemptsUsed !== null && <><span>Repair attempts</span><strong>{job.repairAttemptsUsed}</strong></>}{job.validationReport && <><span>Validation</span><strong>{job.failureStage === 'PROMPT_VALIDATION_FAILED' ? 'Failed' : 'Passed'}</strong></>}{job.stageTimings?.WRITING_PROMPT !== undefined && <><span>Rewrite time</span><strong>{formatStageTime(job.stageTimings.WRITING_PROMPT)}</strong></>}{job.llmUnloadRequested !== undefined && <><span>Qwen unload</span><strong>{job.llmUnloadSucceeded === true ? 'Verified' : job.llmUnloadError ?? 'Pending'}</strong></>}{job.h3VramReleaseRequested !== undefined && <><span>H3 VRAM release</span><strong>{job.h3VramReleaseDurationMs == null ? 'Pending' : job.h3VramReleaseSucceeded === true ? 'Verified' : job.h3VramReleaseSucceeded === false ? 'Failed' : 'Unverified'}</strong></>}{job.h3VramReleaseDurationMs != null && <><span>VRAM release time</span><strong>{formatStageTime(job.h3VramReleaseDurationMs)}</strong></>}{job.queueRemaining !== null && <><span>Queue remaining</span><strong>{job.queueRemaining}</strong></>}{job.progress !== null && <><span>H3 progress</span><strong>{Math.round(job.progress * 100)}%</strong></>}</div>}{job?.h3VramReleaseError && <p className="h3-warning">{job.h3VramReleaseError}</p>}{job?.connectionError && <p className="h3-warning">Live ComfyUI connection interrupted; polling will continue.</p>}{job?.error && !job.failureStage && <p className="h3-error">{job.error}</p>}{videoOutput && <div className="h3-output-actions"><button type="button" onClick={() => onOpenOutput(videoOutput)}><ExternalLink size={13} />Open remote</button><button type="button" onClick={onDownloadResult} disabled={job.status !== 'completed' || job.pipelineStage === 'RELEASING_H3_VRAM' || job.pipelineStage === 'DOWNLOADING'}><Download size={13} />Download result</button></div>}{job?.localResultPath && <button className="h3-result-link" type="button" onClick={onOpenResult}><ExternalLink size={13} />Open downloaded result</button>}</section>;
}

function H3History({ records, activeId, onReopen }: { records: H3PromptRecord[]; activeId: number | null; onReopen: (record: H3PromptRecord) => void }) {
  return <section className="h3-history-section"><div className="h3-rail-heading"><div><span className="eyebrow">Persistence</span><h2>H3 history</h2></div><History size={17} /></div>{records.length === 0 ? <div className="h3-empty-inline"><History size={17} /><span>Generated briefs and job metadata will be saved here.</span></div> : <div className="h3-history-list">{records.slice(0, 8).map((record) => <button type="button" key={record.id} className={`h3-history-item ${activeId === record.id ? 'active' : ''}`} onClick={() => onReopen(record)}><span className="h3-history-date">{new Date(record.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span><span><strong>{record.brief.videoIdea.trim() || record.contentType}</strong><small>{getProduct(record.product)?.shortName} · REF2VA · {record.brief.duration} sec</small></span><RefreshCw size={14} /></button>)}</div>}</section>;
}

function ReferenceSlot({ slot, asset, product, onSourceChange, onDescriptionChange, onLocalFileSelect, onClearLocalFile, onError }: { slot: ReferenceSlotName; asset: H3ReferencePlan[ReferenceSlotName]; product: Product; onSourceChange: (source: H3ReferenceSource) => void; onDescriptionChange: (description: string) => void; onLocalFileSelect?: (filePath: string) => void; onClearLocalFile?: () => void; onError: (message: string) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const custom = asset.source === 'custom';
  const localFile = slot === 'productReference' && asset.source === 'local-file';
  const handleLocalFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!isSupportedLocalReferenceImage(file.name)) { onError('Product reference image must be a PNG, JPG, JPEG, or WebP file.'); return; }
    if (file.size <= 0) { onError('The selected product reference image is empty. Choose another image.'); return; }
    if (file.size > maxLocalReferenceUploadBytes) { onError('The selected product reference image is too large. The maximum is 25 MiB.'); return; }
    void window.proya.files.authorizeReferenceFile(file).then((filePath) => onLocalFileSelect?.(filePath)).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : 'Could not authorize the selected local image.'));
  };
  return <div className="h3-reference-slot"><div className="h3-reference-slot-header"><strong>{slot === 'productReference' ? 'Product Reference Image' : 'Style Reference'}</strong><span>{slot === 'productReference' ? 'Picture 1' : 'Unassigned until connected'}</span></div><select aria-label={`${slot === 'productReference' ? 'Product Reference Image' : 'Style Reference'} reference source`} value={asset.source} onChange={(event) => onSourceChange(event.target.value as H3ReferenceSource)}><option value="none">Not provided</option><option value="selected-product">Use selected product asset</option>{slot === 'productReference' && <option value="local-file">Choose local image</option>}<option value="custom">Describe a custom reference</option></select>{asset.source === 'selected-product' && <small>{product.shortName} master asset · uploaded through ComfyUI</small>}{localFile && <><input ref={fileInputRef} className="h3-reference-file-input" type="file" accept={localReferenceAccept} hidden onChange={handleLocalFileChange} /><div className="h3-reference-file-actions"><button className="h3-reference-file-button" type="button" onClick={() => fileInputRef.current?.click()}><FolderOpen size={13} />Choose image</button>{asset.path && onClearLocalFile && <button className="h3-reference-file-remove" type="button" onClick={onClearLocalFile}>Remove</button>}</div>{asset.path ? <div className="h3-reference-file-selected"><strong>{localReferenceFilename(asset.path)}</strong><small title={asset.path}>{asset.path}</small></div> : <small>Choose a local PNG, JPG, JPEG, or WebP image.</small>}</>}{custom && <input aria-label={`${slot} reference description`} value={asset.description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder={slot === 'productReference' ? 'official package reference' : 'warm studio, glossy light'} />}{asset.source === 'none' && <small>{slot === 'productReference' ? 'Required for REF2VA.' : 'Optional.'}</small>}</div>;
}

function H3SectionHeading({ title, note }: { title: string; note: string }) {
  return <div className="h3-section-heading"><h2>{title}</h2><small>{note}</small></div>;
}
