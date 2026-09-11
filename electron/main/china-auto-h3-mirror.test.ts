import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HistoryDatabase, loadSqlite } from './database';

describe('China authoritative session laptop mirror', () => {
  it('persists visibility metadata only, with no scheduler fields', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proya-china-mirror-'));
    try {
      const db = new HistoryDatabase(join(root, 'db.sqlite'), await loadSqlite());
      db.saveChinaAutoMirror({ sessionId: 'session', lastKnownRevision: 5, bundleHash: 'a'.repeat(64), runnerVersion: 'r7', connectionState: 'connected', lastSuccessfulSync: '2026-09-09T00:00:00.000Z', settingsVersionIdentity: 'b'.repeat(64), stagingState: 'STAGED_READY', createdTimestamp: '2026-09-09T00:00:00.000Z' });
      const mirror = db.getChinaAutoMirror('session');
      expect(mirror).toEqual({ sessionId: 'session', lastKnownRevision: 5, bundleHash: 'a'.repeat(64), runnerVersion: 'r7', connectionState: 'connected', lastSuccessfulSync: '2026-09-09T00:00:00.000Z', settingsVersionIdentity: 'b'.repeat(64), stagingState: 'STAGED_READY', createdTimestamp: '2026-09-09T00:00:00.000Z' });
      expect(Object.keys(mirror ?? {})).not.toEqual(expect.arrayContaining(['status', 'jobs', 'productIndex', 'schedulerKey']));
      db.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
