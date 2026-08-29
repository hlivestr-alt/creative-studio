import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowUpRight, Check, ChevronRight, Clipboard, FolderOpen, Image, Maximize2, PackageOpen, RotateCcw, Sparkles, WandSparkles } from 'lucide-react';
import directCarouselTemplate from '../../prompts/chatgpt-direct-carousel.md?raw';
import directTemplate from '../../prompts/chatgpt-direct-image.md?raw';
import exploreCarouselTemplate from '../../prompts/chatgpt-explore-carousel.md?raw';
import exploreTemplate from '../../prompts/chatgpt-creative-director.md?raw';
import { buildCreativeBrief } from '../domain/brief';
import { getProduct, getProductReferencePaths, postTypes, products, visualStyles } from '../domain/data';
import { recommendProduct } from '../domain/rotation';
import { captionModeOptions, postStructureOptions, slideCountOptions, workflowModeOptions, type CreativeSettings, type Product, type ProductId, type WorkspaceLayout } from '../domain/types';
import { useApp } from './AppContext';
import { ChatWorkspace, type ChatWorkspaceHandle } from './ChatWorkspace';
import { ProductCard } from './ProductCard';

const textAmounts = ['No Text', 'Minimal', 'Educational', 'Promotional'] as const;
const languages = ['Indonesian', 'English'] as const;
const formats = ['Instagram Feed 4:5', 'Square 1:1', 'Story / TikTok 9:16'] as const;
const creativityLevels = ['Safe', 'Balanced', 'Experimental'] as const;
const captionModeValues = captionModeOptions.map((option) => option.value);

export function TodayPage() {
  const { history, settings: appSettings, loading, createHistory, saveSettings } = useApp();
  const initial = useMemo<CreativeSettings>(() => ({
    product: 'auto', workflowMode: appSettings?.defaultWorkflowMode ?? 'DIRECT_IMAGE', postStructure: appSettings?.defaultPostStructure ?? 'SINGLE_IMAGE', requestedSlideCount: 'AUTO', postType: 'Surprise Me', topic: 'Auto', visualStyle: 'Auto', textAmount: 'Minimal', captionMode: appSettings?.defaultCaptionMode ?? 'STANDARD',
    language: appSettings?.defaultLanguage ?? 'Indonesian', format: appSettings?.defaultFormat ?? 'Instagram Feed 4:5', creativity: appSettings?.defaultCreativity ?? 'Balanced'
  }), [appSettings]);
  const [settings, setSettings] = useState<CreativeSettings>(initial);
  const initialized = useRef(false);
  const [brief, setBrief] = useState('');
  const [copied, setCopied] = useState(false);
  const [approvalCopied, setApprovalCopied] = useState(false);
  const [referenceCopied, setReferenceCopied] = useState(false);
  const [layout, setLayout] = useState<WorkspaceLayout>('split');
  const [ratio, setRatio] = useState(appSettings?.splitRatio ?? 0.5);
  const splitRef = useRef<HTMLDivElement>(null);
  const chatWorkspaceRef = useRef<ChatWorkspaceHandle>(null);
  const recommendation = useMemo(() => recommendProduct(history), [history]);
  const resolvedProductId = (settings.product === 'auto' ? recommendation.productId : settings.product) as ProductId;
  const product = getProduct(resolvedProductId)!;
  const directMode = settings.workflowMode === 'DIRECT_IMAGE';
  const carousel = settings.postStructure === 'CAROUSEL';
  const referencePaths = getProductReferencePaths(product);
  const usedHistory = history.filter((item) => item.status === 'Used');
  const lastSeven = usedHistory.slice(0, 7);

  useEffect(() => {
    if (!appSettings || initialized.current) return;
    initialized.current = true;
    setSettings(initial);
    setRatio(appSettings.splitRatio);
  }, [appSettings, initial]);

  const update = <K extends keyof CreativeSettings>(key: K, value: CreativeSettings[K]) => {
    setSettings((current) => {
      const next = { ...current, [key]: value } as CreativeSettings;
      if (key === 'product') next.topic = 'Auto';
      if (key === 'postStructure' && value === 'SINGLE_IMAGE') next.requestedSlideCount = 'AUTO';
      return next;
    });
    if (key === 'workflowMode' || key === 'postStructure' || key === 'requestedSlideCount' || key === 'captionMode') setBrief('');
  };
  const prepare = async () => {
    const template = carousel ? (directMode ? directCarouselTemplate : exploreCarouselTemplate) : (directMode ? directTemplate : exploreTemplate);
    const generated = buildCreativeBrief({ settings, resolvedProductId, recentHistory: history.slice(0, appSettings?.recentHistoryWindow ?? 20), template });
    setBrief(generated);
    await createHistory({
      product: resolvedProductId, workflowMode: settings.workflowMode, postStructure: settings.postStructure, requestedSlideCount: carousel ? settings.requestedSlideCount : null, captionMode: settings.captionMode, postType: settings.postType, topic: settings.topic, visualStyle: settings.visualStyle,
      creativityLevel: settings.creativity, format: settings.format, language: settings.language, preparedBrief: generated,
      conceptTitle: null, headline: null, status: 'Prepared', notes: null
    });
  };
  const copyBrief = async () => { if (!brief) return; await window.proya.clipboard.writeText(brief); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  const copyApproval = async () => { await window.proya.clipboard.writeText('APPROVE'); setApprovalCopied(true); window.setTimeout(() => setApprovalCopied(false), 1800); };
  const copyReferencePaths = async () => {
    if (referencePaths.length > 1) await window.proya.files.copyPaths(referencePaths);
    else await window.proya.files.copyPath(referencePaths[0]);
    setReferenceCopied(true);
    window.setTimeout(() => setReferenceCopied(false), 1800);
  };
  const setLayoutAndRemember = async (next: WorkspaceLayout) => { setLayout(next); if (next === 'split' && appSettings) await saveSettings({ ...appSettings, splitRatio: ratio }); };
  const beginDrag = (event: ReactPointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    let nextRatio = ratio;
    const move = (moveEvent: PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect(); if (!rect) return;
      nextRatio = Math.min(0.72, Math.max(0.28, (moveEvent.clientX - rect.left) / rect.width)); setRatio(nextRatio);
    };
    const stop = async () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); if (appSettings) await saveSettings({ ...appSettings, splitRatio: nextRatio }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  };

  if (loading || !appSettings) return <div className="loading-screen"><span className="spinner" /> Loading studio…</div>;
  return (
    <div className="today-page">
      <div className={`studio-split layout-${layout}`} ref={splitRef} style={{ '--controls-ratio': ratio } as CSSProperties}>
        <section className="controls-pane">
          <header className="page-header">
            <div><span className="eyebrow">Creative planner</span><h1>Today</h1><p>Plan today’s PROYA creative.</p></div>
            <button className="icon-button" title="Creative controls full screen" onClick={() => setLayoutAndRemember(layout === 'controls' ? 'split' : 'controls')}><Maximize2 size={18} /></button>
          </header>

          <div className="suggestion-strip"><span><Sparkles size={16} /></span><div><small>Suggested today</small><strong>{getProduct(recommendation.productId)?.shortName}</strong><p>{recommendation.reason}</p></div><ChevronRight size={17} /></div>

          <section className="section-block">
            <div className="section-heading"><div><h2>Product</h2></div><small>Smart rotation uses local history</small></div>
            <div className="product-grid"><ProductCard selected={settings.product === 'auto'} onSelect={(id) => update('product', id)} />{products.map((item) => <ProductCard key={item.id} product={item} selected={settings.product === item.id} onSelect={(id) => update('product', id)} />)}</div>
          </section>

          <section className="section-block">
            <div className="section-heading"><div><h2>Workflow</h2></div><small>Direct is the daily default</small></div>
            <div className="workflow-mode-grid">{workflowModeOptions.map((option) => <button type="button" key={option.value} className={`workflow-mode-card ${settings.workflowMode === option.value ? 'active' : ''}`} onClick={() => update('workflowMode', option.value)}><span className="workflow-mode-icon">{option.value === 'DIRECT_IMAGE' ? <WandSparkles size={17} /> : <Image size={17} />}</span><span><strong>{option.label}</strong><small>{option.description}</small></span>{settings.workflowMode === option.value && <span className="workflow-mode-check"><Check size={12} /></span>}</button>)}</div>
          </section>

          <section className="section-block">
            <div className="section-heading"><div><h2>Post structure</h2></div><small>Separate from aspect ratio</small></div>
            <div className="workflow-mode-grid">{postStructureOptions.map((option) => <button type="button" key={option.value} className={`workflow-mode-card ${settings.postStructure === option.value ? 'active' : ''}`} onClick={() => update('postStructure', option.value)}><span className="workflow-mode-icon">{option.value === 'CAROUSEL' ? <Image size={17} /> : <WandSparkles size={17} />}</span><span><strong>{option.label}</strong><small>{option.description}</small></span>{settings.postStructure === option.value && <span className="workflow-mode-check"><Check size={12} /></span>}</button>)}</div>
            {carousel && <div className="slide-count-control"><Segmented label="Slides" options={slideCountOptions} value={settings.requestedSlideCount} onChange={(value) => update('requestedSlideCount', value)} formatOption={(option) => option === 'AUTO' ? 'Auto' : option} /><small>Auto selects the shortest useful story; manual counts are respected exactly.</small></div>}
          </section>

          <section className="section-block">
            <div className="section-heading"><div><h2>Creative setup</h2></div><small>Accuracy rules always stay locked</small></div>
            <div className="form-grid">
              <Field label="Post type"><select value={settings.postType} onChange={(e) => update('postType', e.target.value)}>{postTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Topic"><select value={settings.topic} onChange={(e) => update('topic', e.target.value)}><option>Auto</option>{product.topics.map((item) => <option key={item}>{item}</option>)}</select></Field>
            </div>
            <details className="advanced-options">
              <summary>Advanced options</summary>
              <div className="advanced-options-body">
                <div className="form-grid">
                  <Field label="Visual style"><select value={settings.visualStyle} onChange={(e) => update('visualStyle', e.target.value)}>{visualStyles.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Format"><select value={settings.format} onChange={(e) => update('format', e.target.value as CreativeSettings['format'])}>{formats.map((item) => <option key={item}>{item}</option>)}</select></Field>
                </div>
                <Segmented label="Text amount" options={textAmounts} value={settings.textAmount} onChange={(value) => update('textAmount', value)} />
                <Segmented label="Caption" options={captionModeValues} value={settings.captionMode} onChange={(value) => update('captionMode', value)} formatOption={captionModeLabel} />
                <div className="paired-segments"><Segmented label="Language" options={languages} value={settings.language} onChange={(value) => update('language', value)} /><Segmented label="Creativity" options={creativityLevels} value={settings.creativity} onChange={(value) => update('creativity', value)} /></div>
              </div>
            </details>
          </section>

          <button className="prepare-button" onClick={prepare}><WandSparkles size={20} /><span><strong>{directMode ? 'Prepare Image Session' : 'Generate 3 Ideas'}</strong><small>{directMode ? 'Build one finished prompt ready for APPROVE' : 'Build and save a source-grounded three-idea brief'}</small></span><ChevronRight /></button>

          {brief && <>
            <section className="prepared-summary">
              <div className="prepared-summary-heading"><div><span className="ready-dot" /><div><strong>{directMode ? 'Image session ready' : 'Creative brief ready'}</strong><small>{directMode ? 'One final prompt is waiting for your approval in ChatGPT.' : 'Three creative directions are ready for exploration.'}</small></div></div><span className="mode-pill">{directMode ? 'Direct image' : 'Explore 3 ideas'}</span></div>
              <div className="summary-grid"><div><span>Product</span><strong>{product.shortName}</strong></div><div><span>Post structure</span><strong>{carousel ? 'Carousel' : 'Single Image'}</strong></div>{carousel && <div><span>Slides</span><strong>{settings.requestedSlideCount === 'AUTO' ? 'Auto' : settings.requestedSlideCount}</strong></div>}<div><span>Post type</span><strong>{settings.postType}</strong></div><div><span>Topic</span><strong>{settings.topic}</strong></div><div><span>Visual style</span><strong>{settings.visualStyle}</strong></div><div><span>Caption</span><strong>{captionModeLabel(settings.captionMode)}</strong></div><div><span>Format</span><strong>{settings.format}</strong></div><div><span>Copy · language</span><strong>{settings.textAmount} · {settings.language}</strong></div><div><span>Creativity</span><strong>{settings.creativity}</strong></div></div>
              {carousel && directMode && <p className="summary-note">{settings.requestedSlideCount === 'AUTO' ? 'ChatGPT will decide the final useful count first. After APPROVE, generate exactly that many separate slide images—one image per slide, with no collage or extra variants.' : `After APPROVE, generate exactly ${settings.requestedSlideCount} separate slide images—one image per slide, with no collage or extra variants.`}</p>}
            </section>
            <section className="brief-card">
            <div className="brief-header"><div><span className="ready-dot" /><div><strong>{directMode ? 'Prepared image session brief' : 'Prepared creative brief'}</strong><small>Editable before handoff</small></div></div><div className="brief-actions"><button type="button" onClick={copyBrief}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? 'Copied' : 'Copy Brief'}</button>{carousel && directMode && <button type="button" onClick={copyApproval}>{approvalCopied ? <Check size={16} /> : <Clipboard size={16} />}{approvalCopied ? 'Copied' : 'Copy APPROVE'}</button>}<button type="button" onClick={() => void chatWorkspaceRef.current?.openAndCopy()}><ArrowUpRight size={16} /> Open ChatGPT + Copy Brief</button></div></div>
            <textarea aria-label="Prepared creative brief" value={brief} onChange={(event) => setBrief(event.target.value)} />
            </section>
            <ReferenceHandoff product={product} paths={referencePaths} directMode={directMode} carousel={carousel} copied={referenceCopied} onOpenFolder={() => window.proya.files.openFolder('products')} onCopyPaths={copyReferencePaths} />
          </>}

          <section className="dashboard-section"><div className="section-heading"><div><h2>Recent activity</h2></div><small>{usedHistory.length} used posts in local history</small></div><div className="recent-card">{lastSeven.length ? lastSeven.map((item) => <div key={item.id}><span className="mini-product">{getProduct(item.product)?.shortName.slice(0, 1)}</span><div><strong>{getProduct(item.product)?.shortName}</strong><small>{item.postType}</small></div><time>{new Date(item.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</time></div>) : <div className="empty-compact"><RotateCcw size={18} /> Mark sessions Used to build rotation history.</div>}</div></section>
          <footer className="source-note"><PackageOpen size={15} /> Product facts normalized from the supplied PROYA sources. Masters remain untouched.</footer>
        </section>
        {layout === 'split' && <div className="split-divider" onPointerDown={beginDrag}><span /></div>}
        <ChatWorkspace ref={chatWorkspaceRef} brief={brief} layout={layout} onLayout={setLayoutAndRemember} onCopy={copyBrief} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }

function captionModeLabel(mode: CreativeSettings['captionMode']) { return captionModeOptions.find((option) => option.value === mode)?.label ?? mode; }

function Segmented<T extends string | number>({ label, options, value, onChange, formatOption }: { label: string; options: readonly T[]; value: T; onChange: (value: T) => void; formatOption?: (option: T) => ReactNode }) {
  return <div className="segmented-field"><span>{label}</span><div className="segmented">{options.map((option) => <button type="button" key={option} className={value === option ? 'active' : ''} onClick={() => onChange(option)}>{formatOption ? formatOption(option) : option}</button>)}</div></div>;
}

function ReferenceHandoff({ product, paths, directMode, carousel, copied, onOpenFolder, onCopyPaths }: { product: Product; paths: string[]; directMode: boolean; carousel: boolean; copied: boolean; onOpenFolder: () => Promise<unknown>; onCopyPaths: () => Promise<void> }) {
  const reminder = carousel && directMode
    ? paths.length > 1
      ? 'For strongest packaging fidelity, attach the relevant official product reference PNGs together with your APPROVE message.'
      : 'For strongest packaging fidelity, attach the official product PNG together with your APPROVE message.'
    : carousel
      ? 'Attach the shown product reference image(s) to ChatGPT before sending the brief. They will be reused throughout the carousel.'
    : directMode
      ? 'Drag this product reference image into ChatGPT before sending the creative brief.'
      : 'Attach the supplied product reference before sending the creative brief.';
  return <section className={`reference-card ${paths.length > 1 ? 'reference-series' : ''}`}>
    <div className="reference-card-header"><div className="reference-card-title"><span className="reference-icon"><Image size={18} /></span><div><span className="eyebrow">{directMode ? 'Reference image' : 'Reference handoff'}</span><strong>{paths.length > 1 ? `${product.shortName} references` : `${product.shortName} reference`}</strong><p>{reminder}</p></div></div><span className="reference-count">{paths.length} {paths.length === 1 ? 'master file' : 'master files'}</span></div>
    <div className="reference-file-list">{paths.map((path) => { const referenceProduct = products.find((item) => item.imagePath === path); return <div className="reference-file" key={path}><img src={`proya-asset://${path}`} alt={referenceProduct?.shortName ?? fileName(path)} /><div><strong>{fileName(path)}</strong><small>{referenceProduct?.shortName ?? 'PROYA product reference'}</small></div></div>; })}</div>
    <div className="handoff-actions"><button type="button" onClick={() => void onOpenFolder()}><FolderOpen size={15} /> Open Product Folder</button><button type="button" onClick={() => void onCopyPaths()}><Clipboard size={15} /> {copied ? 'Copied' : 'Copy Product Path'}</button></div>
  </section>;
}

function fileName(path: string) { return path.split(/[\\/]/).at(-1) ?? path; }
