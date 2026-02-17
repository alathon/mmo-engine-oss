import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { NavMesh } from "navcat";
import { generateSoloNavMesh, type SoloNavMeshOptions } from "navcat/blocks";
import type { NavmeshGenerationSettings } from "@mmo/shared-sim";
import { getPositionsAndIndices } from "./navcat-babylon";

export const DEFAULT_NAVMESH_GENERATION_SETTINGS: NavmeshGenerationSettings = {
  cellSize: 0.15,
  cellHeight: 0.25,
  walkableRadiusWorld: 0.3,
  walkableHeightWorld: 2,
  walkableClimbWorld: 0.5,
  walkableSlopeAngleDegrees: 45,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxSimplificationError: 1.3,
  maxEdgeLength: 12,
  maxVerticesPerPoly: 5,
  detailSampleDistanceVoxels: 6,
  detailSampleMaxErrorVoxels: 1,
  navmeshSubdivisionsScale: 0.25,
  borderSize: 0,
};

export interface NavmeshGenerationSummary {
  vertices: number;
  polys: number;
  durationMs: number;
}

const buildNavcatOptions = (settings: NavmeshGenerationSettings): SoloNavMeshOptions => {
  const {
    cellSize,
    cellHeight,
    walkableRadiusWorld,
    walkableSlopeAngleDegrees,
    walkableClimbWorld,
    walkableHeightWorld,
    detailSampleDistanceVoxels,
    detailSampleMaxErrorVoxels,
    minRegionArea,
    mergeRegionArea,
    maxSimplificationError,
    maxEdgeLength,
    maxVerticesPerPoly,
    borderSize = 0,
  } = settings;

  const detailSampleDistance =
    detailSampleDistanceVoxels < 0.9 ? 0 : cellSize * detailSampleDistanceVoxels;
  const detailSampleMaxError = cellHeight * detailSampleMaxErrorVoxels;

  return {
    cellSize,
    cellHeight,
    walkableRadiusWorld,
    walkableRadiusVoxels: Math.ceil(walkableRadiusWorld / cellSize),
    walkableClimbWorld,
    walkableClimbVoxels: Math.ceil(walkableClimbWorld / cellHeight),
    walkableHeightWorld,
    walkableHeightVoxels: Math.ceil(walkableHeightWorld / cellHeight),
    walkableSlopeAngleDegrees,
    borderSize,
    minRegionArea,
    mergeRegionArea,
    maxSimplificationError,
    maxEdgeLength,
    maxVerticesPerPoly,
    detailSampleDistance,
    detailSampleMaxError,
  };
};

const summarizeNavmesh = (navMesh: NavMesh): { vertices: number; polys: number } => {
  let vertices = 0;
  let polys = 0;
  for (const tile of Object.values(navMesh.tiles)) {
    if (!tile) {
      continue;
    }
    vertices += tile.vertices.length / 3;
    polys += tile.polys.length;
  }
  return { vertices, polys };
};

export const generateNavmeshFromMeshes = (
  sceneMeshes: Mesh[],
  settings: NavmeshGenerationSettings,
): { navMesh: NavMesh; summary: NavmeshGenerationSummary } => {
  const sourceMeshes = sceneMeshes.filter((mesh) => mesh.getTotalVertices() > 0);
  if (sourceMeshes.length === 0) {
    throw new Error("No mesh geometry found in GLB scene.");
  }

  const [positions, indices] = getPositionsAndIndices(sourceMeshes);
  if (positions.length === 0 || indices.length === 0) {
    throw new Error("GLB scene produced empty navmesh input.");
  }

  const options = buildNavcatOptions(settings);

  const input = {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };

  const startTime = performance.now();
  const result = generateSoloNavMesh(input, options);
  const durationMs = performance.now() - startTime;

  const { vertices, polys } = summarizeNavmesh(result.navMesh);

  return {
    navMesh: result.navMesh,
    summary: {
      vertices,
      polys,
      durationMs,
    },
  };
};
