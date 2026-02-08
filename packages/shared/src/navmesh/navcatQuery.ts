import {
  DEFAULT_QUERY_FILTER,
  createGetClosestPointOnPolyResult,
  createFindNearestPolyResult,
  findSmoothPath,
  findNearestPoly,
  getClosestPointOnPoly,
  moveAlongSurface,
  type FindSmoothPathResult,
  type NavMesh,
  type NodeRef,
  type Vec3,
} from "navcat";
import type { NavMovementResult } from "./types";
import { NAVMESH_DEBUG_LOGS } from "../constants";

const SNAP_DEBUG_PREFIX = "[snap-bug]";

export interface NavcatStats {
  nodes: number;
  tiles: number;
  links: number;
}

export class NavcatQuery {
  private navMesh: NavMesh;
  private readonly halfExtents: Vec3 = [0.5, 1.0, 0.5];
  private static readonly MIN_MOVE_DISTANCE = 0.0001;

  /**
   * Creates a navcat query wrapper for navmesh movement.
   *
   * @param navMesh - navcat navmesh data.
   */
  constructor(navMesh: NavMesh) {
    this.navMesh = navMesh;
  }

  /**
   * Returns the underlying navmesh data.
   */
  getNavmesh(): NavMesh {
    return this.navMesh;
  }

  /**
   * Returns navmesh stats for debugging.
   */
  getStats(): NavcatStats {
    return {
      nodes: this.navMesh.nodes.length,
      links: this.navMesh.links.length,
      tiles: Object.keys(this.navMesh.tiles).length,
    };
  }

  /**
   * Tests if a point is on the navmesh by checking nearest polygon.
   *
   * @param x - world X coordinate.
   * @param z - world Z coordinate.
   * @returns true if the point can be projected to the navmesh.
   */
  isPointOnNavmesh(x: number, z: number): boolean {
    const start: Vec3 = [x, 0, z];
    const result = createFindNearestPolyResult();
    const nearest = findNearestPoly(
      result,
      this.navMesh,
      start,
      this.halfExtents,
      DEFAULT_QUERY_FILTER,
    );
    this.logNearestPolyDebug("isPointOnNavmesh", start, nearest);
    return nearest.success;
  }

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
  ): { x: number; y: number; z: number; nodeRef: number } | null {
    const center: Vec3 = [x, 0, z];
    const nearestResult = createFindNearestPolyResult();
    const nearest = findNearestPoly(
      nearestResult,
      this.navMesh,
      center,
      this.halfExtents,
      DEFAULT_QUERY_FILTER,
    );

    this.logNearestPolyDebug("findNearestPoint", center, nearest);

    if (!nearest.success) {
      return null;
    }

    const closestResult = createGetClosestPointOnPolyResult();
    const closest = getClosestPointOnPoly(
      closestResult,
      this.navMesh,
      nearest.nodeRef,
      center,
    );

    if (!closest.success) {
      return null;
    }

    const dx = closest.position[0] - x;
    const dz = closest.position[2] - z;
    const distSq = dx * dx + dz * dz;
    if (distSq > maxDistance * maxDistance) {
      return null;
    }

    return {
      x: closest.position[0],
      y: closest.position[1],
      z: closest.position[2],
      nodeRef: nearest.nodeRef,
    };
  }

  /**
   * Samples the ground height at the given XZ position.
   *
   * @param x - world X coordinate.
   * @param z - world Z coordinate.
   * @returns ground height or null if not on navmesh.
   */
  sampleHeight(x: number, z: number): number | null {
    const center: Vec3 = [x, 0, z];
    const nearestResult = createFindNearestPolyResult();
    const nearest = findNearestPoly(
      nearestResult,
      this.navMesh,
      center,
      this.halfExtents,
      DEFAULT_QUERY_FILTER,
    );

    this.logNearestPolyDebug("sampleHeight", center, nearest);

    if (!nearest.success) {
      return null;
    }

    const closestResult = createGetClosestPointOnPolyResult();
    const closest = getClosestPointOnPoly(
      closestResult,
      this.navMesh,
      nearest.nodeRef,
      center,
    );

    if (!closest.success) {
      return null;
    }

    return closest.position[1];
  }

  /**
   * Finds a smooth path between two points on the navmesh.
   *
   * @param startX - start world X coordinate.
   * @param startZ - start world Z coordinate.
   * @param endX - end world X coordinate.
   * @param endZ - end world Z coordinate.
   * @param stepSize - step size for the smooth path iteration.
   * @param slop - distance tolerance for reaching waypoints.
   * @param maxPoints - maximum number of points to generate.
   * @returns smooth path result with path points.
   */
  findSmoothPath(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    stepSize: number,
    slop: number,
    maxPoints: number,
  ): FindSmoothPathResult {
    const start: Vec3 = [startX, 0, startZ];
    const end: Vec3 = [endX, 0, endZ];
    const clampedStep = Math.max(stepSize, NavcatQuery.MIN_MOVE_DISTANCE);
    const clampedSlop = Math.max(slop, NavcatQuery.MIN_MOVE_DISTANCE);
    const clampedMaxPoints = Math.max(2, Math.floor(maxPoints));

    return findSmoothPath(
      this.navMesh,
      start,
      end,
      this.halfExtents,
      DEFAULT_QUERY_FILTER,
      clampedStep,
      clampedSlop,
      clampedMaxPoints,
    );
  }

  /**
   * Moves along the navmesh surface using navcat's moveAlongSurface.
   *
   * @param currentX - current world X.
   * @param currentZ - current world Z.
   * @param deltaX - desired X movement.
   * @param deltaZ - desired Z movement.
   * @param startNodeRef - optional node reference to seed movement.
   * @returns validated end position with height.
   */
  validateMovement(
    currentX: number,
    currentZ: number,
    deltaX: number,
    deltaZ: number,
    startNodeRef?: number,
  ): NavMovementResult {
    const requested = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
    if (requested < NavcatQuery.MIN_MOVE_DISTANCE) {
      const start: Vec3 = [currentX, 0, currentZ];
      const nearestResult = createFindNearestPolyResult();
      const nearest = findNearestPoly(
        nearestResult,
        this.navMesh,
        start,
        this.halfExtents,
        DEFAULT_QUERY_FILTER,
      );

      this.logNearestPolyDebug("validateMovement", start, nearest);

      if (!nearest.success) {
        return {
          x: currentX,
          y: 0,
          z: currentZ,
          collided: true,
          movementRatio: 0,
        };
      }

      const closestResult = createGetClosestPointOnPolyResult();
      const closest = getClosestPointOnPoly(
        closestResult,
        this.navMesh,
        nearest.nodeRef,
        start,
      );

      if (!closest.success) {
        return {
          x: currentX,
          y: 0,
          z: currentZ,
          collided: true,
          movementRatio: 0,
        };
      }

      return {
        x: closest.position[0],
        y: closest.position[1],
        z: closest.position[2],
        collided: false,
        movementRatio: 1,
        nodeRef: nearest.nodeRef ?? startNodeRef ?? undefined,
      };
    }

    const start: Vec3 = [currentX, 0, currentZ];
    const end: Vec3 = [currentX + deltaX, 0, currentZ + deltaZ];
    const nearestResult = createFindNearestPolyResult();
    const nearest = findNearestPoly(
      nearestResult,
      this.navMesh,
      start,
      this.halfExtents,
      DEFAULT_QUERY_FILTER,
    );

    this.logNearestPolyDebug("validateMovement", start, nearest);

    if (!nearest.success) {
      return {
        x: currentX,
        y: 0,
        z: currentZ,
        collided: true,
        movementRatio: 0,
      };
    }

    const resolvedStartNodeRef = nearest.nodeRef ?? startNodeRef ?? 0;
    const move = moveAlongSurface(
      this.navMesh,
      resolvedStartNodeRef,
      start,
      end,
      DEFAULT_QUERY_FILTER,
    );
    let finalPos: Vec3 = [move.position[0], move.position[1], move.position[2]];
    let movedX = finalPos[0] - currentX;
    let movedZ = finalPos[2] - currentZ;
    let actual = Math.sqrt(movedX * movedX + movedZ * movedZ);
    let overshootClamped = false;
    const overshootLimit = requested * 1.001;

    if (actual > overshootLimit) {
      const scale = requested / actual;
      const clampedPos: Vec3 = [
        currentX + movedX * scale,
        finalPos[1],
        currentZ + movedZ * scale,
      ];

      if (move.nodeRef) {
        const closestResult = createGetClosestPointOnPolyResult();
        const closest = getClosestPointOnPoly(
          closestResult,
          this.navMesh,
          move.nodeRef,
          clampedPos,
        );
        if (closest.success) {
          clampedPos[1] = closest.position[1];
        }
      }

      finalPos = clampedPos;
      movedX = finalPos[0] - currentX;
      movedZ = finalPos[2] - currentZ;
      actual = Math.sqrt(movedX * movedX + movedZ * movedZ);
      overshootClamped = true;
    }

    return {
      x: finalPos[0],
      y: finalPos[1],
      z: finalPos[2],
      collided: !move.success || actual < requested * 0.99 || overshootClamped,
      movementRatio: actual / requested,
      nodeRef: move.nodeRef ?? resolvedStartNodeRef ?? undefined,
    };
  }

  private logNearestPolyDebug(
    label: string,
    position: Vec3,
    nearest: { success: boolean; nodeRef: NodeRef },
  ): void {
    if (!nearest.success || nearest.nodeRef == null) {
      return;
    }

    const closestResult = createGetClosestPointOnPolyResult();
    const closest = getClosestPointOnPoly(
      closestResult,
      this.navMesh,
      nearest.nodeRef,
      position,
    );

    if (!closest.success) {
      return;
    }
  }
}
