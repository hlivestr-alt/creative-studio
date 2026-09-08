import type { H3ContentType, H3VideoBrief, ProductId, RemoteH3GenerationRequest, ComputeJobState, CreativeGenome } from './types';

export const autoRetryMs = 5000;
export const defaultChinaRoot = 'D:\\AI Videos';
export const defaultLaptopRoot = 'C:\\Users\\HYPE AMD\\Videos\\04 AI Model Work\\MiniMax';
export interface AutoH3Config {
  selectedProducts: ProductId[];
  selectedContentTypes: H3ContentType[];
  shuffleProducts: boolean;
  shuffleContentTypes: boolean;
  chinaRoot: string;
  laptopRoot: string;
  /** Initial current H3 brief; it is not persisted as Auto Run session state. */
  brief: H3VideoBrief;
}
export interface AutoH3Session {
  selectedProducts: ProductId[];
  selectedContentTypes: H3ContentType[];
  shuffleProducts: boolean;
  shuffleContentTypes: boolean;
  chinaRoot: string;
  laptopRoot: string;
  /** Legacy sessions may still contain their original starting brief. */
  brief?: H3VideoBrief;
  sessionId: string;
  status: 'RUNNING' | 'INTERRUPTED' | 'STOPPING' | 'STOPPED';
  startedAt: string;
  stoppedAt: string | null;
  productOrder: ProductId[];
  contentTypeOrder: H3ContentType[];
  cycleNumber: number;
  cycleSeed: number;
  productIndex: number;
  contentTypeIndex: number;
  generatedCount: number;
  completedCount: number;
  failedCount: number;
  pendingLaptopDownloads: number;
  stopRequested: boolean;
  stopNowRequested?: boolean;
  currentJobId: string | null;
  lastSuccessfulJobId: string | null;
  lastError: string | null;
}
export interface AutoH3Job {
  autoJobId: string;
  sessionId: string;
  cycleNumber: number;
  cycleSeed: number;
  product: ProductId;
  contentType: H3ContentType;
  createdAt: string;
  finishedAt: string | null;
  status: 'PREPARED' | 'SUBMITTING' | 'RENDERING' | 'COMPLETED' | 'FAILED';
  request: RemoteH3GenerationRequest;
  state: ComputeJobState | null;
  attempt: number;
  diagnostics: string[];
  creativeGenome?: CreativeGenome;
  creativeFingerprint?: string;
  relativePath: string;
  chinaArchivePath: string | null;
  chinaArchiveSucceeded: boolean;
  chinaArchiveError: string | null;
  archiveSize: number | null;
  laptopOutputPath: string | null;
  laptopDownloadSucceeded: boolean;
  laptopDownloadError: string | null;
  downloadStatus: 'WAITING_RENDER' | 'PENDING_DOWNLOAD' | 'COMPLETE' | 'CANCELLED';
}
export interface AutoH3Snapshot { sessions: AutoH3Session[]; jobs: AutoH3Job[] }

export function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** The cursor advances only after a durable terminal result. Never queues a cycle. */
export function advanceAutoCursor(session: AutoH3Session, seed: number, random = Math.random): AutoH3Session {
  const next = { ...session, currentJobId: null, contentTypeIndex: session.contentTypeIndex + 1 };
  if (next.contentTypeIndex < next.contentTypeOrder.length) return next;
  next.contentTypeIndex = 0;
  next.productIndex++;
  if (next.productIndex >= next.productOrder.length) {
    next.productIndex = 0;
    next.cycleNumber++;
    next.cycleSeed = seed;
    next.productOrder = session.shuffleProducts ? shuffled(session.selectedProducts, random) : [...session.selectedProducts];
  }
  next.contentTypeOrder = session.shuffleContentTypes ? shuffled(session.selectedContentTypes, random) : [...session.selectedContentTypes];
  return next;
}

export function isTransientTransport(reason: unknown): boolean {
  const message = reason instanceof Error ? `${reason.message} ${String(reason.cause ?? '')}` : String(reason);
  return /fetch failed|network|socket|disconnect|cloudflare|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|connection|timed?\s*out|timeout|\b5\d{2}\b/i.test(message);
}

export function safeOutputComponent(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return safe && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(safe) ? safe : `_${safe || 'output'}`;
}
