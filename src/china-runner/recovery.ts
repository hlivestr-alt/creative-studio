import type { ChinaAutoRunner } from './runner';
import type { PersistedJob } from './types';

export interface RecoverySummary {
  inspected: number;
  adopted: number;
  ambiguous: string[];
}

/** Read-only Phase 1 recovery. It adopts local evidence and never submits. */
export async function recoverShadowRunner(runner: ChinaAutoRunner): Promise<RecoverySummary> {
  const pending = runner.jobs().filter(job => job.phase === 'SUBMISSION_INTENT_PERSISTED' && !job.promptId);
  const summary: RecoverySummary = { inspected: pending.length, adopted: 0, ambiguous: [] };
  for (const job of pending) {
    const result = await runner.recoverSubmissionIntent(job.jobId);
    if (result.ambiguous) summary.ambiguous.push(job.jobId);
    else summary.adopted++;
  }
  return summary;
}

export function resumableJobs(jobs: PersistedJob[]): PersistedJob[] {
  return jobs.filter(job => !['COMPLETED', 'FAILED'].includes(job.phase));
}
