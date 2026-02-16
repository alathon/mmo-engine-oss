export interface ZoneDefinition {
  /** Unique zone identifier. */
  id: string;
  /** Display name of the zone. */
  name: string;

  /** Scene data for the zone, to construct the BabylonJS scene. */
  // TODO: Later to be replaced by e.g., loading a .gltf file.
  sceneData: {
    glbFilePath: string;
    terrainObjects: ZoneTerrainObjectDefinition[];
    navmeshFilePath: string;
    navmeshGeneration?: NavmeshGenerationSettings;
  };
}

export interface NavmeshGenerationSettings {
  cellSize: number;
  cellHeight: number;
  walkableRadiusWorld: number;
  walkableHeightWorld: number;
  walkableClimbWorld: number;
  walkableSlopeAngleDegrees: number;
  minRegionArea: number;
  mergeRegionArea: number;
  maxSimplificationError: number;
  maxEdgeLength: number;
  maxVerticesPerPoly: number;
  detailSampleDistanceVoxels: number;
  detailSampleMaxErrorVoxels: number;
  /** Scale factor for navmesh input mesh subdivisions relative to visual ground. */
  navmeshSubdivisionsScale?: number;
  borderSize?: number;
}

export interface GroundDefinition {
  color: { r: number; g: number; b: number };
  gridColor?: { r: number; g: number; b: number };
  gridSize?: number;
  texture?: GroundTextureDefinition;
  splat?: GroundSplatDefinition;
  water?: GroundWaterDefinition;
  heightMap?: GroundHeightMapDefinition;
}

export interface GroundTextureDefinition {
  /**
   * Built-in texture id for quick prototyping.
   */
  builtIn?:
    | "proceduralGrass"
    | "proceduralDirt"
    | "proceduralRock"
    | "proceduralWater"
    | "proceduralSplatMix";
  /**
   * URL to a texture image, usually resolved by the client asset loader.
   */
  url?: string;
  /**
   * World units covered by one texture tile. Used to derive u/v scale.
   */
  tileSize?: number;
  /**
   * Explicit overrides for u/v scaling if needed.
   */
  uScale?: number;
  vScale?: number;
}

export interface GroundSplatDefinition {
  mixTexture: GroundTextureDefinition;
  diffuseTexture1: GroundTextureDefinition;
  diffuseTexture2: GroundTextureDefinition;
  diffuseTexture3: GroundTextureDefinition;
}

export interface GroundWaterDefinition {
  /** World X position of the water plane center. */
  x: number;
  /** World Z position of the water plane center. */
  z: number;
  /** Width of the water plane in world units. */
  width: number;
  /** Height (depth) of the water plane in world units. */
  height: number;
  /** Offset from sampled ground height at the center point. */
  yOffset?: number;
  /** Optional tint color. */
  color?: { r: number; g: number; b: number };
  /** Optional alpha (0-1) for transparency. */
  alpha?: number;
  /** Optional texture definition for the water surface. */
  texture?: GroundTextureDefinition;
}

export interface GroundHeightMapDefinition {
  /**
   * Built-in height map id for quick prototyping.
   */
  builtIn?: "proceduralHills";
  /**
   * URL to a height map image.
   */
  url?: string;
  /**
   * Resolution of generated height maps.
   */
  size?: number;
  /**
   * Contrast applied to procedural height map generation.
   */
  contrast?: number;
  /**
   * Roughness scale for procedural height maps. Lower values smooth terrain.
   */
  roughness?: number;
  /**
   * Number of high peaks added to the height map.
   */
  peakCount?: number;
  /**
   * Radius of each peak in normalized (0-1) height map space.
   */
  peakRadius?: number;
  /**
   * Strength of each peak before min/max scaling.
   */
  peakStrength?: number;
  /**
   * Subdivisions for the ground mesh.
   */
  subdivisions?: number;
  /**
   * Minimum height for the terrain.
   */
  minHeight?: number;
  /**
   * Maximum height for the terrain.
   */
  maxHeight?: number;
}

/**
 * Definition of a static terrain object within a zone.
 */
export interface ZoneTerrainObjectDefinition {
  /** Unique identifier for this object. */
  id: string;
  /** World X position. */
  x: number;
  /** World Z position. */
  z: number;
  /** World Y position (height). Defaults to 0. */
  y?: number;
  /** Shape of the object mesh. */
  shape: "box" | "sphere" | "cylinder";
  /** Size of the object. */
  size: number;
  /** Whether this object blocks movement. */
  collidable: boolean;
  /** Optional display label. */
  label?: string;
  /** RGB color (0-1 range). */
  color: { r: number; g: number; b: number };
}
