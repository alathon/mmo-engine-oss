import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * Interpolates between two angles, taking the shortest path.
 *
 * @param current - current angle in radians.
 * @param target - target angle in radians.
 * @param deltaTimeMs - elapsed time since last update, in milliseconds.
 * @param speed - interpolation speed in radians per second.
 * @return the interpolated angle in radians.
 */
export const lerpAngle = (
  current: number,
  target: number,
  deltaTimeMs: number,
  speed: number,
): number => {
  const twoPi = Math.PI * 2;
  const normalizedCurrent = ((current % twoPi) + twoPi) % twoPi;
  let normalizedTarget = ((target % twoPi) + twoPi) % twoPi;
  let delta = normalizedTarget - normalizedCurrent;

  if (delta > Math.PI) {
    delta -= twoPi;
  } else if (delta < -Math.PI) {
    delta += twoPi;
  }

  const step = Math.min(1, speed * (deltaTimeMs / 1000));
  normalizedTarget = normalizedCurrent + delta * step;

  return normalizedTarget;
};

export const vectorsEqual = (
  a: Vector3,
  b: Vector3,
  within: number,
): boolean => {
  // Can we do this without Math.abs? This method needs to run *very* fast.
  return (
    Math.abs(a.x - b.x) <= within &&
    Math.abs(a.y - b.y) <= within &&
    Math.abs(a.z - b.z) <= within
  );
};

export const positionsEqual = (
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  within: number,
): boolean => {
  return (
    Math.abs(x1 - x2) <= within &&
    Math.abs(y1 - y2) <= within &&
    Math.abs(z1 - z2) <= within
  );
};
