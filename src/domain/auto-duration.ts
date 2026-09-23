export const AUTO_DURATION_MIN = 8;
export const AUTO_DURATION_MAX = 15;

/** Called once when a new Auto Run job is created. */
export function selectAutoDuration(random = Math.random): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Random duration source must return a value in [0, 1).');
  return AUTO_DURATION_MIN + Math.floor(value * (AUTO_DURATION_MAX - AUTO_DURATION_MIN + 1));
}

export function isAutoDuration(value: number): boolean {
  return Number.isInteger(value) && value >= AUTO_DURATION_MIN && value <= AUTO_DURATION_MAX;
}
