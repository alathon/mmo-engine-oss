export interface ZoneDefinition {
  /** Unique zone identifier. */
  id: string;
  /** Display name of the zone. */
  name: string;

  /** Scene data for the zone, to construct the BabylonJS scene. */
  // TODO: Later to be replaced by e.g., loading a .gltf file.
  sceneData: {
    /** Zone width in world units. */
    width: number;
    /** Zone height (depth) in world units. */
    height: number;
    ground: {
      color: { r: number; g: number; b: number; };
      gridColor?: { r: number; g: number; b: number; };
      gridSize?: number;
    };
    terrainObjects: ZoneTerrainObjectDefinition[];
    navmeshFilePath: string;
  }
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
  color: { r: number; g: number; b: number; };
}
