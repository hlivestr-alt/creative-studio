import { readFileSync, writeFileSync } from 'node:fs';
import type { AppSettings } from '../../src/domain/types';
import { mergeSettings } from '../../src/domain/settings';

export class SettingsStore {
  constructor(private readonly path: string, private readonly defaults: AppSettings) {}

  get(): AppSettings {
    try { return mergeSettings(this.defaults, JSON.parse(readFileSync(this.path, 'utf8'))); }
    catch { return this.defaults; }
  }

  set(settings: AppSettings): AppSettings {
    const validated = mergeSettings(this.defaults, settings);
    writeFileSync(this.path, JSON.stringify(validated, null, 2), 'utf8');
    return validated;
  }
}
