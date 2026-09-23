import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/domain/settings';
import { SettingsStore } from './settings-store';

describe('portable bundled-resource settings migration', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

  it('loads from the current extraction and rewrites old absolute resource paths as logical identities', () => {
    const root = mkdtempSync(join(tmpdir(), 'proya-settings-'));
    roots.push(root);
    const path = join(root, 'settings.json');
    const launchA = defaultSettings(String.raw`C:\Temp\AAA\resources`);
    writeFileSync(path, JSON.stringify(launchA), 'utf8');

    const launchB = defaultSettings(String.raw`C:\Temp\BBB\resources`);
    launchB.remoteOutputDirectory = String.raw`C:\Stable\PROYA\outputs`;
    const loaded = new SettingsStore(path, launchB).get();

    expect(loaded.productAssetsDirectory).toBe(String.raw`C:\Temp\BBB\resources/product-assets`);
    expect(loaded.remoteComfyWorkflowPath).toBe(String.raw`C:\Temp\BBB\resources/workflows/minimax-h3-api.json`);
    expect(loaded.referencesDirectory).toBe(String.raw`C:\Temp\BBB\resources/references`);
    expect(loaded.h3SystemPromptPath).toBe(String.raw`C:\Temp\BBB\resources/prompts/minimax-h3-lmstudio-system.md`);
    expect(loaded.remoteOutputDirectory).toBe(String.raw`C:\Stable\PROYA\outputs`);

    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    expect(persisted).toMatchObject({
      remoteComfyWorkflowPath: 'workflows/minimax-h3-api.json',
      productAssetsDirectory: 'product-assets',
      referencesDirectory: 'references',
      h3SystemPromptPath: 'prompts/minimax-h3-lmstudio-system.md',
      remoteOutputDirectory: String.raw`C:\Stable\PROYA\outputs`
    });
    expect(JSON.stringify(persisted)).not.toContain(String.raw`C:\Temp\AAA\resources`);
  });
});
