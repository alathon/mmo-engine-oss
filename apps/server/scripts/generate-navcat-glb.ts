import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import "@babylonjs/loaders/glTF";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Axis, Mesh, Scene, Space } from "@babylonjs/core";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { generateSoloNavMesh, type SoloNavMeshInput, type SoloNavMeshOptions } from "navcat/blocks";
import { NavmeshGenerationSettings } from "@mmo/shared";
import { getPositionsAndIndices } from "../src/navmesh/navcat-babylon";

interface GlbZoneDefinition {
  id: string;
  name: string;
  sceneData: {
    glbFilePath: string;
    navmeshFilePath?: string;
    navmeshGeneration?: NavmeshGenerationSettings;
  };
}

/**
 * Navmesh generation parameter summary (navcat quick-start heuristics).
 *
 * | Parameter | Meaning | Rule of thumb |
 * | --- | --- | --- |
 * | cellSize | Horizontal voxel size (XZ). Smaller = more detail, slower. | ~ walkableRadiusWorld / 3 |
 * | cellHeight | Vertical voxel size (Y). Height resolution. | ~ walkableClimbWorld / 2 |
 * | walkableRadiusWorld | Agent radius (clearance from walls). | 0.2 to 0.5 m |
 * | walkableHeightWorld | Agent height (min ceiling clearance). | 1.6 to 2.0 m |
 * | walkableSlopeAngleDegrees | Max slope angle walkable (filters triangles early). | 35 to 50 deg |
 * | walkableClimbWorld | Max step height (filters at heightfield stage). | 0.3 to 0.5 m |
 * | minRegionArea | Smallest isolated region kept (voxels). | 4 to 16 |
 * | mergeRegionArea | Regions smaller than this merge (voxels). | 8 to 32 |
 * | maxSimplificationError | Polygon edge simplification tolerance. | 1 to 2 |
 * | maxEdgeLength | Max edge length before splitting. | 8 to 24 |
 * | maxVerticesPerPoly | Max vertices per polygon. | 3 to 6 |
 * | detailSampleDistanceVoxels | Detail sampling distance (in voxels). | cellSize * 4 to 8 |
 * | detailSampleMaxErrorVoxels | Allowed height error (in voxels). | cellHeight * 1 to 2 |
 * | borderSize | Tile border size (voxels). Use 0 for solo navmesh. | 0 |
 */
const DEFAULT_NAVMESH_GENERATION: NavmeshGenerationSettings = {
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

interface NavmeshCliArgs {
  zoneId: string;
  list: boolean;
  showHelp: boolean;
}

const GLB_ZONE_EXTENSIONS = [".glb.zone.json"];

const printUsage = (): void => {
  console.log("Usage: pnpm --filter @mmo/server generate:navcat:glb -- --zoneId <zoneId>");
  console.log("  --zoneId, --zone, -z  GLB zone id (defaults to testGlb)");
  console.log("  --list               List available GLB zone ids");
};

const parseArgs = (): NavmeshCliArgs => {
  const argv = process.argv.slice(2);
  let zoneId = "testGlb";
  let list = false;
  let showHelp = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }
    if (arg === "--list") {
      list = true;
      continue;
    }
    if (arg === "--zoneId" || arg === "--zone" || arg === "-z") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`Expected zone id after ${arg}.`);
      }
      zoneId = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--zoneId=")) {
      zoneId = arg.slice("--zoneId=".length);
      continue;
    }
    if (arg.startsWith("--zone=")) {
      zoneId = arg.slice("--zone=".length);
    }
  }

  return { zoneId, list, showHelp };
};

const buildNavcatOptions = (
  settings: NavmeshGenerationSettings = DEFAULT_NAVMESH_GENERATION,
): SoloNavMeshOptions => {
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

const loadZoneDefinition = async (zonePath: string): Promise<GlbZoneDefinition> => {
  if (zonePath.endsWith(".json")) {
    const json = await readFile(zonePath, "utf8");
    return JSON.parse(json) as GlbZoneDefinition;
  }

  const zoneModule = await import(pathToFileURL(zonePath).href);
  return (zoneModule.default ?? zoneModule.zoneDefinition ?? zoneModule) as GlbZoneDefinition;
};

const findGlbZonePath = async (zoneAssetsDir: string, zoneId: string): Promise<string> => {
  for (const extension of GLB_ZONE_EXTENSIONS) {
    const candidate = path.resolve(zoneAssetsDir, `${zoneId}${extension}`);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try next extension.
    }
  }

  throw new Error(
    `Unable to find GLB zone definition for ${zoneId}. Expected one of: ${GLB_ZONE_EXTENSIONS.map((extension) => `${zoneId}${extension}`).join(", ")}.`,
  );
};

const listZones = async (zoneAssetsDir: string): Promise<void> => {
  const entries = await readdir(zoneAssetsDir, { withFileTypes: true });
  const zoneFiles = entries
    .filter(
      (entry) =>
        entry.isFile() && GLB_ZONE_EXTENSIONS.some((suffix) => entry.name.endsWith(suffix)),
    )
    .map((entry) => entry.name)
    .toSorted();

  if (zoneFiles.length === 0) {
    console.log(`No GLB zone definitions found in ${zoneAssetsDir}`);
    return;
  }

  const zones: { id: string; name: string; file: string }[] = [];
  for (const file of zoneFiles) {
    const zonePath = path.resolve(zoneAssetsDir, file);
    const definition = await loadZoneDefinition(zonePath);
    zones.push({ id: definition.id, name: definition.name, file });
  }

  zones.sort((a, b) => a.id.localeCompare(b.id));
  console.log("Available GLB zones:");
  for (const zone of zones) {
    console.log(`- ${zone.id} (${zone.name}) [${zone.file}]`);
  }
};

const run = async (): Promise<void> => {
  const zoneAssetsDir = path.resolve(process.cwd(), "../../packages/assets/zones");
  const { zoneId, list, showHelp } = parseArgs();
  if (showHelp) {
    printUsage();
    return;
  }
  if (list) {
    await listZones(zoneAssetsDir);
    return;
  }

  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;

  try {
    const zonePath = await findGlbZonePath(zoneAssetsDir, zoneId);
    const zoneDefinition = await loadZoneDefinition(zonePath);

    if (!zoneDefinition.sceneData.glbFilePath) {
      throw new Error(
        `Zone ${zoneId} must define sceneData.glbFilePath for GLB navmesh generation.`,
      );
    }

    const glbPath = path.resolve(zoneAssetsDir, zoneDefinition.sceneData.glbFilePath);
    await access(glbPath);
    const glbBytes = await readFile(glbPath);

    console.log("Zone definition", zoneDefinition);
    console.log("Loading GLB into Babylon scene", glbPath);
    const container = await LoadAssetContainerAsync(new Uint8Array(glbBytes), scene, {
      pluginExtension: ".glb",
      name: path.basename(glbPath),
    });
    const rootNode = [...container.transformNodes, ...container.meshes].find(
      (node) => node.name === "__root__",
    );
    rootNode?.rotate(Axis.Y, Math.PI, Space.LOCAL);
    container.addAllToScene();

    const sourceMeshes = container.meshes.filter(
      (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0,
    );

    if (sourceMeshes.length === 0) {
      throw new Error(`No mesh geometry found in GLB scene: ${glbPath}`);
    }

    console.log("Scene meshes with geometry", sourceMeshes.length);

    const [positions, indices] = getPositionsAndIndices(sourceMeshes);

    if (positions.length === 0 || indices.length === 0) {
      throw new Error(`GLB scene produced empty navmesh input: ${glbPath}`);
    }

    const options = buildNavcatOptions(zoneDefinition.sceneData.navmeshGeneration);
    const navMeshInput: SoloNavMeshInput = {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
    };

    console.log("Positions", navMeshInput.positions.length);
    console.log("Indices", navMeshInput.indices.length);
    console.log("Options", options);

    const result = generateSoloNavMesh(navMeshInput, options);
    console.log("Result tiles:");
    for (const [tileId, tile] of Object.entries(result.navMesh.tiles)) {
      console.log(`Tile ${tileId}:`, {
        vertices: tile.vertices.length / 3,
        polys: tile.polys.length,
        bounds: tile.bounds,
        detailTriangles: tile.detailTriangles?.length ?? 0,
      });
    }

    const navmeshFilePath = zoneDefinition.sceneData.navmeshFilePath ?? `${zoneId}.navcat.json`;
    const outputPath = path.resolve(zoneAssetsDir, navmeshFilePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(result.navMesh, undefined, 2), "utf8");
    console.log(`Navcat navmesh written to ${outputPath}`);
  } finally {
    scene.dispose();
    engine.dispose();
  }
};

try {
  await run();
} catch (error) {
  console.error("Failed to generate navcat navmesh from GLB", error);
  throw error;
}
