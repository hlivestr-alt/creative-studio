import { describe, expect, it, vi } from 'vitest';
import { AmbiguousSubmissionError, remoteJobIdentity, submitExactlyOnce } from './auto-h3-transport';

const id = '550e8400-e29b-41d4-a716-446655440000';
describe('auto submission duplicate prevention', () => {
  it('adopts a job accepted immediately before a lost POST response', async () => {
    const post = vi.fn().mockRejectedValue(new Error('fetch failed: Cloudflare disconnected'));
    const reconcile = vi.fn().mockResolvedValue({ prompt_id: id });
    expect(await submitExactlyOnce(post, reconcile)).toEqual({ prompt_id: id });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('never treats empty queue/history as proof that an ambiguous POST was not accepted', async () => {
    const post = vi.fn().mockRejectedValue(new Error('HTTP 504 timeout'));
    await expect(submitExactlyOnce(post, async () => null)).rejects.toBeInstanceOf(AmbiguousSubmissionError);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('retains ambiguity when reconciliation is also disconnected', async () => {
    const post = vi.fn().mockRejectedValue(new Error('connection reset'));
    await expect(submitExactlyOnce(post, async () => { throw new Error('DNS error'); })).rejects.toBeInstanceOf(AmbiguousSubmissionError);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('recognizes output prefix and metadata identities in queue and history', () => {
    expect(remoteJobIdentity({ queue_running: [[0, id, { '92': { inputs: { filename_prefix: 'h3-auto-job' } } }]] }, {}, 'h3-auto-job')).toBe(id);
    expect(remoteJobIdentity({}, { [id]: { prompt: [0, id, {}, { autoJobId: 'h3-auto-job' }] } }, 'h3-auto-job')).toBe(id);
    expect(remoteJobIdentity({}, { [id]: { prompt: [0, id, {}, { autoJobId: 'h3-auto-job-other' }] } }, 'h3-auto-job')).toBeNull();
  });
  it('does not endlessly retry an explicit validation rejection', async () => {
    const reconcile = vi.fn();
    await expect(submitExactlyOnce(async () => { throw new Error('ComfyUI rejected workflow (400)'); }, reconcile)).rejects.toThrow('400');
    expect(reconcile).not.toHaveBeenCalled();
  });
});
