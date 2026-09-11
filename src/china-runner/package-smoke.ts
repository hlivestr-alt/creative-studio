import { LocalComfyClient, LocalLmStudioClient } from './localhost-comfy';
import { REQUIRED_QWEN_MODEL } from './types';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChinaAutoRunner } from './runner';

async function main(): Promise<void> {
  const lmRequests: Array<{ url: string; method: string }> = [];
  const lmStudio = new LocalLmStudioClient(async (input, init) => {
    lmRequests.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify({ models: [{ key: REQUIRED_QWEN_MODEL }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const readiness = await lmStudio.readiness();
  const details = readiness.details as Record<string, unknown>;
  if (!readiness.ready || details.available !== true || details.matchedField !== 'key' || details.matchedValue !== REQUIRED_QWEN_MODEL) throw new Error('Packaged LM Studio key-field readiness smoke failed.');
  if (lmRequests.length !== 1 || lmRequests[0].method !== 'GET' || lmRequests[0].url !== 'http://127.0.0.1:1234/api/v1/models') throw new Error('Readiness made an unexpected LM Studio request.');

  let comfyMutationCalls = 0;
  const comfy = new LocalComfyClient('shadow', async () => { comfyMutationCalls++; return new Response('{}'); });
  await comfy.prompt({}).then(() => { throw new Error('Shadow prompt unexpectedly succeeded.'); }, () => undefined);
  await comfy.free().then(() => { throw new Error('Shadow free unexpectedly succeeded.'); }, () => undefined);
  if (comfyMutationCalls !== 0) throw new Error('Shadow safety allowed a ComfyUI mutation request.');

  const root = mkdtempSync(join(tmpdir(), 'proya-r8-smoke-'));
  const probe = { ready: true, checkedAt: new Date().toISOString(), error: null };
  const canary = new ChinaAutoRunner({ mode: 'canary', stateRoot: join(root, 'state'), archiveRoot: join(root, 'archive'), schedulerIntervalMs: 60_000,
    comfy: { readiness: async () => probe } as unknown as LocalComfyClient,
    lmStudio: { readiness: async () => probe } as unknown as LocalLmStudioClient,
    canaryExecutor: { executeStep: async (_session, job) => job }
  });
  const capabilities = canary.capabilities(); canary.close(); rmSync(root, { recursive: true, force: true });
  if (capabilities.mode !== 'canary' || capabilities.maxJobsPerSession !== 1 || !capabilities.canaryStartEnabled) throw new Error('Packaged one-job canary capability smoke failed.');

  const twoJobRoot = mkdtempSync(join(tmpdir(), 'proya-r9-smoke-'));
  const twoJob = new ChinaAutoRunner({ mode: 'two-job-canary', stateRoot: join(twoJobRoot, 'state'), archiveRoot: join(twoJobRoot, 'archive'), schedulerIntervalMs: 60_000,
    comfy: { readiness: async () => probe } as unknown as LocalComfyClient,
    lmStudio: { readiness: async () => probe } as unknown as LocalLmStudioClient,
    canaryExecutor: { executeStep: async (_session, job) => job }
  });
  const twoJobCapabilities = twoJob.capabilities(); twoJob.close(); rmSync(twoJobRoot, { recursive: true, force: true });
  if (twoJobCapabilities.mode !== 'two-job-canary' || twoJobCapabilities.maxJobsPerSession !== 2 || !twoJobCapabilities.canaryStartEnabled) throw new Error('Packaged two-job canary capability smoke failed.');

  const productionRoot = mkdtempSync(join(tmpdir(), 'proya-r10-smoke-'));
  const production = new ChinaAutoRunner({ mode: 'production', stateRoot: join(productionRoot, 'state'), archiveRoot: join(productionRoot, 'archive'), schedulerIntervalMs: 60_000,
    comfy: { readiness: async () => probe } as unknown as LocalComfyClient,
    lmStudio: { readiness: async () => probe } as unknown as LocalLmStudioClient,
    canaryExecutor: { executeStep: async (_session, job) => job }
  });
  const productionCapabilities = production.capabilities(); production.close(); rmSync(productionRoot, { recursive: true, force: true });
  if (productionCapabilities.mode !== 'production' || productionCapabilities.maxJobsPerSession !== null || !productionCapabilities.generationEnabled) throw new Error('Packaged unlimited production capability smoke failed.');

  console.log(JSON.stringify({
    passed: true,
    lmStudioReady: readiness.ready,
    qwenModelAvailable: details.available,
    requiredModel: details.requiredModel,
    matchedField: details.matchedField,
    matchedValue: details.matchedValue,
    lmStudioRequests: lmRequests,
    promptSubmissionEnabled: false,
    freeAutonomousActionEnabled: false,
    canaryModeAvailable: true,
    oneJobMaxJobsPerSession: capabilities.maxJobsPerSession,
    twoJobCanaryModeAvailable: true,
    twoJobMaxJobsPerSession: twoJobCapabilities.maxJobsPerSession,
    productionModeAvailable: true,
    productionMaxJobsPerSession: productionCapabilities.maxJobsPerSession
  }));
}

void main().catch(reason => { console.error(reason); process.exitCode = 1; });
