import type { Navmesh, NavMovementResult, NavPolygon, NavRaycastResult, NavVertex } from "./types";

/**
 * Provides navmesh query operations for both client and server.
 * All methods are synchronous and deterministic.
 */
export class NavmeshQuery {
  private readonly navmesh: Navmesh;
  private readonly polygonMap: Map<number, NavPolygon>;

  constructor(navmesh: Navmesh) {
    this.navmesh = navmesh;
    this.polygonMap = new Map();
    for (const poly of navmesh.polygons) {
      this.polygonMap.set(poly.id, poly);
    }
  }

  /**
   * Returns the underlying navmesh data.
   */
  getNavmesh(): Navmesh {
    return this.navmesh;
  }

  /**
   * Finds the polygon containing the given XZ point.
   * Uses spatial grid for O(1) cell lookup, then tests polygons in that cell.
   *
   * @param x - world X coordinate.
   * @param z - world Z coordinate.
   * @returns polygon ID or -1 if not on navmesh.
   */
  findPolygon(x: number, z: number): number {
    const cellIndex = this.getCellIndex(x, z);
    if (cellIndex < 0 || cellIndex >= this.navmesh.grid.length) {
      return -1;
    }

    const candidatePolygons = this.navmesh.grid[cellIndex];
    if (!candidatePolygons || candidatePolygons.length === 0) {
      return -1;
    }

    for (const polyId of candidatePolygons) {
      const polygon = this.polygonMap.get(polyId);
      if (polygon && this.isPointInPolygon(x, z, polygon)) {
        return polyId;
      }
    }

    return -1;
  }

  /**
   * Samples the ground height at the given XZ position.
   * Returns interpolated Y from the polygon's vertices using barycentric coordinates.
   *
   * @param x - world X coordinate.
   * @param z - world Z coordinate.
   * @returns ground height or null if not on navmesh.
   */
  sampleHeight(x: number, z: number): number | null {
    const polyId = this.findPolygon(x, z);
    if (polyId < 0) {
      return null;
    }

    const polygon = this.polygonMap.get(polyId);
    if (!polygon) {
      return null;
    }

    return this.sampleHeightInPolygon(x, z, polygon);
  }

  /**
   * Tests if a point is within the walkable navmesh bounds.
   *
   * @param x - world X coordinate.
   * @param z - world Z coordinate.
   * @returns true if point is on walkable navmesh.
   */
  isPointOnNavmesh(x: number, z: number): boolean {
    return this.findPolygon(x, z) >= 0;
  }

  /**
   * Finds the nearest valid point on the navmesh.
   *
   * @param x - world X coordinate.
   * @param z - world Z coordinate.
   * @param maxDistance - maximum search radius.
   * @returns nearest valid point or null if none found within range.
   */
  findNearestPoint(
    x: number,
    z: number,
    maxDistance: number,
  ): { x: number; y: number; z: number; nodeRef: number } | null {
    // First check if already on navmesh
    const polyId = this.findPolygon(x, z);
    if (polyId >= 0) {
      const height = this.sampleHeight(x, z);
      return {
        x,
        y: height ?? 0,
        z,
        nodeRef: polyId,
      };
    }

    // Search nearby cells for the closest point
    const cellSize = this.navmesh.gridCellSize;
    const searchRadius = Math.ceil(maxDistance / cellSize);
    const centerCellX = Math.floor((x - this.navmesh.gridOriginX) / cellSize);
    const centerCellZ = Math.floor((z - this.navmesh.gridOriginZ) / cellSize);

    let bestPoint: { x: number; y: number; z: number; nodeRef: number } | null = null;
    let bestDistSq = maxDistance * maxDistance;

    for (let dz = -searchRadius; dz <= searchRadius; dz++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const cellX = centerCellX + dx;
        const cellZ = centerCellZ + dz;

        if (cellX < 0 || cellX >= this.navmesh.gridWidth) {
          continue;
        }
        if (cellZ < 0 || cellZ >= this.navmesh.gridHeight) {
          continue;
        }

        const cellIndex = cellZ * this.navmesh.gridWidth + cellX;
        const candidatePolygons = this.navmesh.grid[cellIndex];
        if (!candidatePolygons) {
          continue;
        }

        for (const candPolyId of candidatePolygons) {
          const polygon = this.polygonMap.get(candPolyId);
          if (!polygon) {
            continue;
          }

          const closest = this.closestPointOnPolygon(x, z, polygon);
          const distSq = (closest.x - x) ** 2 + (closest.z - z) ** 2;

          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestPoint = {
              x: closest.x,
              y: closest.y,
              z: closest.z,
              nodeRef: polygon.id,
            };
          }
        }
      }
    }

    return bestPoint;
  }

  /**
   * Validates a movement from current position by deltaX/deltaZ.
   * Returns the actual achievable position, clamped to navmesh edges if needed.
   * Implements edge sliding when movement is partially blocked.
   *
   * @param currentX - current world X.
   * @param currentZ - current world Z.
   * @param deltaX - desired X movement.
   * @param deltaZ - desired Z movement.
   * @param _startNodeRef - optional node ref, unused in grid navmesh.
   * @returns validated end position with height.
   */
  validateMovement(
    currentX: number,
    currentZ: number,
    deltaX: number,
    deltaZ: number,
    _startNodeRef?: number,
  ): NavMovementResult {
    const targetX = currentX + deltaX;
    const targetZ = currentZ + deltaZ;

    // If target is on navmesh, allow full movement
    if (this.isPointOnNavmesh(targetX, targetZ)) {
      const height = this.sampleHeight(targetX, targetZ) ?? 0;
      return {
        x: targetX,
        y: height,
        z: targetZ,
        collided: false,
        movementRatio: 1.0,
        nodeRef: undefined,
      };
    }

    // Try sliding along X axis only
    if (Math.abs(deltaX) > 0.0001 && this.isPointOnNavmesh(targetX, currentZ)) {
      const height = this.sampleHeight(targetX, currentZ) ?? 0;
      const fullDist = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
      const actualDist = Math.abs(deltaX);
      return {
        x: targetX,
        y: height,
        z: currentZ,
        collided: true,
        movementRatio: actualDist / fullDist,
        nodeRef: undefined,
      };
    }

    // Try sliding along Z axis only
    if (Math.abs(deltaZ) > 0.0001 && this.isPointOnNavmesh(currentX, targetZ)) {
      const height = this.sampleHeight(currentX, targetZ) ?? 0;
      const fullDist = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
      const actualDist = Math.abs(deltaZ);
      return {
        x: currentX,
        y: height,
        z: targetZ,
        collided: true,
        movementRatio: actualDist / fullDist,
        nodeRef: undefined,
      };
    }

    // Completely blocked - stay in place
    const height = this.sampleHeight(currentX, currentZ) ?? 0;
    return {
      x: currentX,
      y: height,
      z: currentZ,
      collided: true,
      movementRatio: 0,
      nodeRef: undefined,
    };
  }

  /**
   * Casts a ray from start to end and returns the first boundary intersection.
   *
   * @param startX - ray origin X.
   * @param startZ - ray origin Z.
   * @param endX - ray target X.
   * @param endZ - ray target Z.
   * @returns hit result or null if path is clear (both points on navmesh).
   */
  raycast(startX: number, startZ: number, endX: number, endZ: number): NavRaycastResult | null {
    // If start is not on navmesh, can't raycast
    const startPolyId = this.findPolygon(startX, startZ);
    if (startPolyId < 0) {
      return null;
    }

    // If end is on navmesh, path is clear
    if (this.isPointOnNavmesh(endX, endZ)) {
      return null;
    }

    // Binary search to find the boundary crossing point
    let lowX = startX;
    let lowZ = startZ;
    let highX = endX;
    let highZ = endZ;

    for (let i = 0; i < 16; i++) {
      const midX = (lowX + highX) / 2;
      const midZ = (lowZ + highZ) / 2;

      if (this.isPointOnNavmesh(midX, midZ)) {
        lowX = midX;
        lowZ = midZ;
      } else {
        highX = midX;
        highZ = midZ;
      }
    }

    const hitX = (lowX + highX) / 2;
    const hitZ = (lowZ + highZ) / 2;
    const hitY = this.sampleHeight(lowX, lowZ) ?? 0;
    const distance = Math.sqrt((hitX - startX) ** 2 + (hitZ - startZ) ** 2);
    const hitPolyId = this.findPolygon(lowX, lowZ);

    return {
      hitX,
      hitY,
      hitZ,
      distance,
      polygonId: hitPolyId,
    };
  }

  // -- Private Interface

  /**
   * Gets the grid cell index for a world position.
   */
  private getCellIndex(x: number, z: number): number {
    const cellX = Math.floor((x - this.navmesh.gridOriginX) / this.navmesh.gridCellSize);
    const cellZ = Math.floor((z - this.navmesh.gridOriginZ) / this.navmesh.gridCellSize);

    if (cellX < 0 || cellX >= this.navmesh.gridWidth) {
      return -1;
    }
    if (cellZ < 0 || cellZ >= this.navmesh.gridHeight) {
      return -1;
    }

    return cellZ * this.navmesh.gridWidth + cellX;
  }

  /**
   * Tests if point (px, pz) is inside polygon using cross-product method.
   * Vertices must be ordered counter-clockwise when viewed from above.
   */
  private isPointInPolygon(px: number, pz: number, polygon: NavPolygon): boolean {
    const vertices = this.navmesh.vertices;
    const indices = polygon.vertexIndices;
    const n = indices.length;

    for (let i = 0; i < n; i++) {
      const v0 = vertices[indices[i]];
      const v1 = vertices[indices[(i + 1) % n]];

      // Cross product: (v1 - v0) x (p - v0)
      const cross = (v1.x - v0.x) * (pz - v0.z) - (v1.z - v0.z) * (px - v0.x);

      // If cross < 0, point is on wrong side of edge (outside)
      if (cross < 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Samples height at (px, pz) within a polygon using barycentric interpolation.
   */
  private sampleHeightInPolygon(px: number, pz: number, polygon: NavPolygon): number {
    const vertices = this.navmesh.vertices;
    const indices = polygon.vertexIndices;

    // For triangles or larger polygons, triangulate from vertex 0
    const v0 = vertices[indices[0]];

    for (let i = 1; i < indices.length - 1; i++) {
      const v1 = vertices[indices[i]];
      const v2 = vertices[indices[i + 1]];

      const bary = this.computeBarycentric(px, pz, v0, v1, v2);
      if (bary.u >= -0.001 && bary.v >= -0.001 && bary.w >= -0.001) {
        return bary.u * v0.y + bary.v * v1.y + bary.w * v2.y;
      }
    }

    // Fallback: return average height
    let sum = 0;
    for (const idx of indices) {
      sum += vertices[idx].y;
    }
    return sum / indices.length;
  }

  /**
   * Computes barycentric coordinates for point (px, pz) in triangle v0-v1-v2.
   */
  private computeBarycentric(
    px: number,
    pz: number,
    v0: NavVertex,
    v1: NavVertex,
    v2: NavVertex,
  ): { u: number; v: number; w: number } {
    const d00 = (v1.x - v0.x) * (v1.x - v0.x) + (v1.z - v0.z) * (v1.z - v0.z);
    const d01 = (v1.x - v0.x) * (v2.x - v0.x) + (v1.z - v0.z) * (v2.z - v0.z);
    const d11 = (v2.x - v0.x) * (v2.x - v0.x) + (v2.z - v0.z) * (v2.z - v0.z);
    const d20 = (px - v0.x) * (v1.x - v0.x) + (pz - v0.z) * (v1.z - v0.z);
    const d21 = (px - v0.x) * (v2.x - v0.x) + (pz - v0.z) * (v2.z - v0.z);

    const denom = d00 * d11 - d01 * d01;
    if (Math.abs(denom) < 0.0001) {
      return { u: 1, v: 0, w: 0 };
    }

    const v = (d11 * d20 - d01 * d21) / denom;
    const w = (d00 * d21 - d01 * d20) / denom;
    const u = 1 - v - w;

    return { u, v, w };
  }

  /**
   * Finds the closest point on a polygon's boundary to the given point.
   */
  private closestPointOnPolygon(px: number, pz: number, polygon: NavPolygon): NavVertex {
    const vertices = this.navmesh.vertices;
    const indices = polygon.vertexIndices;
    const n = indices.length;

    let bestX = vertices[indices[0]].x;
    let bestZ = vertices[indices[0]].z;
    let bestDistSq = Infinity;

    for (let i = 0; i < n; i++) {
      const v0 = vertices[indices[i]];
      const v1 = vertices[indices[(i + 1) % n]];

      // Project point onto edge
      const edgeX = v1.x - v0.x;
      const edgeZ = v1.z - v0.z;
      const edgeLenSq = edgeX * edgeX + edgeZ * edgeZ;

      if (edgeLenSq < 0.0001) {
        continue;
      }

      let t = ((px - v0.x) * edgeX + (pz - v0.z) * edgeZ) / edgeLenSq;
      t = Math.max(0, Math.min(1, t));

      const closestX = v0.x + t * edgeX;
      const closestZ = v0.z + t * edgeZ;
      const distSq = (closestX - px) ** 2 + (closestZ - pz) ** 2;

      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestX = closestX;
        bestZ = closestZ;
      }
    }

    // Interpolate height
    const height = this.sampleHeightInPolygon(bestX, bestZ, polygon);

    return { x: bestX, y: height, z: bestZ };
  }
}
