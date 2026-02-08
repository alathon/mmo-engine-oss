/**
 * A vertex in 3D space used by navmesh polygons.
 */
export interface NavVertex {
  x: number;
  y: number;
  z: number;
}

/**
 * Polygon flags for terrain type classification.
 */
export const NAV_POLYGON_FLAGS = {
  WALKABLE: 1 << 0,
  WATER: 1 << 1,
  STAIRS: 1 << 2,
  SLOPE: 1 << 3,
} as const;

/**
 * A single convex polygon in the navmesh.
 * Vertices are ordered counter-clockwise when viewed from above (+Y).
 */
export interface NavPolygon {
  /** Unique polygon ID. */
  id: number;
  /** Indices into the navmesh vertices array. */
  vertexIndices: number[];
  /** Neighbor polygon IDs for each edge, or -1 if boundary edge. */
  neighbors: number[];
  /** Flags for polygon properties (walkable, water, stairs, etc.). */
  flags: number;
}

/**
 * Axis-aligned bounding box for spatial queries.
 */
export interface NavBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Complete navmesh data structure.
 * Contains geometry and spatial index for efficient queries.
 */
export interface Navmesh {
  /** Version number for compatibility checking. */
  version: number;
  /** All vertices in the mesh. */
  vertices: NavVertex[];
  /** All polygons. */
  polygons: NavPolygon[];
  /** Spatial grid cell size in world units. */
  gridCellSize: number;
  /** Number of grid cells in X direction. */
  gridWidth: number;
  /** Number of grid cells in Z direction. */
  gridHeight: number;
  /** Grid origin X (minimum X coordinate). */
  gridOriginX: number;
  /** Grid origin Z (minimum Z coordinate). */
  gridOriginZ: number;
  /** 2D array mapping grid cells to polygon IDs. grid[cellIndex] = [polyId, ...] */
  grid: number[][];
  /** World bounds of the navmesh. */
  bounds: NavBounds;
}

/**
 * Result of a movement validation query.
 */
export interface NavMovementResult {
  /** Final X position after movement. */
  x: number;
  /** Final Y (height) position after movement. */
  y: number;
  /** Final Z position after movement. */
  z: number;
  /** True if movement was blocked or clamped. */
  collided: boolean;
  /** Ratio of actual movement to requested (0-1). */
  movementRatio: number;
  /** Optional node reference for navmesh movement. */
  nodeRef?: number;
}

/**
 * Result of a raycast query against the navmesh boundary.
 */
export interface NavRaycastResult {
  /** Hit point X coordinate. */
  hitX: number;
  /** Hit point Y coordinate. */
  hitY: number;
  /** Hit point Z coordinate. */
  hitZ: number;
  /** Distance from ray origin to hit point. */
  distance: number;
  /** ID of the polygon containing the hit point. */
  polygonId: number;
}
