import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAutoH3Client } from './local-auto-h3-client';
import type { LocalSessionBundle } from '../../src/local-runner/types';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('Local runner client', () => {
  it('uses only the allowlisted external proxy paths', async () => {
    const urls: string[] = [];
    const fake = vi.fn(async (input: string | URL | Request) => { urls.push(String(input)); return json({ jobs: [] }); });
    const client = new LocalAutoH3Client('https://comfy.example.test/base', fake as typeof fetch);
    await client.capabilities(); await client.health(); await client.version(); await client.currentSession(); await client.session('abc'); await client.jobs('abc', 4);
    expect(urls.map(url => new URL(url).pathname)).toEqual(['/proya/auto/capabilities', '/proya/auto/health', '/proya/auto/version', '/proya/auto/session/current', '/proya/auto/session/abc', '/proya/auto/jobs']);
    expect(new URL(urls[3]).searchParams.has('readiness')).toBe(true);
    expect(new URL(urls[4]).searchParams.has('readiness')).toBe(true);
  });

  it('uses native POST /proya/auto/start exactly once for production Start', async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const fake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: String(init?.method), body: String(init?.body) });
      return json({ started: true, sessionId: 'session-id', bundleHash: 'bundle-hash', status: 'PRODUCTION_STARTING' }, 202);
    });
    await new LocalAutoH3Client('https://comfy.example.test', fake as typeof fetch).startCanary('session-id', 'bundle-hash');
    expect(requests).toEqual([{ url: 'https://comfy.example.test/proya/auto/start', method: 'POST', body: JSON.stringify({ sessionId: 'session-id', bundleHash: 'bundle-hash' }) }]);
  });

  it('leaves ambiguous Stage reconciliation to the controller without retrying or minting identity', async () => {
    const bundle = { sessionId: 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5', bundleSha256: 'a'.repeat(64) } as LocalSessionBundle;
    const fake = vi.fn(async () => { throw new TypeError('fetch failed after upload'); });
    await expect(new LocalAutoH3Client('https://comfy.example.test', fake as typeof fetch).stageSession(bundle)).rejects.toThrow(/Runner unavailable: POST \/proya\/auto\/stage -> NETWORK_ERROR/);
    expect(fake).toHaveBeenCalledOnce();
  });

  it('does not retry or translate a 409 conflict into a second stage', async () => {
    const fake = vi.fn(async () => json({ error: 'different bundle hash' }, 409));
    const bundle = { sessionId: 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5', bundleSha256: 'a'.repeat(64) } as LocalSessionBundle;
    await expect(new LocalAutoH3Client('https://comfy.example.test', fake as typeof fetch).stageSession(bundle)).rejects.toThrow('POST /proya/auto/stage -> HTTP 409; body: {"error":"different bundle hash"}');
    expect(fake).toHaveBeenCalledOnce();
  });

  it('reports method, exact path, status, and non-JSON response body', async () => {
    const fake = vi.fn(async () => new Response('Not Found', { status: 404, statusText: 'Not Found' }));
    await expect(new LocalAutoH3Client('https://comfy.example.test', fake as typeof fetch).health())
      .rejects.toThrow(/^GET \/proya\/auto\/health\?readiness=.* -> HTTP 404 Not Found; body: Not Found$/);
  });

  it('treats only a session lookup 404 with session:null as normal absence', async () => {
    const missing = vi.fn(async () => json({ session: null, persistence: null }, 404));
    await expect(new LocalAutoH3Client('https://comfy.example.test', missing as typeof fetch).session('e8aacb62-cc96-4e3e-bf8d-16040ff47da5'))
      .resolves.toEqual({ session: null, persistence: null });
    const unknownRoute = vi.fn(async () => json({ error: 'Runner proxy route or method is not allowed.' }, 404));
    await expect(new LocalAutoH3Client('https://comfy.example.test', unknownRoute as typeof fetch).session('e8aacb62-cc96-4e3e-bf8d-16040ff47da5'))
      .rejects.toThrow(/HTTP 404/);
  });

  it('reports method, exact path, and explicit unavailable status/body for transport failures', async () => {
    const fake = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(new LocalAutoH3Client('https://comfy.example.test', fake as typeof fetch).startCanary('session-id', 'bundle-hash'))
      .rejects.toThrow('Runner unavailable: POST /proya/auto/start -> NETWORK_ERROR; body: n/a; fetch failed');
  });

  it('promotes a downloaded artifact only after authoritative SHA-256 verification', async () => {
    const bytes = Buffer.from('verified canary mp4 fixture'); const digest = createHash('sha256').update(bytes).digest('hex'); const root = mkdtempSync(join(tmpdir(), 'proya-canary-download-'));
    try {
      const fake = vi.fn(async () => new Response(bytes, { status: 200, headers: { 'X-PROYA-SHA256': digest, 'Content-Type': 'video/mp4' } }));
      const result = await new LocalAutoH3Client('https://comfy.example.test', fake as typeof fetch).downloadArtifact('h3-auto-canary', digest, root);
      expect(readFileSync(result.path)).toEqual(bytes); expect(result).toMatchObject({ size: bytes.length, sha256: digest });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
