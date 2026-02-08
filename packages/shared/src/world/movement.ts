import type { NavMovementResult } from "../navmesh/types";

export interface NavmeshMovementAdapter {
  /**
   * Validates a navmesh movement step.
   *
   * @param currentX - current world X.
   * @param currentZ - current world Z.
   * @param deltaX - desired X movement.
   * @param deltaZ - desired Z movement.
   * @param startNodeRef - optional node ref to seed movement.
   * @returns validated end position with height.
   */
  validateMovement(
    currentX: number,
    currentZ: number,
    deltaX: number,
    deltaZ: number,
    startNodeRef?: number,
  ): NavMovementResult;

  /**
   * Finds the nearest point on the navmesh within a max distance.
   *
   * @param x - world X coordinate.
   * @param z - world Z coordinate.
   * @param maxDistance - maximum search radius.
   * @returns nearest point or null if none found within range.
   */
  findNearestPoint(
    x: number,
    z: number,
    maxDistance: number,
  ): { x: number; y: number; z: number; nodeRef: number } | null;
}

export interface NavmeshMovementStepInput {
  /** Current X position. */
  currentX: number;
  /** Current Z position. */
  currentZ: number;
  /** Normalized movement direction on X axis. */
  directionX: number;
  /** Normalized movement direction on Z axis. */
  directionZ: number;
  /** Elapsed time in seconds. */
  deltaTime: number;
  /** Movement speed in units per second. */
  speed: number;
  /** Navmesh adapter for validation. */
  navmesh: NavmeshMovementAdapter;
  /** Optional node ref to seed navmesh movement. */
  startNodeRef?: number;
  /** Optional recovery distance for snapping back to navmesh. */
  recoveryDistance?: number;
}

/**
 * Applies a navmesh-only movement step using shared movement math.
 *
 * @param input - movement step parameters.
 * @returns validated end position with height.
 */
export function applyNavmeshMovementStep(
  input: NavmeshMovementStepInput,
): NavMovementResult {
  const recoverySnapEpsilon = 0.01;
  const {
    currentX,
    currentZ,
    directionX,
    directionZ,
    deltaTime,
    speed,
    navmesh,
    startNodeRef,
    recoveryDistance,
  } = input;

  if (deltaTime <= 0 || (directionX === 0 && directionZ === 0)) {
    const idleResult = navmesh.validateMovement(
      currentX,
      currentZ,
      0,
      0,
      startNodeRef,
    );
    if (idleResult.movementRatio === 0 && recoveryDistance) {
      const nearest = navmesh.findNearestPoint(
        currentX,
        currentZ,
        recoveryDistance,
      );
      if (nearest) {
        const dx = nearest.x - currentX;
        const dz = nearest.z - currentZ;
        if (dx * dx + dz * dz <= recoverySnapEpsilon * recoverySnapEpsilon) {
          return idleResult;
        }
        return {
          x: nearest.x,
          y: nearest.y,
          z: nearest.z,
          collided: true,
          movementRatio: 0,
          nodeRef: nearest.nodeRef,
        };
      }
    }
    return idleResult;
  }

  const deltaX = directionX * speed * deltaTime;
  const deltaZ = directionZ * speed * deltaTime;

  const result = navmesh.validateMovement(
    currentX,
    currentZ,
    deltaX,
    deltaZ,
    startNodeRef,
  );
  if (result.movementRatio === 0 && recoveryDistance) {
    const nearest = navmesh.findNearestPoint(
      currentX,
      currentZ,
      recoveryDistance,
    );
    if (nearest) {
      const dx = nearest.x - currentX;
      const dz = nearest.z - currentZ;
      if (dx * dx + dz * dz <= recoverySnapEpsilon * recoverySnapEpsilon) {
        return result;
      }
      return {
        x: nearest.x,
        y: nearest.y,
        z: nearest.z,
        collided: true,
        movementRatio: 0,
        nodeRef: nearest.nodeRef,
      };
    }
  }
  return result;
}
