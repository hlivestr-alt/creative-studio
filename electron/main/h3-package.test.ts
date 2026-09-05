import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { verifyH3Package } = require('../../scripts/verify-h3-package.cjs');
const packageResources = process.env.H3_PACKAGE_RESOURCES ?? join(process.cwd(), 'release/h3-vram-handoff/win-unpacked/resources');

describe('H3 packaged workflow contract', () => {
  it.skipIf(!existsSync(packageResources))('checks the actual handoff package against source', () => {
    // Clean CI builds exercise the same mandatory check in afterPack.
    expect(verifyH3Package(process.cwd(), packageResources)).toMatchObject({ staleOccurrences: 0 });
  });

  it('rejects a stale packaged workflow even when source is clean', () => {
    const resources = mkdtempSync(join(tmpdir(), 'h3-package-'));
    try {
      mkdirSync(join(resources, 'workflows'));
      const workflow = JSON.parse(readFileSync(join(process.cwd(), 'workflows/minimax-h3-api.json'), 'utf8'));
      workflow['149'].inputs.max_tokens = '{{H3_MAX_TOKENS}}';
      writeFileSync(join(resources, 'workflows/minimax-h3-api.json'), JSON.stringify(workflow));
      expect(() => verifyH3Package(process.cwd(), resources)).toThrow(/obsolete output-token input/);
    } finally {
      rmSync(resources, { recursive: true, force: true });
    }
  });
});
