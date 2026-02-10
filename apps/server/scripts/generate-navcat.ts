import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import {
  generateSoloNavMesh,
  SoloNavMeshInput,
  type SoloNavMeshOptions,
} from "navcat/blocks";
import { ZoneDefinition, ZoneTerrainObjectDefinition } from "@mmo/shared";
import { getPositionsAndIndices } from "../src/navmesh/navcat-babylon";
import { AbstractEngine, Mesh, MeshBuilder, Scene } from "@babylonjs/core";

const buildNavcatOptions = (): SoloNavMeshOptions => {
  const cellSize = 0.2;
  const cellHeight = 0.2;
  const walkableRadiusWorld = 0.3;
  const walkableClimbWorld = 0.4;
  const walkableHeightWorld = 1.5;

  return {
    cellSize,
    cellHeight,
    walkableRadiusWorld,
    walkableRadiusVoxels: Math.ceil(walkableRadiusWorld / cellSize),
    walkableClimbWorld,
    walkableClimbVoxels: Math.ceil(walkableClimbWorld / cellHeight),
    walkableHeightWorld,
    walkableHeightVoxels: Math.ceil(walkableHeightWorld / cellHeight),
    walkableSlopeAngleDegrees: 45,
    borderSize: 4,
    minRegionArea: 12,
    mergeRegionArea: 20,
    maxSimplificationError: 1.3,
    maxEdgeLength: 12,
    maxVerticesPerPoly: 6,
    detailSampleDistance: 6,
    detailSampleMaxError: 1,
  };
};

const run = async (): Promise<void> => {
  const engine = new NullEngine();

  const startingPlainsJson = await readFile(
    path.resolve(
      process.cwd(),
      "../../packages/shared/assets/zones/startingPlains.zone.json",
    ),
    "utf8",
  );
  const startingPlainsDefinition = JSON.parse(
    startingPlainsJson,
  ) as ZoneDefinition;
  console.log("Zone definition", startingPlainsDefinition);
  const sceneBuilder = new BabylonSceneBuilder(
    startingPlainsDefinition,
    engine,
  );
  const collidableMeshes = sceneBuilder.scene.meshes.filter(
    (mesh) => mesh instanceof Mesh && mesh.checkCollisions,
  ) as Mesh[];

  console.log("Collidable meshes", collidableMeshes.length);
  const [positions, indices] = getPositionsAndIndices(collidableMeshes);
  console.log("Positions", positions.length);
  console.log("Indices", indices.length);
  const navMeshInput: SoloNavMeshInput = { positions, indices };

  const options = buildNavcatOptions();
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
  const outputDir = path.resolve(
    process.cwd(),
    "../../packages/shared/assets/zones",
  );
  const outputPath = path.resolve(outputDir, "startingPlains.navcat.json");
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(result.navMesh, undefined, 2),
    "utf8",
  );
  console.log(`Navcat navmesh written to ${outputPath}`);
  sceneBuilder.scene.dispose();
  engine.dispose();
};

try {
  await run();
} catch (error) {
  console.error("Failed to generate navcat navmesh", error);
  throw error;
}

export class BabylonSceneBuilder {
  // Scene
  public scene: Scene;

  /** The ground mesh for the zone. */
  public ground?: Mesh;

  /** The object meshes for the zone. */
  public objectMeshes = new Map<string, Mesh>();

  constructor(
    public readonly definition: ZoneDefinition,
    private readonly engine: AbstractEngine,
  ) {
    console.log("Creating BabylonSceneBuilder for zone:", this.definition.name);
    this.scene = new Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.createGround();
    this.createObjects();
  }

  private createGround(): void {
    this.ground = MeshBuilder.CreateGround(
      "ground",
      {
        width: this.definition.sceneData.width,
        height: this.definition.sceneData.height,
      },
      this.scene,
    );
    this.ground.checkCollisions = true;
  }

  private createObjects(): void {
    for (const objDef of this.definition.sceneData.terrainObjects) {
      if (objDef.collidable) {
        const mesh = this.createObjectMesh(objDef);
        this.objectMeshes.set(objDef.id, mesh);
      }
    }
  }

  private createObjectMesh(objDef: ZoneTerrainObjectDefinition): Mesh {
    let mesh: Mesh;
    const y = (objDef.y ?? 0) + objDef.size / 2;

    switch (objDef.shape) {
      case "box": {
        mesh = MeshBuilder.CreateBox(
          objDef.id,
          { size: objDef.size },
          this.scene,
        );

        break;
      }
      case "sphere": {
        mesh = MeshBuilder.CreateSphere(
          objDef.id,
          { diameter: objDef.size },
          this.scene,
        );
        break;
      }
      case "cylinder": {
        mesh = MeshBuilder.CreateCylinder(
          objDef.id,
          { diameter: objDef.size, height: objDef.size },
          this.scene,
        );
        break;
      }
      default: {
        mesh = MeshBuilder.CreateBox(
          objDef.id,
          { size: objDef.size },
          this.scene,
        );
      }
    }

    mesh.position.set(objDef.x, y, objDef.z);
    mesh.checkCollisions = true;

    return mesh;
  }
}
