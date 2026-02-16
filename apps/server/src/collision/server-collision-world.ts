import "@babylonjs/loaders/glTF/index.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import { postLoadProcessScene } from "@mmo/shared";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getServerEngine, initializeServerEngine } from "../navmesh/babylon-server-engine";

const COLLISION_DEBUG_ENABLED = (() => {
  const raw = process.env.MMO_SERVER_COLLISION_DEBUG?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
})();

/**
 * Holds a zone's server-side Babylon scene and collision mesh references.
 */
export class ServerCollisionWorld {
  constructor(
    public readonly zoneId: string,
    public readonly scene: Scene,
    public readonly sourceMeshes: readonly Mesh[],
    public readonly collisionMeshes: readonly Mesh[],
  ) {}

  dispose(): void {
    if (this.scene.isDisposed) {
      return;
    }
    this.scene.dispose();
  }
}

/**
 * Loads a zone GLB into a server-side Babylon scene and resolves collision meshes.
 *
 * @param zoneId - zone identifier for diagnostics.
 * @param glbPath - absolute path to zone GLB file.
 * @returns loaded collision-world instance.
 */
export const loadServerCollisionWorld = async (
  zoneId: string,
  glbPath: string,
): Promise<ServerCollisionWorld> => {
  initializeServerEngine();
  const engine = getServerEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;

  try {
    const glbBytes = await readFile(glbPath);
    const container = await LoadAssetContainerAsync(new Uint8Array(glbBytes), scene, {
      pluginExtension: ".glb",
      name: path.basename(glbPath),
    });
    const { sourceMeshes, collisionTaggedMeshes } = postLoadProcessScene(scene, {
      meshes: container.meshes,
      transformNodes: container.transformNodes,
    });

    // Keep server ray queries behavior aligned with client zone loading.
    for (const mesh of sourceMeshes) {
      mesh.isPickable = true;
    }

    if (sourceMeshes.length === 0) {
      throw new Error(`Zone ${zoneId} GLB has no mesh geometry: ${glbPath}`);
    }

    if (collisionTaggedMeshes.length === 0) {
      throw new Error(
        `Zone ${zoneId} has no collision meshes in ${glbPath}. ` +
          "Set mesh metadata collisionRole='collision' or name meshes with 'col_'.",
      );
    }

    container.addAllToScene();
    for (const mesh of sourceMeshes) {
      mesh.computeWorldMatrix(true);
    }

    if (COLLISION_DEBUG_ENABLED) {
      const collidableMeshes = sourceMeshes.filter((mesh) => mesh.checkCollisions);
      const enabledCollidableMeshes = collidableMeshes.filter((mesh) => mesh.isEnabled());
      const pickableMeshes = sourceMeshes.filter((mesh) => mesh.isPickable);
      console.log("[server-collision] Zone collision world loaded", {
        zoneId,
        sourceMeshCount: sourceMeshes.length,
        collisionTaggedCount: collisionTaggedMeshes.length,
        collidableCount: collidableMeshes.length,
        enabledCollidableCount: enabledCollidableMeshes.length,
        pickableCount: pickableMeshes.length,
      });
      console.log(
        "[server-collision] Collidable mesh names",
        collidableMeshes.map((mesh) => mesh.name),
      );
    }

    return new ServerCollisionWorld(zoneId, scene, sourceMeshes, collisionTaggedMeshes);
  } catch (error) {
    scene.dispose();
    throw error;
  }
};
