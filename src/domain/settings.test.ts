import { describe, expect, it } from 'vitest';
import { chatGptHomeUrl, defaultSettings, getChatWorkspaceUrl, mergeSettings } from './settings';
import { captionModes } from './types';

describe('settings defaults', () => {
  it('uses requested safe defaults', () => {
    const defaults = defaultSettings('C:/Studio');
    expect(defaults.chatGptUrl).toBe(chatGptHomeUrl);
    expect(defaults.defaultLanguage).toBe('Indonesian');
    expect(defaults.defaultFormat).toBe('Instagram Feed 4:5');
    expect(defaults.defaultCreativity).toBe('Balanced');
    expect(defaults.defaultWorkflowMode).toBe('DIRECT_IMAGE');
    expect(defaults.defaultPostStructure).toBe('SINGLE_IMAGE');
    expect(defaults.defaultCaptionMode).toBe('STANDARD');
  });

  it('falls back completely when persisted settings are invalid', () => {
    const defaults = defaultSettings('C:/Studio');
    expect(mergeSettings(defaults, { recentHistoryWindow: 0, chatGptUrl: 'http://unsafe.test' })).toEqual(defaults);
  });

  it('persists the selected workflow mode through settings validation', () => {
    const defaults = defaultSettings('C:/Studio');
    expect(mergeSettings(defaults, { defaultWorkflowMode: 'EXPLORE_IDEAS' }).defaultWorkflowMode).toBe('EXPLORE_IDEAS');
    expect(mergeSettings(defaults, { defaultPostStructure: 'CAROUSEL' }).defaultPostStructure).toBe('CAROUSEL');
  });

  it('validates every caption mode and rejects unsupported values', () => {
    const defaults = defaultSettings('C:/Studio');
    for (const mode of captionModes) {
      expect(mergeSettings(defaults, { defaultCaptionMode: mode }).defaultCaptionMode).toBe(mode);
    }
    expect(mergeSettings(defaults, { defaultCaptionMode: 'LONG' })).toEqual(defaults);
  });

  it('persists a Creative Project URL and falls back safely for invalid targets', () => {
    const defaults = defaultSettings('C:/Studio');
    const projectUrl = 'https://chatgpt.com/g/g-proya-creative-project';
    const stored = mergeSettings(defaults, { chatGptUrl: projectUrl });
    expect(stored.chatGptUrl).toBe(projectUrl);
    expect(getChatWorkspaceUrl(stored)).toBe(projectUrl);
    expect(getChatWorkspaceUrl({ chatGptUrl: 'http://unsafe.test' })).toBe(chatGptHomeUrl);
  });
});
