import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { CaptionMode, HistoryInput, HistoryRecord, HistoryUpdate, RequestedSlideCount } from '../../src/domain/types';

const localRequire = createRequire(__filename);

type StoredHistoryRecord = Omit<HistoryRecord, 'workflowMode' | 'postStructure' | 'requestedSlideCount' | 'captionMode'> & {
  workflowMode: string;
  postStructure: string;
  requestedSlideCount: string | number | null;
  captionMode: string;
};

const normalizeRequestedSlideCount = (value: string | number | null): RequestedSlideCount | null => {
  if (value === null || value === '') return null;
  if (value === 'AUTO') return 'AUTO';
  const numeric = Number(value);
  return [3, 4, 5, 6, 7, 8].includes(numeric) ? numeric as RequestedSlideCount : null;
};

const normalizeCaptionMode = (value: string | null | undefined): CaptionMode => value === 'SHORT' || value === 'DETAILED' || value === 'NONE' ? value : 'STANDARD';

const normalizeHistoryRecord = (row: StoredHistoryRecord): HistoryRecord => ({
  ...row,
  workflowMode: row.workflowMode === 'DIRECT_IMAGE' ? 'DIRECT_IMAGE' : 'EXPLORE_IDEAS',
  postStructure: row.postStructure === 'CAROUSEL' ? 'CAROUSEL' : 'SINGLE_IMAGE',
  requestedSlideCount: normalizeRequestedSlideCount(row.requestedSlideCount),
  captionMode: normalizeCaptionMode(row.captionMode)
});

const storedSlideCount = (value: RequestedSlideCount | null): string | null => value === null ? null : String(value);

export async function loadSqlite(): Promise<SqlJsStatic> {
  const wasmPath = localRequire.resolve('sql.js/dist/sql-wasm.wasm');
  return initSqlJs({ locateFile: () => wasmPath });
}

export class HistoryDatabase {
  private readonly database: Database;

  constructor(private readonly path: string, SQL: SqlJsStatic) {
    this.database = existsSync(path) ? new SQL.Database(readFileSync(path)) : new SQL.Database();
    this.database.run(`
      CREATE TABLE IF NOT EXISTS creative_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        product TEXT NOT NULL,
        workflowMode TEXT NOT NULL DEFAULT 'EXPLORE_IDEAS' CHECK(workflowMode IN ('DIRECT_IMAGE','EXPLORE_IDEAS')),
        postStructure TEXT NOT NULL DEFAULT 'SINGLE_IMAGE' CHECK(postStructure IN ('SINGLE_IMAGE','CAROUSEL')),
        requestedSlideCount TEXT DEFAULT NULL CHECK(requestedSlideCount IS NULL OR requestedSlideCount IN ('AUTO','3','4','5','6','7','8')),
        captionMode TEXT NOT NULL DEFAULT 'STANDARD' CHECK(captionMode IN ('SHORT','STANDARD','DETAILED','NONE')),
        postType TEXT NOT NULL,
        topic TEXT NOT NULL,
        visualStyle TEXT NOT NULL,
        creativityLevel TEXT NOT NULL,
        format TEXT NOT NULL,
        language TEXT NOT NULL,
        preparedBrief TEXT NOT NULL,
        conceptTitle TEXT,
        headline TEXT,
        status TEXT NOT NULL CHECK(status IN ('Prepared','Used','Rejected','Archived')),
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_history_created_at ON creative_history(createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_history_status_product ON creative_history(status, product);
    `);
    const columns = this.query<{ name: string }>('PRAGMA table_info(creative_history)');
    if (!columns.some((column) => column.name === 'workflowMode')) {
      this.database.run("ALTER TABLE creative_history ADD COLUMN workflowMode TEXT NOT NULL DEFAULT 'EXPLORE_IDEAS'");
    }
    if (!columns.some((column) => column.name === 'postStructure')) {
      this.database.run("ALTER TABLE creative_history ADD COLUMN postStructure TEXT NOT NULL DEFAULT 'SINGLE_IMAGE'");
    }
    if (!columns.some((column) => column.name === 'requestedSlideCount')) {
      this.database.run('ALTER TABLE creative_history ADD COLUMN requestedSlideCount TEXT DEFAULT NULL');
    }
    if (!columns.some((column) => column.name === 'captionMode')) {
      this.database.run("ALTER TABLE creative_history ADD COLUMN captionMode TEXT NOT NULL DEFAULT 'STANDARD'");
    }
    this.persist();
  }

  private query<T>(sql: string, params: Array<string | number | null> = []): T[] {
    const statement = this.database.prepare(sql);
    try {
      statement.bind(params);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally { statement.free(); }
  }

  private persist(): void {
    writeFileSync(this.path, Buffer.from(this.database.export()));
  }

  list(limit = 100): HistoryRecord[] {
    return this.query<StoredHistoryRecord>('SELECT * FROM creative_history ORDER BY datetime(createdAt) DESC LIMIT ?', [limit]).map(normalizeHistoryRecord);
  }

  create(input: HistoryInput): HistoryRecord {
    this.database.run(`
      INSERT INTO creative_history (product, workflowMode, postStructure, requestedSlideCount, captionMode, postType, topic, visualStyle, creativityLevel, format, language, preparedBrief, conceptTitle, headline, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [input.product, input.workflowMode, input.postStructure, storedSlideCount(input.requestedSlideCount), input.captionMode, input.postType, input.topic, input.visualStyle, input.creativityLevel, input.format, input.language, input.preparedBrief, input.conceptTitle, input.headline, input.status, input.notes]);
    const id = this.query<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id;
    this.persist();
    return normalizeHistoryRecord(this.query<StoredHistoryRecord>('SELECT * FROM creative_history WHERE id = ?', [id])[0]);
  }

  update(id: number, update: HistoryUpdate): HistoryRecord {
    const existingRow = this.query<StoredHistoryRecord>('SELECT * FROM creative_history WHERE id = ?', [id])[0];
    if (!existingRow) throw new Error('History record not found');
    const existing = normalizeHistoryRecord(existingRow);
    const merged = { ...existing, ...update };
    this.database.run('UPDATE creative_history SET status=?, conceptTitle=?, headline=?, notes=? WHERE id=?', [merged.status, merged.conceptTitle, merged.headline, merged.notes, id]);
    this.persist();
    return normalizeHistoryRecord(this.query<StoredHistoryRecord>('SELECT * FROM creative_history WHERE id = ?', [id])[0]);
  }

  close(): void { this.persist(); this.database.close(); }
}
