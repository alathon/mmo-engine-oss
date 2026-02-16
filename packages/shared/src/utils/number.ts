/**
 * Coerces a value to a finite number, falling back when invalid.
 */
export const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
