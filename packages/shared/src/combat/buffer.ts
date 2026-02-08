import { INTERNAL_COOLDOWN_MS } from "../constants";

/**
 * Returns true if the current time is within the buffer window for the active cast.
 * The buffer window opens INTERNAL_COOLDOWN_MS after the cast starts.
 */
export function canBufferAbility(
  nowMs: number,
  castStartTimeMs: number,
  castEndTimeMs: number,
): boolean {
  if (castEndTimeMs <= castStartTimeMs) {
    return false;
  }

  const bufferOpenTimeMs = castStartTimeMs + INTERNAL_COOLDOWN_MS;

  return nowMs >= bufferOpenTimeMs && nowMs <= castEndTimeMs;
}
