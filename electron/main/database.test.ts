import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryDatabase, loadSqlite } from './database';

let temporaryDirectory: string | undefined;
afterEach(() => { if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = undefined; });

describe('SQLite history repository', () => {
  it('persists a prepared session and a later Used update across reopen', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-history-'));
    const path = join(temporaryDirectory, 'history.sqlite');
    const SQL = await loadSqlite();
    const database = new HistoryDatabase(path, SQL);
    const created = database.create({
      product: 'serum', postType: 'Product Hero', topic: 'Brightening hero', visualStyle: 'Citrus Light',
      workflowMode: 'DIRECT_IMAGE', postStructure: 'CAROUSEL', requestedSlideCount: 5, captionMode: 'STANDARD', creativityLevel: 'Balanced', format: 'Instagram Feed 4:5', language: 'Indonesian', preparedBrief: '# ROLE',
      conceptTitle: null, headline: null, status: 'Prepared', notes: null
    });
    database.update(created.id, { status: 'Used', conceptTitle: 'Vitamin C Sunrise', headline: 'START BRIGHT.' });
    database.close();

    const reopened = new HistoryDatabase(path, SQL);
    expect(reopened.list()).toMatchObject([{ id: created.id, workflowMode: 'DIRECT_IMAGE', postStructure: 'CAROUSEL', requestedSlideCount: 5, captionMode: 'STANDARD', status: 'Used', conceptTitle: 'Vitamin C Sunrise', headline: 'START BRIGHT.' }]);
    reopened.close();
  });

  it('migrates existing history rows to the legacy Explore 3 Ideas mode', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-history-'));
    const path = join(temporaryDirectory, 'history.sqlite');
    const SQL = await loadSqlite();
    const legacy = new SQL.Database();
    legacy.run(`
      CREATE TABLE creative_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        product TEXT NOT NULL,
        postType TEXT NOT NULL,
        topic TEXT NOT NULL,
        visualStyle TEXT NOT NULL,
        creativityLevel TEXT NOT NULL,
        format TEXT NOT NULL,
        language TEXT NOT NULL,
        preparedBrief TEXT NOT NULL,
        conceptTitle TEXT,
        headline TEXT,
        status TEXT NOT NULL,
        notes TEXT
      );
      INSERT INTO creative_history (product, postType, topic, visualStyle, creativityLevel, format, language, preparedBrief, status)
      VALUES ('serum', 'Product Hero', 'Brightening hero', 'Citrus Light', 'Balanced', 'Instagram Feed 4:5', 'Indonesian', '# ROLE', 'Prepared');
    `);
    writeFileSync(path, Buffer.from(legacy.export()));
    legacy.close();

    const database = new HistoryDatabase(path, SQL);
    expect(database.list()[0]).toMatchObject({ workflowMode: 'EXPLORE_IDEAS', postStructure: 'SINGLE_IMAGE', requestedSlideCount: null, captionMode: 'STANDARD' });
    database.close();
  });
});
