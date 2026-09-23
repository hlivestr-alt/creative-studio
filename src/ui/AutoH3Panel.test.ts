import { describe, expect, it, vi } from 'vitest';
import type { LocalRunnerObserver, LocalRunnerReadiness } from '../domain/auto-h3';
import { autoH3ReconnectSessionId, localGenerationReadinessAfterFailure, localGenerationReadinessAfterStartFailure, localGenerationReadinessAfterSuccess, localGenerationReadinessRetryMs, localGenerationRunLabel, localGenerationRunnerReady, localGenerationStartError } from './AutoH3Panel';

const readiness = (status: string): LocalRunnerReadiness => ({
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
    expect(autoH3ReconnectSessionId(readiness('TWO_JOB_CANARY_RUNNING'), { sessionId: 'session-1' } as LocalRunnerObserver)).toBeNull();
  });
});

describe('production runner readiness', () => {
  it('shows Running only for an authoritative PRODUCTION_RUNNING session', () => {
    expect(localGenerationRunLabel('PRODUCTION_RUNNING')).toBe('Running');
    expect(localGenerationRunLabel('PRODUCTION_STARTING')).toBe('Starting');
    expect(localGenerationRunLabel('STAGED')).toBe('Ready to start');
    expect(localGenerationRunLabel('UNKNOWN')).toBe('Unknown');
    expect(localGenerationRunLabel('STOPPING')).toBe('Stopping');
    expect(localGenerationRunLabel('FAILED')).toBe('Stopped');
  });
  it('keeps a three-second initial request in CHECKING and then becomes READY', async () => {
    vi.useFakeTimers();
    expect(localGenerationRunnerReady(null)).toBe(false);
    let status: ReturnType<typeof localGenerationReadinessAfterSuccess> = 'CHECKING';
    const value = readiness('STAGED');
    value.runner = { ...value.runner, mode: 'production', generationEnabled: true, maxJobsPerSession: null };
    const request = new Promise<LocalRunnerReadiness>(resolve => setTimeout(() => resolve(value), 3_000));
    const update = request.then(result => { status = localGenerationReadinessAfterSuccess(result); });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(status).toBe('CHECKING');
    expect(localGenerationReadinessRetryMs(status)).toBe(2_000);
    await vi.advanceTimersByTimeAsync(1);
    await update;
    expect(status).toBe('READY');
    vi.useRealTimers();
  });

  it('recovers automatically when the first request fails and the next succeeds', () => {
    expect(localGenerationReadinessAfterFailure()).toBe('UNAVAILABLE');
    expect(localGenerationReadinessRetryMs('UNAVAILABLE')).toBe(2_000);
    expect(localGenerationReadinessRetryMs('UNAVAILABLE', 2)).toBe(2_000);
    const value = readiness('STAGED');
    value.runner = { ...value.runner, mode: 'production', generationEnabled: true, maxJobsPerSession: null };
    expect(localGenerationReadinessAfterSuccess(value)).toBe('READY');
  });

  it('recovers from an intermittent failure after previously reaching READY', () => {
    const value = readiness('STAGED');
    value.runner = { ...value.runner, mode: 'production', generationEnabled: true, maxJobsPerSession: null };
    expect([localGenerationReadinessAfterSuccess(value), localGenerationReadinessAfterFailure(), localGenerationReadinessAfterSuccess(value)]).toEqual(['READY', 'UNAVAILABLE', 'READY']);
  });

  it('accepts authoritative live r10 production health without canary capability requirements', () => {
    const value = readiness('TWO_JOB_CANARY_FINISHED');
    value.runner = { runnerVersion: '2.1.0-production.20260911', mode: 'production', generationEnabled: true, promptSubmissionEnabled: true, canaryStartEnabled: false, maxJobsPerSession: null };
    value.healthReady = true;
    expect(localGenerationRunnerReady(value)).toBe(true);
  });

  it('requires production mode, continuous scheduling, generation, and live health', () => {
    const value = readiness('STAGED');
    value.runner = { ...value.runner, mode: 'production', generationEnabled: true, maxJobsPerSession: null };
    for (const patch of [{ healthReady: false }, { runner: { ...value.runner, mode: 'two-job-canary' as const } }, { runner: { ...value.runner, generationEnabled: false } }, { runner: { ...value.runner, maxJobsPerSession: 2 } }]) {
      expect(localGenerationRunnerReady({ ...value, ...patch })).toBe(false);
    }
  });

  it('distinguishes an incompatible Start preflight from a temporary connection failure', () => {
    expect(localGenerationReadinessAfterStartFailure(new Error('INCOMPATIBLE_PRODUCTION_RUNNER: wrong mode'))).toBe('INCOMPATIBLE');
    expect(localGenerationReadinessAfterStartFailure(new Error('HTTP 530'))).toBe('UNAVAILABLE');
  });

  it('turns an empty or wrapped IPC failure into a visible production Start reason', () => {
    expect(localGenerationStartError(new Error("Error invoking remote method 'auto-h3:start-production': Preflight failed"))).toBe('Preflight failed');
    expect(localGenerationStartError('')).toBe('Production Start failed without an error response.');
  });
});
