import type { AppSettings } from './types';
import { appSettingsSchema } from './schemas';

export const chatGptHomeUrl = 'https://chatgpt.com/';

export const defaultSettings = (projectRoot: string): AppSettings => ({
  chatGptUrl: chatGptHomeUrl,
  defaultLanguage: 'Indonesian',
  defaultFormat: 'Instagram Feed 4:5',
  defaultCreativity: 'Balanced',
  defaultWorkflowMode: 'DIRECT_IMAGE',
  defaultPostStructure: 'SINGLE_IMAGE',
  defaultCaptionMode: 'STANDARD',
  recentHistoryWindow: 20,
  productAssetsDirectory: `${projectRoot}/product-assets`,
  referencesDirectory: `${projectRoot}/references`,
  splitRatio: 0.5
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
  const parsed = appSettingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : defaults;
}
