import { readFileSync, writeFileSync } from 'node:fs';
import type { AppSettings } from '../../src/domain/types';
import { mergeSettings, settingsForStorage } from '../../src/domain/settings';

export class SettingsStore {
  constructor(private readonly path: string, private readonly defaults: AppSettings) {}

  get(): AppSettings {
    try {
      const stored = JSON.parse(readFileSync(this.path, 'utf8'));
      const settings = mergeSettings(this.defaults, stored);
      const persisted = settingsForStorage(settings, this.defaults);
      if (JSON.stringify(stored) !== JSON.stringify(persisted)) writeFileSync(this.path, JSON.stringify(persisted, null, 2), 'utf8');
      return settings;
    }
    catch { return this.defaults; }
  }

  set(settings: AppSettings): AppSettings {
    const validated = mergeSettings(this.defaults, settings);
    writeFileSync(this.path, JSON.stringify(settingsForStorage(validated, this.defaults), null, 2), 'utf8');
    return validated;
  }
}
