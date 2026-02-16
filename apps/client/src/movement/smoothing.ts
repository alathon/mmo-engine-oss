import { lerpAngle } from "../utils/math";

const ROTATION_LERP_SPEED = 12;

export interface SmoothableEntity {
  position: { x: number; y: number; z: number };
  rotation: { y: number };
  getTargetPosition(): { x: number; y: number; z: number };
  getPreviousTargetPosition?(): { x: number; y: number; z: number };
  getMovementYaw(): number;
}

/**
 * Applies interpolation and rotation smoothing for an entity.
 */
export function applyMovementSmoothing(
  entity: SmoothableEntity,
  deltaTimeMs: number,
  fixedTickAlpha = 1,
): void {
  const targetPosition = entity.getTargetPosition();
  const clampedAlpha = Math.max(0, Math.min(1, fixedTickAlpha));
  const previousTargetPosition = entity.getPreviousTargetPosition?.() ?? targetPosition;
  entity.position.x =
    previousTargetPosition.x + (targetPosition.x - previousTargetPosition.x) * clampedAlpha;
  entity.position.y =
    previousTargetPosition.y + (targetPosition.y - previousTargetPosition.y) * clampedAlpha;
  entity.position.z =
    previousTargetPosition.z + (targetPosition.z - previousTargetPosition.z) * clampedAlpha;

  entity.rotation.y = lerpAngle(
    entity.rotation.y,
    entity.getMovementYaw(),
    deltaTimeMs,
    ROTATION_LERP_SPEED,
  );
}
