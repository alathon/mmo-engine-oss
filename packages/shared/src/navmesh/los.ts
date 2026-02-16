import {
  DEFAULT_QUERY_FILTER,
  INVALID_NODE_REF,
  NodeType,
  geometry,
  getNodeByRef,
  getNodeRefType,
  getTileAndPolyByRef,
  isValidNodeRef,
  type NavMesh,
  type Vec3,
} from "navcat";
import { NAVMESH_RECOVERY_DISTANCE } from "../constants";
import type { NavcatQuery } from "./navcat-query";

export interface NavmeshPoint {
  x: number;
  y: number;
  z: number;
}

const RAYCAST_CLEAR_THRESHOLD = 0.999;
const RAYCAST_MAX_T = Number.MAX_VALUE;

interface RaycastResult {
  t: number;
}

const hasFiniteVec3 = (value: Vec3): boolean =>
  Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]);

/**
 * Navcat raycast wrapper that supports nodeRef 0.
 * (navcat raycast uses `while (curRef)` which treats 0 as false.)
 */
// TODO: Replace with navcat raycast() when https://github.com/isaac-mason/navcat/issues/41
// is fixed.
const raycastAllowZero = (
  navMesh: NavMesh,
  startNodeRef: number,
  startPosition: Vec3,
  endPosition: Vec3,
): RaycastResult => {
  const result: RaycastResult = { t: 0 };
  if (
    !isValidNodeRef(navMesh, startNodeRef) ||
    !hasFiniteVec3(startPosition) ||
    !hasFiniteVec3(endPosition)
  ) {
    return result;
  }

  const intersectResult = geometry.createIntersectSegmentPoly2DResult();
  let curRef = startNodeRef;

  while (curRef !== INVALID_NODE_REF) {
    const tileAndPoly = getTileAndPolyByRef(curRef, navMesh);
    if (!tileAndPoly.success) {
      break;
    }
    const { tile, poly } = tileAndPoly;
    const nv = poly.vertices.length;
    const vertices: number[] = Array.from({ length: nv * 3 });
    for (let i = 0; i < nv; i += 1) {
      const start = poly.vertices[i] * 3;
      vertices[i * 3] = tile.vertices[start];
      vertices[i * 3 + 1] = tile.vertices[start + 1];
      vertices[i * 3 + 2] = tile.vertices[start + 2];
    }

    geometry.intersectSegmentPoly2D(intersectResult, startPosition, endPosition, nv, vertices);
    if (!intersectResult.intersects) {
      return result;
    }
    if (intersectResult.tmax > result.t) {
      result.t = intersectResult.tmax;
    }
    if (intersectResult.segMax === -1) {
      result.t = RAYCAST_MAX_T;
      return result;
    }

    let nextRef: number | undefined;
    const curNode = getNodeByRef(navMesh, curRef);
    if (!curNode) {
      break;
    }

    for (const linkIndex of curNode.links) {
      const link = navMesh.links[linkIndex];
      if (link.edge !== intersectResult.segMax) {
        continue;
      }
      if (getNodeRefType(link.toNodeRef) === NodeType.OFFMESH) {
        continue;
      }
      const nextTileAndPoly = getTileAndPolyByRef(link.toNodeRef, navMesh);
      if (!nextTileAndPoly.success) {
        continue;
      }
      if (!DEFAULT_QUERY_FILTER.passFilter(link.toNodeRef, navMesh)) {
        continue;
      }

      if (link.side === 0xff) {
        nextRef = link.toNodeRef;
        break;
      }
      if (link.bmin === 0 && link.bmax === 255) {
        nextRef = link.toNodeRef;
        break;
      }

      const v0 = poly.vertices[link.edge];
      const v1 = poly.vertices[(link.edge + 1) % poly.vertices.length];
      const left: Vec3 = [
        tile.vertices[v0 * 3],
        tile.vertices[v0 * 3 + 1],
        tile.vertices[v0 * 3 + 2],
      ];
      const right: Vec3 = [
        tile.vertices[v1 * 3],
        tile.vertices[v1 * 3 + 1],
        tile.vertices[v1 * 3 + 2],
      ];

      if (link.side === 0 || link.side === 4) {
        const s = 1.0 / 255.0;
        let lmin = left[2] + (right[2] - left[2]) * (link.bmin * s);
        let lmax = left[2] + (right[2] - left[2]) * (link.bmax * s);
        if (lmin > lmax) {
          [lmin, lmax] = [lmax, lmin];
        }
        const z = startPosition[2] + (endPosition[2] - startPosition[2]) * intersectResult.tmax;
        if (z >= lmin && z <= lmax) {
          nextRef = link.toNodeRef;
          break;
        }
      } else if (link.side === 2 || link.side === 6) {
        const s = 1.0 / 255.0;
        let lmin = left[0] + (right[0] - left[0]) * (link.bmin * s);
        let lmax = left[0] + (right[0] - left[0]) * (link.bmax * s);
        if (lmin > lmax) {
          [lmin, lmax] = [lmax, lmin];
        }
        const x = startPosition[0] + (endPosition[0] - startPosition[0]) * intersectResult.tmax;
        if (x >= lmin && x <= lmax) {
          nextRef = link.toNodeRef;
          break;
        }
      }
    }

    if (nextRef === undefined) {
      return result;
    }
    curRef = nextRef;
  }

  return result;
};

/**
 * Performs a navmesh raycast to determine line-of-sight between two points.
 */
export function hasLineOfSight(
  navmesh: NavcatQuery,
  from: NavmeshPoint,
  to: NavmeshPoint,
  maxSnapDistance: number = NAVMESH_RECOVERY_DISTANCE,
): boolean {
  const start = navmesh.findNearestPoint(from.x, from.z, maxSnapDistance);
  if (!start) {
    return false;
  }

  const end = navmesh.findNearestPoint(to.x, to.z, maxSnapDistance);
  if (!end) {
    return false;
  }

  const startPos: Vec3 = [start.x, start.y, start.z];
  const endPos: Vec3 = [end.x, end.y, end.z];
  const result = raycastAllowZero(navmesh.getNavmesh(), start.nodeRef, startPos, endPos);
  return result.t >= RAYCAST_CLEAR_THRESHOLD;
}
