import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChinaAutoH3Client } from './china-auto-h3-client';
import type { ChinaSessionBundle, PersistedSession } from '../../src/china-runner/types';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('Phase 3A China runner proxy client', () => {
  it('uses only the allowlisted external proxy paths', async () => {
    const urls: string[] = [];
    const fake = vi.fn(async (input: string | URL | Request) => { urls.push(String(input)); return json({ jobs: [] }); });
    const client = new ChinaAutoH3Client('https://comfy.example.test/base', fake as typeof fetch);
    await client.capabilities(); await client.health(); await client.version(); await client.currentSession(); await client.session('abc'); await client.jobs('abc', 4);
    expect(urls.map(url => new URL(url).pathname)).toEqual(['/proya/runner/capabilities', '/proya/runner/health', '/proya/runner/version', '/proya/runner/session/current', '/proya/runner/session/abc', '/proya/runner/jobs']);
    expect(new URL(urls[3]).searchParams.has('readiness')).toBe(true);
  });

  it('adopts an already-persisted session after the stage response is lost', async () => {
    const bundle = { sessionId: 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5', bundleSha256: 'a'.repeat(64) } as ChinaSessionBundle;
    const persisted = { sessionId: bundle.sessionId, bundleHash: bundle.bundleSha256, revision: 8, sessionDirectory: String.raw`D:\AI Videos\.proya-auto\sessions\e8aacb62-cc96-4e3e-bf8d-16040ff47da5` } as PersistedSession;
    const fake = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') throw new TypeError('fetch failed after upload');
      return json({ session: persisted });
    });
    const result = await new ChinaAutoH3Client('https://comfy.example.test', fake as typeof fetch).stageSession(bundle);
    expect(result).toMatchObject({ sessionId: bundle.sessionId, bundleHash: bundle.bundleSha256, revision: 8 });
    expect(fake).toHaveBeenCalledTimes(2);
  });

  it('does not retry or translate a 409 conflict into a second stage', async () => {
    const fake = vi.fn(async () => json({ error: 'different bundle hash' }, 409));
    const bundle = { sessionId: 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5', bundleSha256: 'a'.repeat(64) } as ChinaSessionBundle;
    await expect(new ChinaAutoH3Client('https://comfy.example.test', fake as typeof fetch).stageSession(bundle)).rejects.toThrow(/HTTP 409/);
    expect(fake).toHaveBeenCalledOnce();
  });

  it('promotes a downloaded artifact only after authoritative SHA-256 verification', async () => {
    const bytes = Buffer.from('verified canary mp4 fixture'); const digest = createHash('sha256').update(bytes).digest('hex'); const root = mkdtempSync(join(tmpdir(), 'proya-canary-download-'));
    try {
      const fake = vi.fn(async () => new Response(bytes, { status: 200, headers: { 'X-PROYA-SHA256': digest, 'Content-Type': 'video/mp4' } }));
      const result = await new ChinaAutoH3Client('https://comfy.example.test', fake as typeof fetch).downloadArtifact('h3-auto-canary', digest, root);
      expect(readFileSync(result.path)).toEqual(bytes); expect(result).toMatchObject({ size: bytes.length, sha256: digest });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
