import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import workflow from '../../workflows/minimax-h3-api.json';
import { products } from '../domain/data';
import { createH3ReferencePlan } from '../domain/h3';
import type { H3VideoBrief } from '../domain/types';
import type { CanaryExecutor } from './canary-executor';
import { LocalComfyClient, LocalLmStudioClient } from './localhost-comfy';
import { ChinaAutoRunner } from './runner';
import { canonicalBundleHash } from './staging';
import { CHINA_RUNNER_VERSION, type ChinaSessionBundle } from './types';

const roots: string[] = [];
const runners: ChinaAutoRunner[] = [];
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

afterEach(() => {
  for (const runner of runners.splice(0)) {
    try { runner.close(); } catch { /* already closed */ }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function testBrief(): H3VideoBrief {
  return {
    product: 'cleanser',
    contentType: 'UGC Content',
    creativeVariety: 'Balanced',
    videoIdea: '',
    language: 'English',
    musicOnly: true,
    captions: false,
    subtitles: false,
    goal: 'Product reveal',
    customGoal: '',
    duration: 4,
    aspectRatio: '9:16',
    customAspectRatio: '',
    qualityPreset: 'Custom',
    megapixels: 0.98,
    multiple: 32,
    fps: 24,
    steps: 20,
    seedMode: 'fixed',
    seed: 42,
    refImageSize: 'max',
    workflowMode: 'REF2VA',
    cameraMotion: 'Cinematic',
    actionIntensity: 'Medium',
    pacing: 'Balanced',
    productFidelity: 'Exact',
    scheduler: 'simple',
    ending: 'Hero Shot',
    customEnding: '',
    sound: 'Music Only',
    promptDetail: 'Production',
    specialInstructions: '',
    references: createH3ReferencePlan(products[0])
  };
}

function testBundle(root: string): ChinaSessionBundle {
  const product = products[0];
  const sourcePath = product.imagePath;
  const bytes = readFileSync(join(process.cwd(), sourcePath));
  const assetId = `${product.id}-0`;
  const systemPrompt = 'two-job canary exact system prompt';
  const bundle: ChinaSessionBundle = {
    sessionId: randomUUID(),
    schemaVersion: 1,
    expectedRunnerVersion: CHINA_RUNNER_VERSION,
    selectedProducts: [product.id],
    selectedContentTypes: ['UGC Content', 'Educational'],
    ordering: {
      productOrder: [product.id],
      contentTypeOrder: ['UGC Content', 'Educational'],
      shuffleProducts: false,
      shuffleContentTypes: false
    },
    repeatPolicy: { mode: 'forever' },
    products: [product],
    assets: [{
      id: assetId,
      productId: product.id,
      sourcePath,
      filename: basename(sourcePath),
      mimeType: 'image/png',
      size: bytes.length,
      sha256: sha256(bytes),
      base64: bytes.toString('base64')
    }],
    productReferences: [{ productId: product.id, assetIds: [assetId] }],
    settings: { brief: testBrief() },
    initialSettingsVersion: 1,
    systemPrompt,
    systemPromptSha256: sha256(systemPrompt),
    workflow: structuredClone(workflow),
    workflowSha256: sha256(JSON.stringify(workflow)),
    workflowVersion: 'two-job-test',
    archiveRoot: join(root, 'archive'),
    bundleSha256: ''
  };
  bundle.bundleSha256 = canonicalBundleHash(bundle);
  return bundle;
}

function localClients() {
  const ready = async () => ({ ready: true, checkedAt: new Date().toISOString(), error: null });
  return {
    comfy: { readiness: vi.fn(ready) } as unknown as LocalComfyClient,
    lmStudio: { readiness: vi.fn(ready) } as unknown as LocalLmStudioClient
  };
}

function createRunner(executor: CanaryExecutor, root = mkdtempSync(join(tmpdir(), 'proya-two-job-')), interval = 60_000) {
  roots.push(root);
  const runner = new ChinaAutoRunner({ mode: 'two-job-canary', stateRoot: join(root, 'state'), archiveRoot: join(root, 'archive'), canaryExecutor: executor, schedulerIntervalMs: interval, ...localClients() });
  runners.push(runner);
  return { runner, root };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for two-job scheduler state.');
}

const verified = () => ({
  h3VramReleaseSucceeded: true,
  h3VramVerification: 'PASSED' as const,
  h3VramPostMeasurementFresh: true
});

describe('China-owned two-job canary scheduler', () => {
  it('runs exactly two deterministic jobs locally and makes job 3 impossible', async () => {
    const executor: CanaryExecutor = {
      executeStep: async (_session, job, hooks) => hooks.update('COMPLETED', {
        promptId: randomUUID(),
        archivePath: `D:/AI Videos/${job.jobId}.mp4`,
        archiveSize: 100,
        archiveSha256: 'a'.repeat(64),
        vramAudit: verified()
      })
    };
    const { runner, root } = createRunner(executor);
    const bundle = testBundle(root);
    await runner.stage(bundle);
    const started = await runner.startCanary(bundle.sessionId, bundle.bundleSha256);
    expect(started).toMatchObject({ maxJobsPerSession: 2, idempotent: false });
    await waitFor(() => runner.session(bundle.sessionId)?.status === 'TWO_JOB_CANARY_FINISHED');
    expect(runner.jobs(bundle.sessionId).map(job => [job.product, job.contentType])).toEqual([
      ['cleanser', 'UGC Content'],
      ['cleanser', 'Educational']
    ]);
    expect(runner.jobs(bundle.sessionId)).toHaveLength(2);
    await expect(runner.startCanary(bundle.sessionId, bundle.bundleSha256)).resolves.toMatchObject({ idempotent: true, maxJobsPerSession: 2 });
    expect(runner.jobs(bundle.sessionId)).toHaveLength(2);
  });

  it('advances after deterministic Job 1 validation failure and still attempts Job 2', async () => {
    const executor: CanaryExecutor = {
      executeStep: async (_session, job, hooks) => job.contentType === 'UGC Content'
        ? hooks.update('FAILED', {
            promptId: randomUUID(),
            error: 'PROMPT_VALIDATION_FAILED',
            executionState: { pipelineStage: 'PROMPT_VALIDATION_FAILED', failureStage: 'PROMPT_VALIDATION_FAILED' } as never
          })
        : hooks.update('COMPLETED', { promptId: randomUUID(), archivePath: 'D:/AI Videos/job2.mp4', archiveSha256: 'b'.repeat(64), vramAudit: verified() })
    };
    const { runner, root } = createRunner(executor);
    const bundle = testBundle(root);
    await runner.stage(bundle);
    await runner.startCanary(bundle.sessionId, bundle.bundleSha256);
    await waitFor(() => runner.session(bundle.sessionId)?.status === 'TWO_JOB_CANARY_FINISHED');
    expect(runner.jobs(bundle.sessionId).map(job => job.phase)).toEqual(['FAILED', 'COMPLETED']);
  });

  it('blocks Job 2 until a Job 1 H3 lifecycle has fresh verified VRAM cleanup', async () => {
    const executor: CanaryExecutor = {
      executeStep: async (_session, _job, hooks) => hooks.update('FAILED', {
        promptId: randomUUID(),
        error: 'VRAM_NOT_VERIFIED',
        vramAudit: { h3VramReleaseSucceeded: false, h3VramVerification: 'FAILED', h3VramPostMeasurementFresh: true }
      })
    };
    const { runner, root } = createRunner(executor);
    const bundle = testBundle(root);
    await runner.stage(bundle);
    await runner.startCanary(bundle.sessionId, bundle.bundleSha256);
    await waitFor(() => runner.jobs(bundle.sessionId)[0]?.phase === 'FAILED');
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(runner.jobs(bundle.sessionId)).toHaveLength(1);
    expect(runner.session(bundle.sessionId)).toMatchObject({ status: 'TWO_JOB_CANARY_RUNNING', currentJobId: runner.jobs(bundle.sessionId)[0].jobId });
  });

  it('Stop After Current is persisted and prevents Job 2', async () => {
    const runnerRef: { current?: ChinaAutoRunner } = {};
    const executor: CanaryExecutor = {
      executeStep: async (_session, _job, hooks) => {
        runnerRef.current!.requestStopAfterCurrent(_session.sessionId);
        return hooks.update('COMPLETED', { promptId: randomUUID(), archivePath: 'D:/AI Videos/job1.mp4', archiveSha256: 'c'.repeat(64), vramAudit: verified() });
      }
    };
    const created = createRunner(executor);
    const runner = created.runner;
    runnerRef.current = runner;
    const bundle = testBundle(created.root);
    await runner.stage(bundle);
    await runner.startCanary(bundle.sessionId, bundle.bundleSha256);
    await waitFor(() => runner.session(bundle.sessionId)?.status === 'STOPPED');
    expect(runner.jobs(bundle.sessionId)).toHaveLength(1);
  });

  it('recovers after Job 1 VRAM verification without duplicating either job', async () => {
    const runnerRef: { current?: ChinaAutoRunner } = {};
    const firstExecutor: CanaryExecutor = {
      executeStep: async (_session, _job, hooks) => {
        const completed = hooks.update('COMPLETED', { promptId: randomUUID(), archivePath: 'D:/AI Videos/job1.mp4', archiveSha256: 'd'.repeat(64), vramAudit: verified() });
        runnerRef.current!.close();
        return completed;
      }
    };
    const created = createRunner(firstExecutor);
    const firstRunner = created.runner;
    runnerRef.current = firstRunner;
    const bundle = testBundle(created.root);
    await firstRunner.stage(bundle);
    await firstRunner.startCanary(bundle.sessionId, bundle.bundleSha256);
    await new Promise(resolve => setTimeout(resolve, 30));
    runners.splice(runners.indexOf(firstRunner), 1);
    const recoveredExecutor: CanaryExecutor = {
      executeStep: async (_session, job, hooks) => job.phase === 'COMPLETED'
        ? job
        : hooks.update('COMPLETED', { promptId: randomUUID(), archivePath: 'D:/AI Videos/job2.mp4', archiveSha256: 'e'.repeat(64), vramAudit: verified() })
    };
    const recovered = new ChinaAutoRunner({ mode: 'two-job-canary', stateRoot: join(created.root, 'state'), archiveRoot: join(created.root, 'archive'), canaryExecutor: recoveredExecutor, schedulerIntervalMs: 10, ...localClients() });
    runners.push(recovered);
    await waitFor(() => recovered.session(bundle.sessionId)?.status === 'TWO_JOB_CANARY_FINISHED');
    expect(recovered.jobs(bundle.sessionId)).toHaveLength(2);
    expect(new Set(recovered.jobs(bundle.sessionId).map(job => job.schedulerKey)).size).toBe(2);
  });

  it('snapshots settings per job and uses the latest committed version for Job 2', async () => {
    const runnerRef: { current?: ChinaAutoRunner } = {};
    const executor: CanaryExecutor = {
      executeStep: async (session, job, hooks) => {
        if (job.contentType === 'UGC Content') {
          const next = structuredClone(session.bundle.settings);
          next.brief.videoIdea = 'Phase 3C settings version 2';
          runnerRef.current!.updateSettings(session.sessionId, 2, next);
        }
        return hooks.update('COMPLETED', { promptId: randomUUID(), archivePath: `D:/AI Videos/${job.jobId}.mp4`, archiveSha256: 'f'.repeat(64), vramAudit: verified() });
      }
    };
    const created = createRunner(executor);
    const runner = created.runner;
    runnerRef.current = runner;
    const bundle = testBundle(created.root);
    await runner.stage(bundle);
    await runner.startCanary(bundle.sessionId, bundle.bundleSha256);
    await waitFor(() => runner.session(bundle.sessionId)?.status === 'TWO_JOB_CANARY_FINISHED');
    expect(runner.jobs(bundle.sessionId).map(job => job.settingsVersion)).toEqual([1, 2]);
    expect(runner.jobs(bundle.sessionId).map(job => job.settingsSnapshot?.brief.videoIdea)).toEqual([bundle.settings.brief.videoIdea, 'Phase 3C settings version 2']);
  });

  it('uses the same staged verified Cleanser master for both jobs and exposes both revisions after reconnect', async () => {
    const executor: CanaryExecutor = {
      executeStep: async (_session, job, hooks) => hooks.update('COMPLETED', { promptId: randomUUID(), archivePath: `D:/AI Videos/${job.jobId}.mp4`, archiveSha256: '1'.repeat(64), vramAudit: verified() })
    };
    const { runner, root } = createRunner(executor);
    const bundle = testBundle(root);
    await runner.stage(bundle);
    await runner.startCanary(bundle.sessionId, bundle.bundleSha256);
    await waitFor(() => runner.session(bundle.sessionId)?.status === 'TWO_JOB_CANARY_FINISHED');
    const jobs = runner.jobs(bundle.sessionId);
    expect(jobs.map(job => job.referenceAssetIds)).toEqual([['cleanser-0'], ['cleanser-0']]);
    expect(runner.jobs(bundle.sessionId, 0)).toHaveLength(2);
    expect(runner.jobs(bundle.sessionId, jobs[0].revision)).toEqual([jobs[1]]);
    expect(JSON.stringify(jobs)).not.toContain('comfy.proyaofficial.com');
  });

  it('continues the Job 1 to Job 2 handoff while laptop/proxy visibility is disconnected', async () => {
    let controllerVisible = true;
    const executor: CanaryExecutor = {
      executeStep: async (_session, job, hooks) => {
        if (job.contentType === 'UGC Content') controllerVisible = false;
        if (job.contentType === 'Educational') expect(controllerVisible).toBe(false);
        return hooks.update('COMPLETED', { promptId: randomUUID(), archivePath: `D:/AI Videos/${job.jobId}.mp4`, archiveSha256: '2'.repeat(64), vramAudit: verified() });
      }
    };
    const { runner, root } = createRunner(executor);
    const bundle = testBundle(root);
    await runner.stage(bundle);
    await runner.startCanary(bundle.sessionId, bundle.bundleSha256);
    await waitFor(() => runner.session(bundle.sessionId)?.status === 'TWO_JOB_CANARY_FINISHED');
    expect(runner.jobs(bundle.sessionId)).toHaveLength(2);
  });

  it.each([
    ['A. Job 1 submission ambiguity', 1, 'SUBMISSION_INTENT_PERSISTED' as const],
    ['B. Job 1 running', 1, 'RUNNING' as const],
    ['C. after Job 1 archive before /free', 1, 'ARCHIVED' as const],
    ['E. during Job 2', 2, 'RUNNING' as const]
  ])('recovers exactly once after restart %s', async (_label, crashJobNumber, crashPhase) => {
    const runnerRef: { current?: ChinaAutoRunner } = {};
    let executionNumber = 0;
    const crashExecutor: CanaryExecutor = {
      executeStep: async (_session, job, hooks) => {
        executionNumber++;
        if (executionNumber === crashJobNumber) {
          const interrupted = hooks.update(crashPhase, {
            submissionHash: '3'.repeat(64),
            promptId: crashPhase === 'SUBMISSION_INTENT_PERSISTED' ? null : randomUUID(),
            archivePath: crashPhase === 'ARCHIVED' ? 'D:/AI Videos/job1.mp4' : null,
            archiveSha256: crashPhase === 'ARCHIVED' ? '4'.repeat(64) : null
          });
          runnerRef.current!.close();
          return interrupted;
        }
        return hooks.update('COMPLETED', { promptId: randomUUID(), archivePath: `D:/AI Videos/${job.jobId}.mp4`, archiveSha256: '5'.repeat(64), vramAudit: verified() });
      }
    };
    const created = createRunner(crashExecutor);
    runnerRef.current = created.runner;
    const bundle = testBundle(created.root);
    await created.runner.stage(bundle);
    await created.runner.startCanary(bundle.sessionId, bundle.bundleSha256);
    await new Promise(resolve => setTimeout(resolve, 30));
    runners.splice(runners.indexOf(created.runner), 1);
    const recovered = new ChinaAutoRunner({ mode: 'two-job-canary', stateRoot: join(created.root, 'state'), archiveRoot: join(created.root, 'archive'), schedulerIntervalMs: 10, ...localClients(), canaryExecutor: {
      executeStep: async (_session, job, hooks) => hooks.update('COMPLETED', { promptId: job.promptId ?? randomUUID(), archivePath: job.archivePath ?? `D:/AI Videos/${job.jobId}.mp4`, archiveSha256: job.archiveSha256 ?? '6'.repeat(64), vramAudit: verified() })
    } });
    runners.push(recovered);
    await waitFor(() => recovered.session(bundle.sessionId)?.status === 'TWO_JOB_CANARY_FINISHED');
    const jobs = recovered.jobs(bundle.sessionId);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map(job => job.schedulerKey)).size).toBe(2);
  });

  it('contains no Cloudflare generation dependency and pins both internal services to loopback', () => {
    const source = ['runner.ts', 'canary-executor.ts', 'localhost-comfy.ts', 'types.ts']
      .map(name => readFileSync(join(process.cwd(), 'src', 'china-runner', name), 'utf8')).join('\n');
    expect(source).not.toContain('comfy.proyaofficial.com');
    expect(source).toContain('http://127.0.0.1:8188');
    expect(source).toContain('http://127.0.0.1:1234');
  });
});
