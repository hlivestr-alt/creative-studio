import { isTransientTransport } from '../../src/domain/auto-h3';

export class AmbiguousSubmissionError extends Error {
  constructor() { super('Submission acceptance is unknown. Reconciling the same job every 5 seconds; no replacement will be submitted.'); }
}

/** No absence from queue/history can prove non-acceptance after a timeout. */
export async function submitExactlyOnce<T>(post: () => Promise<T>, reconcile: () => Promise<T | null>): Promise<T> {
  try { return await post(); }
  catch (error) {
    if (!isTransientTransport(error)) throw error;
    try {
      const adopted = await reconcile();
      if (adopted) return adopted;
    } catch { /* Preserve ambiguity even if reconciliation itself is offline. */ }
    throw new AmbiguousSubmissionError();
  }
}

export function remoteJobIdentity(queue: unknown, history: unknown, identity: string): string | null {
  const hasIdentity = (value: unknown): boolean => {
    if (typeof value === 'string') return value === identity || value.includes(`/${identity}`) || value.startsWith(`${identity}_`);
    if (Array.isArray(value)) return value.some(hasIdentity);
    if (value && typeof value === 'object') return Object.values(value).some(hasIdentity);
    return false;
  };
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id);
  if (queue && typeof queue === 'object') {
    for (const entries of Object.values(queue)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) if (Array.isArray(entry) && validId(entry[1]) && hasIdentity(entry)) return entry[1];
    }
  }
  if (history && typeof history === 'object') {
    for (const [id, entry] of Object.entries(history)) if (validId(id) && hasIdentity(entry)) return id;
  }
  return null;
}
