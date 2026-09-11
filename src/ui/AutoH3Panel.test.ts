import { describe, expect, it, vi } from 'vitest';
import type { ChinaCanaryObserver, ChinaCanaryReadiness } from '../domain/auto-h3';
import { autoH3ReconnectSessionId, chinaProductionReadinessAfterFailure, chinaProductionReadinessAfterStartFailure, chinaProductionReadinessAfterSuccess, chinaProductionReadinessRetryMs, chinaProductionRunnerReady } from './AutoH3Panel';

const readiness = (status: string): ChinaCanaryReadiness => ({
  runner: { runnerVersion: 'test', mode: 'two-job-canary', generationEnabled: true, promptSubmissionEnabled: true, canaryStartEnabled: true, maxJobsPerSession: 2 },
  proxyStartEndpointAvailable: true,
  healthReady: true,
  session: { sessionId: 'session-1', bundleHash: 'a'.repeat(64), status, plannedJobs: [{ product: 'cleanser', contentType: 'UGC Content' }, { product: 'cleanser', contentType: 'Educational' }] },
  stagedReady: status === 'STAGED'
});

describe('Phase 3C reconnect discovery', () => {
  it('loads an authoritative running or finished session after the controller restarts', () => {
    expect(autoH3ReconnectSessionId(readiness('TWO_JOB_CANARY_RUNNING'), null)).toBe('session-1');
    expect(autoH3ReconnectSessionId(readiness('TWO_JOB_CANARY_FINISHED'), null)).toBe('session-1');
  });

  it('does not observe a merely staged session or duplicate the active observer', () => {
    expect(autoH3ReconnectSessionId(readiness('STAGED'), null)).toBeNull();
    expect(autoH3ReconnectSessionId(readiness('TWO_JOB_CANARY_RUNNING'), { sessionId: 'session-1' } as ChinaCanaryObserver)).toBeNull();
  });
});

describe('production runner readiness', () => {
  it('keeps a three-second initial request in CHECKING and then becomes READY', async () => {
    vi.useFakeTimers();
    expect(chinaProductionRunnerReady(null)).toBe(false);
    let status: ReturnType<typeof chinaProductionReadinessAfterSuccess> = 'CHECKING';
    const value = readiness('STAGED');
    value.runner = { ...value.runner, mode: 'production', generationEnabled: true, maxJobsPerSession: null };
    const request = new Promise<ChinaCanaryReadiness>(resolve => setTimeout(() => resolve(value), 3_000));
    const update = request.then(result => { status = chinaProductionReadinessAfterSuccess(result); });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(status).toBe('CHECKING');
    expect(chinaProductionReadinessRetryMs(status)).toBe(5_000);
    await vi.advanceTimersByTimeAsync(1);
    await update;
    expect(status).toBe('READY');
    vi.useRealTimers();
  });

  it('recovers automatically when the first request fails and the next succeeds', () => {
    expect(chinaProductionReadinessAfterFailure()).toBe('TEMPORARILY_UNREACHABLE');
    expect(chinaProductionReadinessRetryMs('TEMPORARILY_UNREACHABLE')).toBe(2_000);
    expect(chinaProductionReadinessRetryMs('TEMPORARILY_UNREACHABLE', 2)).toBe(5_000);
    const value = readiness('STAGED');
    value.runner = { ...value.runner, mode: 'production', generationEnabled: true, maxJobsPerSession: null };
    expect(chinaProductionReadinessAfterSuccess(value)).toBe('READY');
  });

  it('recovers from an intermittent failure after previously reaching READY', () => {
    const value = readiness('STAGED');
    value.runner = { ...value.runner, mode: 'production', generationEnabled: true, maxJobsPerSession: null };
    expect([chinaProductionReadinessAfterSuccess(value), chinaProductionReadinessAfterFailure(), chinaProductionReadinessAfterSuccess(value)]).toEqual(['READY', 'TEMPORARILY_UNREACHABLE', 'READY']);
  });

  it('accepts authoritative live r10 production health without canary capability requirements', () => {
    const value = readiness('TWO_JOB_CANARY_FINISHED');
    value.runner = { runnerVersion: '2.0.0-production.20260910', mode: 'production', generationEnabled: true, promptSubmissionEnabled: true, canaryStartEnabled: false, maxJobsPerSession: null };
    value.healthReady = true;
    expect(chinaProductionRunnerReady(value)).toBe(true);
  });

  it('requires production mode, continuous scheduling, generation, and live health', () => {
    const value = readiness('STAGED');
    value.runner = { ...value.runner, mode: 'production', generationEnabled: true, maxJobsPerSession: null };
    for (const patch of [{ healthReady: false }, { runner: { ...value.runner, mode: 'two-job-canary' as const } }, { runner: { ...value.runner, generationEnabled: false } }, { runner: { ...value.runner, maxJobsPerSession: 2 } }]) {
      expect(chinaProductionRunnerReady({ ...value, ...patch })).toBe(false);
    }
  });

  it('distinguishes an incompatible Start preflight from a temporary connection failure', () => {
    expect(chinaProductionReadinessAfterStartFailure(new Error('INCOMPATIBLE_PRODUCTION_RUNNER: wrong mode'))).toBe('INCOMPATIBLE');
    expect(chinaProductionReadinessAfterStartFailure(new Error('HTTP 530'))).toBe('TEMPORARILY_UNREACHABLE');
  });
});
