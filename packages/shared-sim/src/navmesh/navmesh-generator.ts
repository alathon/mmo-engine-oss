import type { Navmesh, NavPolygon, NavVertex } from "./types";
import { NAV_POLYGON_FLAGS } from "./types";

/**
 * A collidable object for navmesh generation.
 * This is a simple interface that doesn't depend on specific entity types.
 */
export interface NavmeshObstacle {
  /** World X position. */
  x: number;
  /** World Z position. */
  z: number;
  /** Collision radius (typically size / 2). */
  radius: number;
}

/**
 * Scene bounds for navmesh generation.
 */
export interface NavmeshBounds {
  /** Minimum X coordinate. */
  minX: number;
  /** Maximum X coordinate. */
  maxX: number;
  /** Minimum Z coordinate. */
  minZ: number;
  /** Maximum Z coordinate. */
  maxZ: number;
}

/**
 * Configuration for navmesh generation.
 */
export interface NavmeshGeneratorConfig {
  /** Scene bounds defining the walkable area. */
  bounds: NavmeshBounds;
  /** List of collidable obstacles to exclude from the navmesh. */
  obstacles: NavmeshObstacle[];
  /** Size of each grid cell in world units. Defaults to 1. */
  cellSize?: number;
  /** Extra margin around obstacles (in world units). Defaults to 0.2. */
  obstacleMargin?: number;
  /** Default ground height. Defaults to 0. */
  groundHeight?: number;
}

/**
 * Generates a grid-based navmesh for a scene.
 * Creates a grid of walkable cells, excluding cells that contain obstacles.
 *
 * @param config - generation configuration with bounds and obstacles.
 * @returns generated navmesh data.
 */
export function generateNavmesh(config: NavmeshGeneratorConfig): Navmesh {
  const { bounds, obstacles, cellSize = 1, obstacleMargin = 0.2, groundHeight = 0 } = config;

  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxZ - bounds.minZ;
  const gridWidth = Math.ceil(worldWidth / cellSize);
  const gridHeight = Math.ceil(worldHeight / cellSize);
  const originX = bounds.minX;
  const originZ = bounds.minZ;

  // Build a set of blocked cells (cells containing obstacles)
  const blockedCells = new Set<string>();

  for (const obj of obstacles) {
    const radius = obj.radius + obstacleMargin;

    // Find all cells that intersect with this obstacle's bounding box
    const minCellX = Math.floor((obj.x - radius - originX) / cellSize);
    const maxCellX = Math.floor((obj.x + radius - originX) / cellSize);
    const minCellZ = Math.floor((obj.z - radius - originZ) / cellSize);
    const maxCellZ = Math.floor((obj.z + radius - originZ) / cellSize);

    for (let cz = minCellZ; cz <= maxCellZ; cz++) {
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        if (cx >= 0 && cx < gridWidth && cz >= 0 && cz < gridHeight) {
          blockedCells.add(`${cx},${cz}`);
        }
      }
    }
  }

  // Generate vertices and polygons
  const vertices: NavVertex[] = [];
  const polygons: NavPolygon[] = [];
  const grid: number[][] = [];

  // Initialize empty grid
  for (let i = 0; i < gridWidth * gridHeight; i++) {
    grid.push([]);
  }

  // Vertex map to avoid duplicates: "x,z" -> vertex index
  const vertexMap = new Map<string, number>();

  function getOrCreateVertex(x: number, y: number, z: number): number {
    const key = `${x.toFixed(4)},${z.toFixed(4)}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const index = vertices.length;
    vertices.push({ x, y, z });
    vertexMap.set(key, index);
    return index;
  }

  let polygonId = 0;

  for (let cz = 0; cz < gridHeight; cz++) {
    for (let cx = 0; cx < gridWidth; cx++) {
      const cellKey = `${cx},${cz}`;
      if (blockedCells.has(cellKey)) {
        continue;
      }

      // Create quad polygon for this cell
      const x0 = originX + cx * cellSize;
      const x1 = originX + (cx + 1) * cellSize;
      const z0 = originZ + cz * cellSize;
      const z1 = originZ + (cz + 1) * cellSize;

      // Vertices in counter-clockwise order (when viewed from above)
      const v0 = getOrCreateVertex(x0, groundHeight, z0);
      const v1 = getOrCreateVertex(x1, groundHeight, z0);
      const v2 = getOrCreateVertex(x1, groundHeight, z1);
      const v3 = getOrCreateVertex(x0, groundHeight, z1);

      // Compute neighbors (-1 if no neighbor or blocked)
      const neighbors: number[] = [];

      // Edge 0: v0 -> v1 (bottom edge, neighbor is cell at cz-1)
      neighbors.push(cz > 0 && !blockedCells.has(`${cx},${cz - 1}`) ? -2 : -1);
      // Edge 1: v1 -> v2 (right edge, neighbor is cell at cx+1)
      neighbors.push(cx < gridWidth - 1 && !blockedCells.has(`${cx + 1},${cz}`) ? -2 : -1);
      // Edge 2: v2 -> v3 (top edge, neighbor is cell at cz+1)
      neighbors.push(cz < gridHeight - 1 && !blockedCells.has(`${cx},${cz + 1}`) ? -2 : -1);
      // Edge 3: v3 -> v0 (left edge, neighbor is cell at cx-1)
      neighbors.push(cx > 0 && !blockedCells.has(`${cx - 1},${cz}`) ? -2 : -1);

      const polygon: NavPolygon = {
        id: polygonId,
        vertexIndices: [v0, v1, v2, v3],
        neighbors,
        flags: NAV_POLYGON_FLAGS.WALKABLE,
      };

      polygons.push(polygon);

      // Add to spatial grid
      const cellIndex = cz * gridWidth + cx;
      if (grid[cellIndex]) {
        grid[cellIndex].push(polygonId);
      } else {
        grid[cellIndex] = [polygonId];
      }

      polygonId++;
    }
  }

  // Second pass: fix neighbor IDs (replace -2 placeholder with actual polygon IDs)
  const cellToPolygonId = new Map<string, number>();
  for (const poly of polygons) {
    const p0 = poly.vertexIndices[0];
    if (!p0) continue;
    // Find which cell this polygon is in
    const v0 = vertices[p0];
    if (!v0) continue;
    const cx = Math.floor((v0.x - originX) / cellSize);
    const cz = Math.floor((v0.z - originZ) / cellSize);
    cellToPolygonId.set(`${cx},${cz}`, poly.id);
  }

  for (const poly of polygons) {
    const p0 = poly.vertexIndices[0];
    if (!p0) continue;
    const v0 = vertices[p0];
    if (!v0) continue;
    const cx = Math.floor((v0.x - originX) / cellSize);
    const cz = Math.floor((v0.z - originZ) / cellSize);

    // Fix neighbor references
    if (poly.neighbors[0] === -2) {
      poly.neighbors[0] = cellToPolygonId.get(`${cx},${cz - 1}`) ?? -1;
    }
    if (poly.neighbors[1] === -2) {
      poly.neighbors[1] = cellToPolygonId.get(`${cx + 1},${cz}`) ?? -1;
    }
    if (poly.neighbors[2] === -2) {
      poly.neighbors[2] = cellToPolygonId.get(`${cx},${cz + 1}`) ?? -1;
    }
    if (poly.neighbors[3] === -2) {
      poly.neighbors[3] = cellToPolygonId.get(`${cx - 1},${cz}`) ?? -1;
    }
  }

  return {
    version: 1,
    vertices,
    polygons,
    gridCellSize: cellSize,
    gridWidth,
    gridHeight,
    gridOriginX: originX,
    gridOriginZ: originZ,
    grid,
    bounds: {
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: groundHeight,
      maxY: groundHeight,
      minZ: bounds.minZ,
      maxZ: bounds.maxZ,
    },
  };
}

/**
 * Serializes a navmesh to JSON string.
 *
 * @param navmesh - the navmesh to serialize.
 * @returns JSON string representation.
 */
export function serializeNavmesh(navmesh: Navmesh): string {
  return JSON.stringify(navmesh, null, 2);
}
