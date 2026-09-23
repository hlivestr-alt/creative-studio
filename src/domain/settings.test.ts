import { describe, expect, it } from 'vitest';
import { basename, join } from 'node:path';
import { products } from './data';
import { chatGptHomeUrl, defaultRemoteComfyUrl, defaultSettings, getChatWorkspaceUrl, mergeSettings, settingsForStorage } from './settings';
import { captionModes } from './types';

describe('settings defaults', () => {
  it('uses requested safe defaults', () => {
    const defaults = defaultSettings('C:/Studio');
    expect(defaults.chatGptUrl).toBe(chatGptHomeUrl);
    expect(defaults.computeMode).toBe('remote');
    expect(defaults.remoteComfyUrl).toBe(defaultRemoteComfyUrl);
    expect(defaults.remoteComfyWorkflowPath).toBe('C:/Studio/workflows/minimax-h3-api.json');
    expect(defaults.remoteOutputDirectory).toBe('C:/Studio/outputs');
    expect(defaults.remoteAutoDownload).toBe(true);
    expect(defaults.defaultLanguage).toBe('Indonesian');
    expect(defaults.defaultFormat).toBe('Instagram Feed 4:5');
    expect(defaults.defaultCreativity).toBe('Balanced');
    expect(defaults.defaultWorkflowMode).toBe('DIRECT_IMAGE');
    expect(defaults.defaultPostStructure).toBe('SINGLE_IMAGE');
    expect(defaults.defaultCaptionMode).toBe('STANDARD');
    expect(defaults.h3WorkflowSettings).toMatchObject({ durationSeconds: 8, aspectRatio: '9:16', megapixels: 0.98, multiple: 32, fps: 24, steps: 20, scheduler: 'simple', seedMode: 'random', seed: 0, refImageSize: 'max' });
    expect(defaults.h3PromptEngine).toMatchObject({ temperature: 0.2, repairAttempts: 2, disableThinking: true, timeoutSeconds: 600 });
    expect(defaults.h3PromptEngine).not.toHaveProperty('maxTokens');
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

  it('migrates persisted compute settings to the fixed local engine', () => {
    const defaults = defaultSettings('C:/Studio');
    const stored = mergeSettings(defaults, { computeMode: 'remote', remoteComfyUrl: 'https://comfy.example.test', remoteComfyWorkflowPath: 'C:/workflows/h3-api.json' });
    expect(stored.computeMode).toBe('remote');
    expect(stored.remoteComfyUrl).toBe(defaultRemoteComfyUrl);
    expect(stored.remoteComfyWorkflowPath).toBe('C:/workflows/h3-api.json');
    expect(stored.h3PromptEngine).toEqual(defaults.h3PromptEngine);
  });

  it('migrates the previous empty workflow path to the bundled API workflow', () => {
    const defaults = defaultSettings('C:/Studio');
    expect(mergeSettings(defaults, { remoteComfyWorkflowPath: '' }).remoteComfyWorkflowPath).toBe(defaults.remoteComfyWorkflowPath);
  });

  it('rebinds a stale portable extraction workflow path without replacing a custom workflow', () => {
    const defaults = defaultSettings('C:/Temp/current/resources');
    expect(mergeSettings(defaults, { remoteComfyWorkflowPath: 'C:\\Temp\\previous\\resources/workflows/minimax-h3-api.json' }).remoteComfyWorkflowPath)
      .toBe(defaults.remoteComfyWorkflowPath);
    expect(mergeSettings(defaults, { remoteComfyWorkflowPath: 'C:/Custom/workflows/my-h3-api.json' }).remoteComfyWorkflowPath)
      .toBe('C:/Custom/workflows/my-h3-api.json');
  });

  it('rebinds every product master from launch A to launch B and stores only logical bundled identities', () => {
    const launchADirectory = String.raw`C:\Temp\AAA\resources\product-assets`;
    const launchB = defaultSettings(String.raw`C:\Temp\BBB\resources`);
    const resolved = mergeSettings(launchB, {
      remoteComfyWorkflowPath: String.raw`C:\Temp\AAA\resources\workflows\minimax-h3-api.json`,
      productAssetsDirectory: launchADirectory,
      referencesDirectory: String.raw`C:\Temp\AAA\resources\references`,
      h3SystemPromptPath: String.raw`C:\Temp\AAA\resources\prompts\minimax-h3-lmstudio-system.md`,
      remoteOutputDirectory: String.raw`C:\Temp\AAA\resources\outputs`
    });
    expect(resolved.productAssetsDirectory).toBe(String.raw`C:\Temp\BBB\resources/product-assets`);
    for (const product of products) {
      const master = join(resolved.productAssetsDirectory, basename(product.imagePath.replaceAll('\\', '/')));
      expect(master).toContain(join('Temp', 'BBB', 'resources', 'product-assets'));
      expect(master).not.toContain(join('Temp', 'AAA', 'resources', 'product-assets'));
    }
    expect([...new Set(products.map(product => basename(product.imagePath)))].sort()).toEqual([
      'cleanser.png', 'eye-cream.png', 'mask.png', 'serum.png', 'skin-cream.png', 'toner.png'
    ]);
    expect(settingsForStorage(resolved, launchB)).toMatchObject({
      remoteComfyWorkflowPath: 'workflows/minimax-h3-api.json',
      productAssetsDirectory: 'product-assets',
      referencesDirectory: 'references',
      h3SystemPromptPath: 'prompts/minimax-h3-lmstudio-system.md'
    });
  });

  it('replaces every non-local ComfyUI URL', () => {
    const defaults = defaultSettings('C:/Studio');
    expect(mergeSettings(defaults, { remoteComfyUrl: 'http://comfy.example.test' }).remoteComfyUrl).toBe(defaultRemoteComfyUrl);
    expect(mergeSettings(defaults, { remoteComfyUrl: 'https://comfy.example.test' }).remoteComfyUrl).toBe(defaultRemoteComfyUrl);
  });

  it('persists exact H3 workflow settings without storing references', () => {
    const defaults = defaultSettings('C:/Studio');
    const h3WorkflowSettings = { ...defaults.h3WorkflowSettings, durationSeconds: 11, aspectRatio: '21:9' as const, steps: 36, scheduler: 'beta' as const, seedMode: 'fixed' as const, seed: 987654, refImageSize: 'match' as const };
    const stored = mergeSettings(defaults, { h3WorkflowSettings });

    expect(stored.h3WorkflowSettings).toEqual(h3WorkflowSettings);
    expect(stored.h3WorkflowSettings).not.toHaveProperty('references');
    expect(mergeSettings(defaults, { h3WorkflowSettings: { ...h3WorkflowSettings, steps: 0 } })).toEqual(defaults);
  });

  it('migrates legacy prompt-engine defaults without retaining output-token ownership', () => {
    const defaults = defaultSettings('C:/Studio');
    expect(mergeSettings(defaults, { h3PromptEngine: { ...defaults.h3PromptEngine, timeoutSeconds: 120 } }).h3PromptEngine.timeoutSeconds).toBe(600);
    expect(mergeSettings(defaults, { h3PromptEngine: { ...defaults.h3PromptEngine, timeoutSeconds: 300 } }).h3PromptEngine.timeoutSeconds).toBe(600);
    expect(mergeSettings(defaults, { h3PromptEngine: { ...defaults.h3PromptEngine, timeoutSeconds: 450 } }).h3PromptEngine.timeoutSeconds).toBe(450);
    expect(mergeSettings(defaults, { h3PromptEngine: { ...defaults.h3PromptEngine, maxTokens: 16128 } }).h3PromptEngine).not.toHaveProperty('maxTokens');
    expect(mergeSettings(defaults, { h3PromptEngine: { ...defaults.h3PromptEngine, maxTokens: 4096 } }).h3PromptEngine).not.toHaveProperty('maxTokens');
    expect(mergeSettings(defaults, { h3PromptEngine: { ...defaults.h3PromptEngine, model: 'legacy/user-selected-model' } }).h3PromptEngine.model).toBe('qwen/qwen3.8-27b');
  });
});
