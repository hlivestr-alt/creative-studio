import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as NodeSqliteDatabaseSync } from 'node:sqlite';
import type { ChinaSessionBundle, JobPhase, PersistedJob, PersistedSession, SessionSettings } from './types';

const { DatabaseSync } = createRequire(`${process.cwd()}/proya-china-runner-native.cjs`)('node:sqlite') as typeof import('node:sqlite');

const now = () => new Date().toISOString();

type SessionRow = { json: string };
type JobRow = { json: string };

export class ChinaRunnerStore {
  private readonly database: NodeSqliteDatabaseSync;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        bundle_hash TEXT NOT NULL,
        current_job_id TEXT,
        revision INTEGER NOT NULL,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_assets (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        asset_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        PRIMARY KEY(session_id, asset_id)
      );
      CREATE TABLE IF NOT EXISTS settings_versions (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        version INTEGER NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(session_id, version)
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        scheduler_key TEXT NOT NULL,
        phase TEXT NOT NULL,
        prompt_id TEXT,
        revision INTEGER NOT NULL,
        json TEXT NOT NULL,
        UNIQUE(session_id, scheduler_key)
      );
      CREATE TABLE IF NOT EXISTS job_events (
        revision INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        job_id TEXT,
        event_type TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runner_jobs_session_revision ON jobs(session_id, revision);
      CREATE INDEX IF NOT EXISTS idx_runner_events_session_revision ON job_events(session_id, revision);
    `);
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const value = operation();
      this.database.exec('COMMIT');
      return value;
    } catch (reason) {
      this.database.exec('ROLLBACK');
      throw reason;
    }
  }

  private event(sessionId: string, jobId: string | null, eventType: string, payload: unknown): number {
    const result = this.database.prepare('INSERT INTO job_events(session_id,job_id,event_type,json,created_at) VALUES(?,?,?,?,?)')
      .run(sessionId, jobId, eventType, JSON.stringify(payload), now());
    return Number(result.lastInsertRowid);
  }

  stageSession(session: PersistedSession, assetRows: Array<{ id: string; productId: string; path: string; sha256: string; size: number }>): PersistedSession {
    return this.transaction(() => {
      const existing = this.getSession(session.sessionId);
      if (existing) {
        if (existing.bundleHash !== session.bundleHash) throw new Error('Session ID already exists with a different bundle hash.');
        return existing;
      }
      const revision = this.event(session.sessionId, null, 'SESSION_STAGED', { bundleHash: session.bundleHash });
      const staged = { ...session, revision, updatedAt: now() };
      this.database.prepare('INSERT INTO sessions(id,status,bundle_hash,current_job_id,revision,json) VALUES(?,?,?,?,?,?)')
        .run(staged.sessionId, staged.status, staged.bundleHash, staged.currentJobId, staged.revision, JSON.stringify(staged));
      const assetStatement = this.database.prepare('INSERT INTO session_assets(session_id,asset_id,product_id,path,sha256,size) VALUES(?,?,?,?,?,?)');
      for (const asset of assetRows) assetStatement.run(staged.sessionId, asset.id, asset.productId, asset.path, asset.sha256, asset.size);
      this.database.prepare('INSERT INTO settings_versions(session_id,version,json,created_at) VALUES(?,?,?,?)')
        .run(staged.sessionId, staged.settingsVersion, JSON.stringify(staged.bundle.settings), staged.createdAt);
      return staged;
    });
  }

  getSession(id: string): PersistedSession | null {
    const row = this.database.prepare('SELECT json FROM sessions WHERE id=?').get(id) as SessionRow | undefined;
    return row ? JSON.parse(row.json) as PersistedSession : null;
  }

  stagingPersistence(sessionId: string): { assetRecordCount: number; settingsVersions: number[] } {
    const assets = this.database.prepare('SELECT COUNT(*) AS count FROM session_assets WHERE session_id=?').get(sessionId) as { count: number };
    const settings = this.database.prepare('SELECT version FROM settings_versions WHERE session_id=? ORDER BY version').all(sessionId) as Array<{ version: number }>;
    return { assetRecordCount: Number(assets.count), settingsVersions: settings.map(row => Number(row.version)) };
  }

  currentSession(): PersistedSession | null {
    const row = this.database.prepare("SELECT json FROM sessions WHERE status NOT IN ('STOPPED','FAILED','CANARY_FINISHED','TWO_JOB_CANARY_FINISHED') ORDER BY revision DESC LIMIT 1").get() as SessionRow | undefined;
    return row ? JSON.parse(row.json) as PersistedSession : null;
  }

  listSessions(): PersistedSession[] {
    return (this.database.prepare('SELECT json FROM sessions ORDER BY revision DESC').all() as SessionRow[]).map(row => JSON.parse(row.json) as PersistedSession);
  }

  saveSession(session: PersistedSession, eventType = 'SESSION_UPDATED'): PersistedSession {
    return this.transaction(() => {
      const revision = this.event(session.sessionId, session.currentJobId, eventType, session);
      const saved = { ...session, revision, updatedAt: now() };
      this.database.prepare('UPDATE sessions SET status=?,current_job_id=?,revision=?,json=? WHERE id=?')
        .run(saved.status, saved.currentJobId, saved.revision, JSON.stringify(saved), saved.sessionId);
      return saved;
    });
  }

  saveSettings(sessionId: string, version: number, settings: SessionSettings): PersistedSession {
    return this.transaction(() => {
      const session = this.getSession(sessionId);
      if (!session) throw new Error('Unknown session.');
      if (!Number.isSafeInteger(version) || version <= session.settingsVersion) throw new Error('Settings version must increase monotonically.');
      this.database.prepare('INSERT INTO settings_versions(session_id,version,json,created_at) VALUES(?,?,?,?)')
        .run(sessionId, version, JSON.stringify(settings), now());
      const revision = this.event(sessionId, session.currentJobId, 'SETTINGS_COMMITTED', { version });
      const saved = { ...session, settingsVersion: version, revision, updatedAt: now() };
      this.database.prepare('UPDATE sessions SET revision=?,json=? WHERE id=?').run(revision, JSON.stringify(saved), sessionId);
      return saved;
    });
  }

  getSettings(sessionId: string, version: number): SessionSettings {
    const row = this.database.prepare('SELECT json FROM settings_versions WHERE session_id=? AND version=?').get(sessionId, version) as SessionRow | undefined;
    if (!row) throw new Error(`Settings version ${version} does not exist.`);
    return JSON.parse(row.json) as SessionSettings;
  }

  createJob(job: PersistedJob): PersistedJob {
    return this.transaction(() => {
      const existing = this.database.prepare('SELECT json FROM jobs WHERE session_id=? AND scheduler_key=?').get(job.sessionId, job.schedulerKey) as JobRow | undefined;
      if (existing) return JSON.parse(existing.json) as PersistedJob;
      const revision = this.event(job.sessionId, job.jobId, 'JOB_CREATED', { phase: job.phase, schedulerKey: job.schedulerKey });
      const created = { ...job, revision, updatedAt: now() };
      this.database.prepare('INSERT INTO jobs(id,session_id,scheduler_key,phase,prompt_id,revision,json) VALUES(?,?,?,?,?,?,?)')
        .run(created.jobId, created.sessionId, created.schedulerKey, created.phase, created.promptId, created.revision, JSON.stringify(created));
      return created;
    });
  }

  updateJob(jobId: string, phase: JobPhase, update: Partial<PersistedJob> = {}): PersistedJob {
    return this.transaction(() => {
      const current = this.getJob(jobId);
      if (!current) throw new Error('Unknown job.');
      const revision = this.event(current.sessionId, current.jobId, `JOB_${phase}`, update);
      const timestamp = now();
      const saved = { ...current, ...update, phase, revision, updatedAt: timestamp, ...(['COMPLETED', 'FAILED'].includes(phase) && !update.completedAt ? { completedAt: current.completedAt ?? timestamp } : {}) };
      this.database.prepare('UPDATE jobs SET phase=?,prompt_id=?,revision=?,json=? WHERE id=?')
        .run(saved.phase, saved.promptId, saved.revision, JSON.stringify(saved), jobId);
      return saved;
    });
  }

  getJob(id: string): PersistedJob | null {
    const row = this.database.prepare('SELECT json FROM jobs WHERE id=?').get(id) as JobRow | undefined;
    return row ? JSON.parse(row.json) as PersistedJob : null;
  }

  listJobs(sessionId?: string, afterRevision = 0): PersistedJob[] {
    const rows = sessionId
      ? this.database.prepare('SELECT json FROM jobs WHERE session_id=? AND revision>? ORDER BY revision').all(sessionId, afterRevision)
      : this.database.prepare('SELECT json FROM jobs WHERE revision>? ORDER BY revision').all(afterRevision);
    return (rows as JobRow[]).map(row => JSON.parse(row.json) as PersistedJob);
  }

  eventCount(): number {
    return Number((this.database.prepare('SELECT COUNT(*) AS count FROM job_events').get() as { count: number }).count);
  }

  close(): void { this.database.close(); }
}

export function newPersistedSession(bundle: ChinaSessionBundle, bundleHash: string, sessionDirectory: string): PersistedSession {
  const timestamp = now();
  return {
    sessionId: bundle.sessionId,
    status: 'STAGED',
    bundleHash,
    bundle,
    sessionDirectory,
    productIndex: 0,
    contentTypeIndex: 0,
    cycleNumber: 1,
    cycleSeed: 0x5eedc0de,
    currentJobId: null,
    settingsVersion: bundle.initialSettingsVersion,
    stopAfterCurrent: false,
    stopNow: false,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastError: null
  };
}
