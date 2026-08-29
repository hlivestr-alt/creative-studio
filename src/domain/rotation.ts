import type { HistoryRecord, ProductId, RotationRecommendation } from './types';

const ROTATABLE: ProductId[] = ['cleanser', 'toner', 'serum', 'eye-cream', 'skin-cream', 'mask'];

export function recommendProduct(history: HistoryRecord[], now = new Date()): RotationRecommendation {
  const used = history.filter((item) => item.status === 'Used' && item.product !== 'full-series');
  const scores: Record<string, number> = {};
  const metadata = ROTATABLE.map((productId) => {
    const occurrences = used.filter((item) => item.product === productId);
    const last = occurrences.map((item) => new Date(item.createdAt).getTime()).sort((a, b) => b - a)[0];
    const daysSince = last ? Math.max(0, Math.floor((now.getTime() - last) / 86_400_000)) : 365;
    const recentCount = occurrences.filter((item) => now.getTime() - new Date(item.createdAt).getTime() <= 30 * 86_400_000).length;
    const consecutivePenalty = used.slice(0, 2).filter((item) => item.product === productId).length * 40;
    const score = Math.min(daysSince, 90) * 2 - recentCount * 12 - consecutivePenalty;
    scores[productId] = score;
    return { productId, score, daysSince, recentCount, neverUsed: !last };
  });

  metadata.sort((a, b) => b.score - a.score || ROTATABLE.indexOf(a.productId) - ROTATABLE.indexOf(b.productId));
  const winner = metadata[0];
  const reason = winner.neverUsed
    ? 'not featured in Used history yet'
    : `${winner.daysSince} day${winner.daysSince === 1 ? '' : 's'} since last Used post; ${winner.recentCount} in the last 30 days`;
  return { productId: winner.productId, reason, scores };
}
