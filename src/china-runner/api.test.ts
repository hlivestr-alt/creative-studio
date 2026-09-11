import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRunnerApi } from './api';
import { LocalComfyClient, LocalLmStudioClient } from './localhost-comfy';
import { ChinaAutoRunner } from './runner';
import { REQUIRED_QWEN_MODEL } from './types';
import { SessionBundleConflictError } from './staging';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const operation of cleanup.splice(0).reverse()) await operation(); });

function localRunner(): ChinaAutoRunner {
  const root = mkdtempSync(join(tmpdir(), 'proya-runner-api-'));
  const probe = { ready: true, checkedAt: new Date().toISOString(), error: null };
  const runner = new ChinaAutoRunner({
    stateRoot: join(root, 'state'), archiveRoot: join(root, 'archive'),
    comfy: { readiness: vi.fn(async () => probe) } as unknown as LocalComfyClient,
    lmStudio: { readiness: vi.fn(async () => probe) } as unknown as LocalLmStudioClient
  });
  cleanup.push(() => { runner.close(); rmSync(root, { recursive: true, force: true }); });
  return runner;
}

async function listeningApi() {
  const runner = localRunner();
  const server = createRunnerApi(runner);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test API did not bind TCP.');
  return `http://127.0.0.1:${address.port}`;
}

describe('China runner localhost API and clients', () => {
  it('exposes capabilities, version, current session, and jobs as read-only JSON', async () => {
    const base = await listeningApi();
    const capabilities = await fetch(`${base}/proya/auto/capabilities`).then(response => response.json()) as Record<string, unknown>;
    expect(capabilities).toMatchObject({ mode: 'shadow', listenAddress: '127.0.0.1:8787', generationEnabled: false });
    expect(await fetch(`${base}/proya/auto/version`).then(response => response.status)).toBe(200);
    expect(await fetch(`${base}/proya/auto/session/current`).then(response => response.status)).toBe(200);
    expect(await fetch(`${base}/proya/auto/jobs`).then(response => response.status)).toBe(200);
  });

  it('refuses generation and control mutations in Phase 1', async () => {
    const base = await listeningApi();
    const response = await fetch(`${base}/proya/auto/start`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(405); expect(await response.text()).toContain('disabled');
  });

  it('exposes POST /stage but rejects an invalid bundle without side effects', async () => {
    const base = await listeningApi();
    const response = await fetch(`${base}/proya/auto/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(400); expect(await response.text()).toContain('schema version');
  });

  it('returns 409 for the same session ID with a different bundle hash', async () => {
    const runner = localRunner();
    runner.stage = vi.fn(async () => { throw new SessionBundleConflictError('Session ID already exists with a different bundle hash.'); });
    const server = createRunnerApi(runner); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No API address.');
    const response = await fetch(`http://127.0.0.1:${address.port}/proya/auto/stage`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(409);
  });

  it('routes every supported Comfy operation to localhost only', async () => {
    const urls: string[] = [];
    const fakeFetch = vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input)); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = new LocalComfyClient('shadow', fakeFetch as typeof fetch);
    await client.objectInfo(); await client.queue(); await client.history('abc'); await client.history(); await client.systemStats();
    await client.view(new URLSearchParams({ filename: 'result.mp4' })); await client.uploadImage(new FormData());
    expect(urls).toHaveLength(7); expect(urls.every(url => url.startsWith('http://127.0.0.1:8188/'))).toBe(true);
  });

  function modelClient(payload: unknown) {
    const fakeFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method ?? 'GET').toBe('GET');
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    return { client: new LocalLmStudioClient(fakeFetch as typeof fetch), fakeFetch };
  }

  it('A: accepts the exact required model from LM Studio key and exposes health diagnostics', async () => {
    const { client, fakeFetch } = modelClient({ models: [{ key: REQUIRED_QWEN_MODEL, context_length: 999999 }] });
    const root = mkdtempSync(join(tmpdir(), 'proya-runner-health-')); const probe = { ready: true, checkedAt: new Date().toISOString(), error: null };
    const runner = new ChinaAutoRunner({ stateRoot: join(root, 'state'), archiveRoot: join(root, 'archive'), comfy: { readiness: vi.fn(async () => probe) } as unknown as LocalComfyClient, lmStudio: client });
    cleanup.push(() => { runner.close(); rmSync(root, { recursive: true, force: true }); });
    expect(await runner.health()).toMatchObject({ ready: true, lmStudioLocal: 'ready', qwenModelAvailable: true, requiredModel: REQUIRED_QWEN_MODEL, matchedField: 'key', matchedValue: REQUIRED_QWEN_MODEL });
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  it('B: preserves exact id-field compatibility', async () => {
    const { client } = modelClient({ data: [{ id: REQUIRED_QWEN_MODEL }] });
    expect(await client.readiness()).toMatchObject({ ready: true, details: { available: true, matchedField: 'id', matchedValue: REQUIRED_QWEN_MODEL } });
  });

  it('C: rejects a different key model', async () => {
    const { client } = modelClient({ models: [{ key: 'qwen/qwen3.8-14b' }] });
    expect(await client.readiness()).toMatchObject({ ready: false, details: { available: false, matchedField: null, matchedValue: null } });
  });

  it('D: rejects a key containing the required identity as a substring', async () => {
    const { client } = modelClient({ models: [{ key: `foo-${REQUIRED_QWEN_MODEL}-copy` }] });
    expect(await client.readiness()).toMatchObject({ ready: false, details: { available: false } });
  });

  it('E: remains not ready when LM Studio is reachable but the required model is absent', async () => {
    const { client, fakeFetch } = modelClient({ models: [{ key: 'another/model' }] });
    const result = await client.readiness();
    expect(result).toMatchObject({ ready: false, details: { requiredModel: REQUIRED_QWEN_MODEL, available: false } });
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  it('F: remains not ready when LM Studio is unavailable', async () => {
    const fakeFetch = vi.fn(async () => { throw new Error('connection refused'); });
    const result = await new LocalLmStudioClient(fakeFetch as typeof fetch).readiness();
    expect(result).toMatchObject({ ready: false, error: 'connection refused', details: { requiredModel: REQUIRED_QWEN_MODEL, available: false } });
    expect(fakeFetch).toHaveBeenCalledOnce();
  });
});
