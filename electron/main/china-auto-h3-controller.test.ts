import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { products } from '../../src/domain/data';
import { createOptionalH3ReferencePlan } from '../../src/domain/h3';
import { defaultSettings } from '../../src/domain/settings';
import type { AutoH3Config, ChinaAutoSessionMirror } from '../../src/domain/auto-h3';
import type { H3VideoBrief } from '../../src/domain/types';
import type { ChinaSessionBundle, PersistedJob, PersistedSession, RunnerCapabilities } from '../../src/china-runner/types';
import type { HistoryDatabase } from './database';
import { ChinaAutoH3Client } from './china-auto-h3-client';
import { ChinaAutoH3ShadowController } from './china-auto-h3-controller';

const cleanser = products.find(product => product.id === 'cleanser')!;
const brief: H3VideoBrief = { product: 'cleanser', contentType: 'UGC Content', creativeVariety: 'Balanced', videoIdea: '', language: 'English', musicOnly: true, captions: false, subtitles: false, goal: 'Product reveal', customGoal: '', duration: 4, aspectRatio: '9:16', customAspectRatio: '', qualityPreset: 'Custom', megapixels: 0.98, multiple: 32, fps: 24, steps: 20, seedMode: 'random', seed: 42, refImageSize: 'max', workflowMode: 'REF2VA', cameraMotion: 'Cinematic', actionIntensity: 'High', pacing: 'Balanced', productFidelity: 'Exact', scheduler: 'simple', ending: 'Hero Shot', customEnding: '', sound: 'Music Only', promptDetail: 'Production', specialInstructions: '', references: createOptionalH3ReferencePlan(cleanser) };
const config = (): AutoH3Config => ({ selectedProducts: ['cleanser'], selectedContentTypes: ['UGC Content', 'Educational'], shuffleProducts: false, shuffleContentTypes: false, chinaRoot: String.raw`D:\AI Videos`, laptopRoot: 'C:/not-hashed-or-used-by-china', brief: structuredClone(brief) });
const tempRoots: string[] = [];
afterEach(() => { for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function harness() {
  let latest: ChinaAutoSessionMirror | null = null;
  const writes: ChinaAutoSessionMirror[] = [];
  const sessions = new Map<string, PersistedSession>();
  let capabilities: RunnerCapabilities = { runnerVersion: '1.1.0-shadow.20260909', bundleSchemaVersion: 1, mode: 'shadow', listenAddress: '127.0.0.1:8787', comfyUrl: 'http://127.0.0.1:8188', lmStudioUrl: 'http://127.0.0.1:1234', archiveRoot: String.raw`D:\AI Videos`, generationEnabled: false, promptSubmissionEnabled: false, canaryStartEnabled: false, maxJobsPerSession: 1 };
  const db = {
    getLatestChinaAutoDraft: () => latest,
    getChinaAutoMirror: (id: string) => latest?.sessionId === id ? latest : null,
    saveChinaAutoMirror: (value: ChinaAutoSessionMirror) => { latest = structuredClone(value); writes.push(structuredClone(value)); }
  } as unknown as HistoryDatabase;
  const stageSession = vi.fn(async (bundle: ChinaSessionBundle) => {
    expect(latest).toMatchObject({ sessionId: bundle.sessionId, bundleHash: bundle.bundleSha256, stagingState: 'STAGING' });
    let session = sessions.get(bundle.sessionId);
    if (!session) {
      session = { sessionId: bundle.sessionId, status: 'STAGED', bundleHash: bundle.bundleSha256, bundle, settingsVersion: 1, revision: 1, productIndex: 0, contentTypeIndex: 0, cycleNumber: 1, cycleSeed: 42, sessionDirectory: `${String.raw`D:\AI Videos\.proya-auto\sessions`}\\${bundle.sessionId}` } as PersistedSession;
      sessions.set(bundle.sessionId, session);
    }
    return { staged: true as const, sessionId: session.sessionId, revision: session.revision, bundleHash: session.bundleHash, sessionDirectory: session.sessionDirectory, mode: 'shadow' as const };
  });
  const startCanary = vi.fn(async (...identity: [string, string]) => { void identity; return { started: true, idempotent: false }; });
  const capabilitiesRequest = vi.fn(async () => capabilities);
  const healthRequest = vi.fn(async () => ({ ready: true, comfy: { ready: true }, qwenModelAvailable: true }));
  const client = {
    capabilities: capabilitiesRequest,
    stageSession,
    currentSession: async () => ({ session: [...sessions.values()].at(-1) ?? null }),
    session: async (id: string) => { const session = sessions.get(id) ?? null; return { session, persistence: session ? { assetRecordCount: session.bundle.assets.length, settingsVersions: [1] } : null }; },
    health: healthRequest,
    startCanary,
    jobs: async () => ({ jobs: [] })
  } as unknown as ChinaAutoH3Client;
  const controller = new ChinaAutoH3ShadowController(db, () => defaultSettings(process.cwd()), () => client);
  return { controller, db, client, capabilitiesRequest, healthRequest, stageSession, startCanary, sessions, writes, setCapabilities: (value: Partial<RunnerCapabilities>) => { capabilities = { ...capabilities, ...value }; } };
}

describe('Phase 3A persisted staging identity', () => {
  it('stages identical Cleanser / UGC + Educational configuration twice as one logical session', async () => {
    const { controller, stageSession, sessions, writes } = harness();
    const first = await controller.stage(config());
    const second = await controller.stage(config());
    expect(second).toMatchObject({ bundleId: first.bundleId, bundleSha256: first.bundleSha256, assetsStaged: 1, assetsExpected: 1, stageStatus: 'STAGED / READY' });
    expect(stageSession.mock.calls.map(call => [call[0].sessionId, call[0].bundleSha256])).toEqual([[first.bundleId, first.bundleSha256], [first.bundleId, first.bundleSha256]]);
    expect(sessions.size).toBe(1);
    expect(writes[0]).toMatchObject({ sessionId: first.bundleId, bundleHash: first.bundleSha256, stagingState: 'STAGING' });
  });

  it('requires an explicit updated/new action when immutable configuration changes', async () => {
    const { controller } = harness();
    const first = await controller.stage(config());
    const changed = config(); changed.brief.duration = 8;
    await expect(controller.stage(changed)).rejects.toThrow(/Stage Updated Session/);
    expect((await controller.stage(changed, true)).bundleId).not.toBe(first.bundleId);
    expect((await controller.newDraft(changed)).sessionId).not.toBe(first.bundleId);
  });

  it('refreshes Phase 3B readiness from live capabilities and the persisted staged identity', async () => {
    const { controller, setCapabilities } = harness();
    const staged = await controller.stage(config());
    setCapabilities({ runnerVersion: '1.2.0-canary.20260909', mode: 'canary', generationEnabled: true, promptSubmissionEnabled: true, canaryStartEnabled: true, maxJobsPerSession: 1 });
    await expect(controller.canaryReadiness()).resolves.toMatchObject({
      runner: { mode: 'canary', generationEnabled: true, canaryStartEnabled: true, maxJobsPerSession: 1 },
      proxyStartEndpointAvailable: true,
      healthReady: true,
      session: { sessionId: staged.bundleId, bundleHash: staged.bundleSha256, status: 'STAGED' },
      stagedReady: true
    });
  });

  it('shows the deterministic Phase 3C plan and sends exactly one runner Start', async () => {
    const { controller, setCapabilities, startCanary } = harness();
    const staged = await controller.stage(config());
    setCapabilities({ runnerVersion: '1.3.0-two-job-canary.20260909', mode: 'two-job-canary', generationEnabled: true, promptSubmissionEnabled: true, canaryStartEnabled: true, maxJobsPerSession: 2 });
    await expect(controller.canaryReadiness()).resolves.toMatchObject({
      runner: { mode: 'two-job-canary', maxJobsPerSession: 2 },
      session: { plannedJobs: [{ product: 'cleanser', contentType: 'UGC Content' }, { product: 'cleanser', contentType: 'Educational' }] },
      stagedReady: true
    });
    await controller.startTwoJobCanary(staged.bundleId, staged.bundleSha256);
    expect(startCanary).toHaveBeenCalledOnce();
    expect(startCanary).toHaveBeenCalledWith(staged.bundleId, staged.bundleSha256);
  });

  it('one production action stages and starts exactly once even when double-clicked', async () => {
    const { controller, setCapabilities, stageSession, startCanary } = harness();
    setCapabilities({ runnerVersion: '2.0.0-production.20260910', mode: 'production', generationEnabled: true, promptSubmissionEnabled: true, canaryStartEnabled: true, maxJobsPerSession: null });
    const [first, second] = await Promise.all([controller.startProduction(config()), controller.startProduction(config())]);
    expect(first.sessionId).toBe(second.sessionId);
    expect(stageSession).toHaveBeenCalledOnce();
    expect(startCanary).toHaveBeenCalledOnce();
    expect(startCanary.mock.calls[0][0]).toBe(stageSession.mock.calls[0][0].sessionId);
  });

  it('does not depend on an optional version request when capabilities and health are authoritative', async () => {
    const { controller, setCapabilities, client } = harness();
    setCapabilities({ runnerVersion: '2.0.0-production.20260910', mode: 'production', generationEnabled: true, maxJobsPerSession: null });
    const version = vi.fn(async () => { throw new Error('HTTP 530'); });
    Object.assign(client, { version });
    await expect(controller.canaryReadiness()).resolves.toMatchObject({ runner: { mode: 'production', maxJobsPerSession: null }, healthReady: true });
    expect(version).not.toHaveBeenCalled();
  });

  it('Start performs bounded fresh preflight and recovers before any production mutation', async () => {
    const { db, client, setCapabilities, capabilitiesRequest, stageSession, startCanary } = harness();
    setCapabilities({ runnerVersion: '2.0.0-production.20260910', mode: 'production', generationEnabled: true, maxJobsPerSession: null });
    capabilitiesRequest.mockRejectedValueOnce(new Error('China runner proxy returned HTTP 530: transient edge failure'));
    const controller = new ChinaAutoH3ShadowController(db, () => defaultSettings(process.cwd()), () => client, 100, 1, async () => undefined);
    await expect(controller.startProduction(config())).resolves.toMatchObject({ connection: 'connected' });
    expect(capabilitiesRequest.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(stageSession).toHaveBeenCalledOnce();
    expect(startCanary).toHaveBeenCalledOnce();
  });

  it('does not stage or Start when bounded preflight never establishes authoritative readiness', async () => {
    const { db, client, capabilitiesRequest, stageSession, startCanary } = harness();
    capabilitiesRequest.mockRejectedValue(new Error('China runner proxy returned HTTP 530: unavailable'));
    const controller = new ChinaAutoH3ShadowController(db, () => defaultSettings(process.cwd()), () => client, 5, 1);
    await expect(controller.startProduction(config())).rejects.toThrow(/could not establish authoritative readiness/);
    expect(stageSession).not.toHaveBeenCalled();
    expect(startCanary).not.toHaveBeenCalled();
  });

  it('blocks an incompatible runner immediately without staging or Start mutation', async () => {
    const { db, client, setCapabilities, stageSession, startCanary } = harness();
    setCapabilities({ mode: 'two-job-canary', generationEnabled: true, maxJobsPerSession: 2 });
    const controller = new ChinaAutoH3ShadowController(db, () => defaultSettings(process.cwd()), () => client, 100, 1);
    await expect(controller.startProduction(config())).rejects.toThrow(/INCOMPATIBLE_PRODUCTION_RUNNER/);
    expect(stageSession).not.toHaveBeenCalled();
    expect(startCanary).not.toHaveBeenCalled();
  });
});

describe('Phase 3C secondary artifact synchronization', () => {
  it('downloads both missing completed artifacts sequentially and skips verified copies on catch-up', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proya-phase3c-sync-')); tempRoots.push(root);
    const bytes = new Map([['job-1', Buffer.from('phase3c-one')], ['job-2', Buffer.from('phase3c-two')]]);
    const jobs = [...bytes].map(([jobId, value], index) => ({ jobId, sessionId: 'session', phase: 'COMPLETED', product: 'cleanser', contentType: index ? 'Educational' : 'UGC Content', archiveSha256: createHash('sha256').update(value).digest('hex') })) as PersistedJob[];
    const order: string[] = [];
    const downloadArtifact = vi.fn(async (jobId: string, sha256: string, destinationRoot: string) => {
      order.push(jobId);
      const value = bytes.get(jobId)!; const path = join(destinationRoot, `${jobId}.mp4`);
      writeFileSync(path, value);
      return { path, size: value.length, sha256 };
    });
    const client = { jobs: async () => ({ jobs }), downloadArtifact, acknowledgeLaptopSync: vi.fn(async () => ({ job: {} })) } as unknown as ChinaAutoH3Client;
    const controller = new ChinaAutoH3ShadowController({} as HistoryDatabase, () => defaultSettings(process.cwd()), () => client);
    await expect(controller.syncCanaryArtifacts('session', root)).resolves.toMatchObject([{ jobId: 'job-1', downloaded: true }, { jobId: 'job-2', downloaded: true }]);
    expect(order).toEqual(['job-1', 'job-2']);
    await expect(controller.syncCanaryArtifacts('session', root)).resolves.toMatchObject([{ jobId: 'job-1', downloaded: false }, { jobId: 'job-2', downloaded: false }]);
    expect(downloadArtifact).toHaveBeenCalledTimes(2);
  });
});
