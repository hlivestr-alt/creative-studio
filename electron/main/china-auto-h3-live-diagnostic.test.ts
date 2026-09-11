import { describe, expect, it } from 'vitest';
import { ChinaAutoH3Client } from './china-auto-h3-client';
import { ChinaAutoH3ShadowController } from './china-auto-h3-controller';
import { defaultSettings } from '../../src/domain/settings';
import type { HistoryDatabase } from './database';

const live = process.env.PROYA_LIVE_DIAGNOSTIC === '1' ? it : it.skip;

describe('read-only live production runner diagnostic', () => {
  live('reads the same capabilities, health, and version objects used by the laptop UI', async () => {
    const traces: Array<Record<string, unknown>> = [];
    const tracedFetch: typeof fetch = async (input, init) => {
      const startedAt = performance.now();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      try {
        const response = await fetch(input, init);
        traces.push({
          method: init?.method ?? 'GET',
          url,
          status: response.status,
          durationMs: Math.round(performance.now() - startedAt),
          requestCache: init?.cache ?? null,
          requestHeaders: Object.fromEntries(new Headers(init?.headers).entries()),
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBody: await response.clone().text()
        });
        return response;
      } catch (reason) {
        traces.push({ method: init?.method ?? 'GET', url, durationMs: Math.round(performance.now() - startedAt), exception: reason instanceof Error ? { name: reason.name, message: reason.message, cause: String(reason.cause ?? '') } : String(reason) });
        throw reason;
      }
    };
    const client = new ChinaAutoH3Client('https://comfy.proyaofficial.com', tracedFetch, 180_000);
    const [capabilities, health, version] = await Promise.all([client.capabilities(), client.health(), client.version()]);
    console.log('LIVE_HTTP_TRACE=' + JSON.stringify(traces));
    console.log('LIVE_CAPABILITIES=' + JSON.stringify(capabilities));
    console.log('LIVE_HEALTH=' + JSON.stringify(health));
    console.log('LIVE_VERSION=' + JSON.stringify(version));
    expect(capabilities).toMatchObject({ runnerVersion: '2.0.0-production.20260910', mode: 'production', generationEnabled: true, maxJobsPerSession: null });
    expect(health).toMatchObject({ ready: true, mode: 'production' });
    expect(version).toEqual({ version: '2.0.0-production.20260910', mode: 'production' });
  });

  live('evaluates controller readiness with the laptop stale r9.2 mirror', async () => {
    const staleMirror = { sessionId: 'ffee6c56-570f-4718-bbba-20d502ee6135', lastKnownRevision: 878, bundleHash: '5b0ab586bbdcf3b7ada63e4e7c746c298c02f0446ecdb092a9ca3b3cc339029f', runnerVersion: '1.3.1-two-job-canary.20260910', connectionState: 'connected' as const, lastSuccessfulSync: '2026-09-10T04:11:50.591Z', settingsVersionIdentity: '04e96c64943fe42300fd6ff79579ce94828343665e227ce32ed5d8d1356600e6', stagingState: 'STAGED_READY' as const, createdTimestamp: '2026-09-10T03:37:35.057Z' };
    const database = { getLatestChinaAutoDraft: () => staleMirror } as unknown as HistoryDatabase;
    const settings = defaultSettings(process.cwd()); settings.remoteComfyUrl = 'https://comfy.proyaofficial.com';
    const controller = new ChinaAutoH3ShadowController(database, () => settings);
    const readiness = await controller.canaryReadiness();
    console.log('LIVE_CONTROLLER_READINESS=' + JSON.stringify(readiness));
    expect(readiness).toMatchObject({ runner: { runnerVersion: '2.0.0-production.20260910', mode: 'production', generationEnabled: true, maxJobsPerSession: null }, healthReady: true });
  });
});
