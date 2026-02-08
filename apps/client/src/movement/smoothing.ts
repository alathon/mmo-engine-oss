import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PLAYER_SPEED } from "@mmo/shared";
import { lerpAngle } from "../utils/math";

const ROTATION_LERP_SPEED = 12;

export interface SmoothableEntity {
  position: Vector3;
  rotation: { y: number };
  getTargetPosition(): Vector3;
  getMovementYaw(): number;
}

/**
 * Applies interpolation and rotation smoothing for an entity.
 */
export function applyMovementSmoothing(
  entity: SmoothableEntity,
  deltaTimeMs: number,
): void {
  const diff = entity.getTargetPosition().subtract(entity.position);
  const distance = diff.length();

  if (distance > 0.01) {
    const moveAmount = Math.min(distance, PLAYER_SPEED * (deltaTimeMs / 1000));
    const movement = diff.scale(moveAmount / distance);

    entity.position.addInPlace(movement);
  }

  entity.rotation.y = lerpAngle(
    entity.rotation.y,
    entity.getMovementYaw(),
    deltaTimeMs,
    ROTATION_LERP_SPEED,
  );
}
