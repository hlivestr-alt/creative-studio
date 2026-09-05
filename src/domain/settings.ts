import { h3WorkflowTemplateDefaults } from './minimax-h3-workflow';
import { h3PromptEngineModelId, h3PromptEngineProductionDefaults, type AppSettings, type H3PromptEngineSettings } from './types';
import { appSettingsSchema } from './schemas';

export const chatGptHomeUrl = 'https://chatgpt.com/';
export const defaultRemoteComfyUrl = 'https://comfy.proyaofficial.com';

export const defaultH3PromptEngineSettings: H3PromptEngineSettings = {
  provider: 'lmstudio-remote',
  endpoint: 'http://127.0.0.1:1234/v1',
  model: h3PromptEngineModelId,
  ...h3PromptEngineProductionDefaults,
  unloadModelBeforeH3: true
};

export const defaultSettings = (projectRoot: string): AppSettings => ({
  chatGptUrl: chatGptHomeUrl,
  computeMode: 'local',
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

export function getChatWorkspaceUrl(settings: Pick<AppSettings, 'chatGptUrl'>): string {
  try {
    return new URL(settings.chatGptUrl).protocol === 'https:' ? settings.chatGptUrl : chatGptHomeUrl;
  } catch {
    return chatGptHomeUrl;
  }
}

export function mergeSettings(defaults: AppSettings, stored: unknown): AppSettings {
  const candidate = { ...defaults, ...(typeof stored === 'object' && stored ? stored : {}) };
  if (!candidate.remoteComfyWorkflowPath.trim()) candidate.remoteComfyWorkflowPath = defaults.remoteComfyWorkflowPath;
  if (!candidate.h3SystemPromptPath?.trim()) candidate.h3SystemPromptPath = defaults.h3SystemPromptPath;
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
