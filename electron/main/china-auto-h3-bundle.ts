import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { products } from '../../src/domain/data';
import { h3WorkflowSettingsFromBrief } from '../../src/domain/h3';
import { validateH3WorkflowSettings } from '../../src/domain/minimax-h3-workflow';
import type { AutoH3Config } from '../../src/domain/auto-h3';
import type { AppSettings, Product } from '../../src/domain/types';
import { canonicalBundleHash, sha256 } from '../../src/china-runner/staging';
import { SESSION_BUNDLE_SCHEMA_VERSION, type ChinaSessionBundle, type SessionAssetBundle } from '../../src/china-runner/types';

const mime = (path: string): SessionAssetBundle['mimeType'] => {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  throw new Error(`Verified product master has an unsupported image type: ${path}`);
};

function verifiedMasterPaths(product: Product): string[] {
  return [...new Set([product.imagePath, ...(product.referenceImagePaths ?? [])])];
}

export interface BuiltChinaSessionBundle { bundle: ChinaSessionBundle; bundleSha256: string }

/** Stable identity of immutable configuration/content, deliberately excluding the session UUID and its derived bundle hash. */
export function chinaBundleSettingsIdentity(bundle: ChinaSessionBundle): string {
  const canonical = { ...bundle } as Partial<ChinaSessionBundle>;
  delete canonical.sessionId;
  delete canonical.bundleSha256;
  return sha256(JSON.stringify(canonical));
}

export function buildChinaSessionBundle(config: AutoH3Config, appSettings: AppSettings, expectedRunnerVersion: string, sessionId: string = randomUUID()): BuiltChinaSessionBundle {
  if (!config.selectedProducts.length || !config.selectedContentTypes.length) throw new Error('Select at least one product and one content type.');
  if (config.chinaRoot !== String.raw`D:\AI Videos`) throw new Error(String.raw`China archive root must be D:\AI Videos for Phase 3A.`);
  const selected = config.selectedProducts.map(id => products.find(product => product.id === id) ?? (() => { throw new Error(`Unknown product ${id}.`); })());
  const systemPrompt = readFileSync(appSettings.h3SystemPromptPath, 'utf8');
  const workflow = JSON.parse(readFileSync(appSettings.remoteComfyWorkflowPath, 'utf8')) as Record<string, unknown>;
  const workflowSettings = validateH3WorkflowSettings(h3WorkflowSettingsFromBrief(config.brief));
  const assets: SessionAssetBundle[] = [];
  const productReferences: ChinaSessionBundle['productReferences'] = [];
  for (const product of selected) {
    const assetIds: string[] = [];
    verifiedMasterPaths(product).forEach((sourcePath, slot) => {
      const localPath = join(appSettings.productAssetsDirectory, basename(sourcePath.replaceAll('\\', '/')));
      const bytes = readFileSync(localPath);
      const digest = sha256(bytes);
      const filename = `${product.id}--reference-${slot + 1}${extname(localPath).toLowerCase()}`;
      const id = `${product.id}--slot-${slot + 1}--${digest.slice(0, 12)}`;
      assets.push({ id, productId: product.id, sourcePath, filename, mimeType: mime(localPath), size: statSync(localPath).size, sha256: digest, base64: bytes.toString('base64') });
      assetIds.push(id);
    });
    productReferences.push({ productId: product.id, assetIds });
  }
  const sanitizedBrief = structuredClone(config.brief);
  sanitizedBrief.references = {
    firstFrame: { source: 'none', description: '', path: null },
    lastFrame: { source: 'none', description: '', path: null },
    productReference: { source: 'none', description: '', path: null },
    styleReference: { source: 'none', description: '', path: null },
    referenceImages: []
  };
  const unsigned: Omit<ChinaSessionBundle, 'bundleSha256'> = {
    sessionId,
    schemaVersion: SESSION_BUNDLE_SCHEMA_VERSION,
    expectedRunnerVersion,
    selectedProducts: [...config.selectedProducts],
    selectedContentTypes: [...config.selectedContentTypes],
    ordering: { productOrder: [...config.selectedProducts], contentTypeOrder: [...config.selectedContentTypes], shuffleProducts: config.shuffleProducts, shuffleContentTypes: config.shuffleContentTypes },
    repeatPolicy: { mode: 'forever' },
    products: selected.map(product => structuredClone(product)),
    assets,
    productReferences,
    settings: {
      brief: sanitizedBrief,
      h3: workflowSettings,
      language: sanitizedBrief.language,
      musicOnly: sanitizedBrief.musicOnly,
      captions: sanitizedBrief.captions,
      subtitles: sanitizedBrief.subtitles,
      creative: { creativeVariety: sanitizedBrief.creativeVariety, videoIdea: sanitizedBrief.videoIdea, goal: sanitizedBrief.goal, customGoal: sanitizedBrief.customGoal, specialInstructions: sanitizedBrief.specialInstructions, cameraMotion: sanitizedBrief.cameraMotion, actionIntensity: sanitizedBrief.actionIntensity, pacing: sanitizedBrief.pacing, ending: sanitizedBrief.ending, customEnding: sanitizedBrief.customEnding, sound: sanitizedBrief.sound, promptDetail: sanitizedBrief.promptDetail, productFidelity: sanitizedBrief.productFidelity, referenceFidelity: sanitizedBrief.referenceFidelity },
      promptEngine: structuredClone(appSettings.h3PromptEngine)
    },
    initialSettingsVersion: 1,
    systemPrompt,
    systemPromptSha256: sha256(systemPrompt),
    workflow,
    workflowSha256: sha256(JSON.stringify(workflow)),
    workflowVersion: `minimax-h3-api-${createHash('sha256').update(JSON.stringify(workflow)).digest('hex').slice(0, 12)}`,
    archiveRoot: String.raw`D:\AI Videos`
  };
  const bundleSha256 = canonicalBundleHash(unsigned);
  return { bundle: { ...unsigned, bundleSha256 }, bundleSha256 };
}
