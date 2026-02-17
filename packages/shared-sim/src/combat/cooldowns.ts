export function computeGcdEndTimeMs(
  isOnGcd: boolean,
  castStartTimeMs: number,
  gcdMs: number,
  castInterrupted = false,
): number | null {
  if (!isOnGcd || castInterrupted) {
    return null;
  }

  return castStartTimeMs + gcdMs;
}
