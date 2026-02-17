import type { MeshPredicate, Ray } from "@babylonjs/core/Culling/ray.core.js";
import { Ray as BabylonRay } from "@babylonjs/core/Culling/ray.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";

export interface LineOfSightPoint {
  x: number;
  y: number;
  z: number;
}

export type NavmeshPoint = LineOfSightPoint;

export interface LineOfSightOptions {
  /**
   * Mesh filter for potential blockers.
   * The default considers enabled meshes with collision enabled.
   */
  meshPredicate?: MeshPredicate;
  /**
   * If true, Babylon returns the first hit in mesh iteration order.
   * Default is false to guarantee closest-hit behavior.
   */
  fastCheck?: boolean;
  /**
   * Vertical eye/chest offset applied to source and target to avoid
   * foot-level ground intersections.
   */
  verticalOffset?: number;
}

const LOS_POINT_EPSILON = 0.000_001;
const LOS_DISTANCE_EPSILON = 0.001;
const DEFAULT_VERTICAL_OFFSET = 1.0;
const DEFAULT_MESH_PREDICATE: MeshPredicate = (mesh) => mesh.checkCollisions && mesh.isEnabled();
const DEFAULT_FAST_CHECK = false;
const DEFAULT_LINE_OF_SIGHT_OPTIONS: Readonly<LineOfSightOptions> = {};
const LOS_ORIGIN = Vector3.Zero();
const LOS_DIRECTION = Vector3.Zero();
const LOS_RAY: Ray = new BabylonRay(LOS_ORIGIN, LOS_DIRECTION, 0);

/**
 * Performs a Babylon raycast to determine line-of-sight between two points.
 */
export function hasLineOfSight(
  scene: Scene,
  from: LineOfSightPoint,
  to: LineOfSightPoint,
  options?: Readonly<LineOfSightOptions>,
): boolean {
  if (scene.isDisposed) {
    return false;
  }

  const resolvedOptions = options ?? DEFAULT_LINE_OF_SIGHT_OPTIONS;
  const verticalOffset = resolvedOptions.verticalOffset ?? DEFAULT_VERTICAL_OFFSET;
  const fromY = from.y + verticalOffset;
  const toY = to.y + verticalOffset;
  const dx = to.x - from.x;
  const dy = toY - fromY;
  const dz = to.z - from.z;
  const distanceSq = dx * dx + dy * dy + dz * dz;
  if (distanceSq <= LOS_POINT_EPSILON) {
    return true;
  }

  const distance = Math.sqrt(distanceSq);
  const invDistance = 1 / distance;
  LOS_ORIGIN.set(from.x, fromY, from.z);
  LOS_DIRECTION.set(dx * invDistance, dy * invDistance, dz * invDistance);
  LOS_RAY.length = distance;

  const hit = scene.pickWithRay(
    LOS_RAY,
    resolvedOptions.meshPredicate ?? DEFAULT_MESH_PREDICATE,
    resolvedOptions.fastCheck ?? DEFAULT_FAST_CHECK,
  );
  if (!hit?.hit) {
    return true;
  }

  return hit.distance >= distance - LOS_DISTANCE_EPSILON;
}
