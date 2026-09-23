import { h3WorkflowTemplateDefaults } from './minimax-h3-workflow';
import { h3PromptEngineModelId, h3PromptEngineProductionDefaults, type AppSettings, type H3PromptEngineSettings } from './types';
import { appSettingsSchema } from './schemas';

export const chatGptHomeUrl = 'https://chatgpt.com/';
export const COMFY_BASE_URL = 'http://127.0.0.1:8188';
export const RUNNER_BASE_URL = 'http://127.0.0.1:8787';
export const LM_STUDIO_BASE_URL = 'http://127.0.0.1:1234';
// Retain the persisted field name for compatibility with existing installs.
// Local builds always normalize it to the local ComfyUI service.
export const defaultRemoteComfyUrl = COMFY_BASE_URL;

export const defaultH3PromptEngineSettings: H3PromptEngineSettings = {
  provider: 'lmstudio-remote',
  endpoint: `${LM_STUDIO_BASE_URL}/v1`,
  model: h3PromptEngineModelId,
  ...h3PromptEngineProductionDefaults,
  unloadModelBeforeH3: true
};

export const defaultSettings = (projectRoot: string): AppSettings => ({
  chatGptUrl: chatGptHomeUrl,
  computeMode: 'remote',
  remoteComfyUrl: defaultRemoteComfyUrl,
  remoteComfyWorkflowPath: `${projectRoot}/workflows/minimax-h3-api.json`,
  remoteOutputDirectory: `${projectRoot}/outputs`,
  remoteAutoDownload: true,
  defaultLanguage: 'Indonesian',
  defaultFormat: 'Instagram Feed 4:5',
  defaultCreativity: 'Balanced',
  defaultWorkflowMode: 'DIRECT_IMAGE',
  defaultPostStructure: 'SINGLE_IMAGE',
  defaultCaptionMode: 'STANDARD',
  recentHistoryWindow: 20,
  productAssetsDirectory: `${projectRoot}/product-assets`,
  referencesDirectory: `${projectRoot}/references`,
  splitRatio: 0.5,
  h3WorkflowSettings: { ...h3WorkflowTemplateDefaults },
  h3SystemPromptPath: `${projectRoot}/prompts/minimax-h3-lmstudio-system.md`,
  h3PromptEngine: { ...defaultH3PromptEngineSettings }
});

const bundledResourceFields = {
  remoteComfyWorkflowPath: 'workflows/minimax-h3-api.json',
  productAssetsDirectory: 'product-assets',
  referencesDirectory: 'references',
  h3SystemPromptPath: 'prompts/minimax-h3-lmstudio-system.md'
} as const;

const normalizedPath = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/, '');
const isPortableResourcePath = (value: string): boolean => /(?:^|\/)temp\/[^/]+\/resources(?:\/|$)/i.test(normalizedPath(value));

function rebindBundledResourcePaths(candidate: AppSettings, defaults: AppSettings): void {
  for (const [field, identity] of Object.entries(bundledResourceFields) as Array<[keyof typeof bundledResourceFields, string]>) {
    const stored = String(candidate[field] ?? '').trim();
    if (!stored || stored === identity || (isPortableResourcePath(stored) && normalizedPath(stored).toLowerCase().endsWith(`/resources/${identity}`.toLowerCase()))) {
      candidate[field] = defaults[field];
    }
  }
  if (isPortableResourcePath(candidate.remoteOutputDirectory)) candidate.remoteOutputDirectory = defaults.remoteOutputDirectory;
}

/** Store bundled resources by stable identity, never by a portable Temp extraction path. */
export function settingsForStorage(settings: AppSettings, defaults: AppSettings): AppSettings {
  const stored = structuredClone(settings);
  for (const [field, identity] of Object.entries(bundledResourceFields) as Array<[keyof typeof bundledResourceFields, string]>) {
    if (stored[field] === defaults[field] || isPortableResourcePath(stored[field])) stored[field] = identity;
  }
  if (isPortableResourcePath(stored.remoteOutputDirectory)) stored.remoteOutputDirectory = defaults.remoteOutputDirectory;
  return stored;
}

export function getChatWorkspaceUrl(settings: Pick<AppSettings, 'chatGptUrl'>): string {
  try {
    return new URL(settings.chatGptUrl).protocol === 'https:' ? settings.chatGptUrl : chatGptHomeUrl;
  } catch {
    return chatGptHomeUrl;
  }
}

export function mergeSettings(defaults: AppSettings, stored: unknown): AppSettings {
  const candidate = { ...defaults, ...(typeof stored === 'object' && stored ? stored : {}) };
  // The local runner-native application has one production compute target. This also
  // migrates a previously saved Cloudflare URL without requiring user action.
  candidate.computeMode = 'remote';
  candidate.remoteComfyUrl = COMFY_BASE_URL;
  rebindBundledResourcePaths(candidate, defaults);
  if (!candidate.h3PromptEngine || typeof candidate.h3PromptEngine !== 'object') candidate.h3PromptEngine = defaults.h3PromptEngine;
  else if (typeof stored === 'object' && stored !== null && 'h3PromptEngine' in stored) {
    const storedPromptEngine = (stored as { h3PromptEngine?: unknown }).h3PromptEngine;
    const storedTimeout = typeof storedPromptEngine === 'object' && storedPromptEngine !== null
      ? (storedPromptEngine as { timeoutSeconds?: unknown }).timeoutSeconds
      : undefined;
    // 120s was the failing production default; 300s was the interim app/node
    // default. Migrate only these known legacy timeout defaults.
    if (storedTimeout === 120 || storedTimeout === 300) {
      candidate.h3PromptEngine = { ...candidate.h3PromptEngine, timeoutSeconds: h3PromptEngineProductionDefaults.timeoutSeconds };
    }
  }
  if (candidate.h3PromptEngine && typeof candidate.h3PromptEngine === 'object') {
    candidate.h3PromptEngine = { ...candidate.h3PromptEngine, model: h3PromptEngineModelId };
  }
  const parsed = appSettingsSchema.safeParse(candidate);
  if (!parsed.success) return defaults;
  // The H3 prompt model is fixed by the autonomous contract, never selected in
  // Creative Studio. Normalize stale values from the former selector.
  return { ...parsed.data, h3PromptEngine: { ...parsed.data.h3PromptEngine, model: h3PromptEngineModelId } };
}
