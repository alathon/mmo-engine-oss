import { BUFFER_OPEN_MS } from "../constants";

/**
 * Returns true if the current time is within the buffer window for the active cast.
 * The buffer window opens BUFFER_OPEN_MS after the cast starts and stays open
 * until the later of cast end or GCD end.
 */
export function canBufferAbility(
  nowMs: number,
  castStartTimeMs: number,
  castEndTimeMs: number,
  gcdEndTimeMs: number,
): boolean {
  const bufferOpenTimeMs = castStartTimeMs + BUFFER_OPEN_MS;
  const bufferCloseTimeMs = Math.max(castEndTimeMs, gcdEndTimeMs);
  if (bufferCloseTimeMs <= bufferOpenTimeMs) {
    return false;
  }

  return nowMs >= bufferOpenTimeMs && nowMs <= bufferCloseTimeMs;
}
