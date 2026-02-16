import "@babylonjs/loaders";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Scene } from "@babylonjs/core/scene";
import { postLoadProcessScene, ZoneDefinition } from "@mmo/shared";
import testZoneGlbUrl from "@mmo/assets/zones/startingPlains.glb?url";

/** Hot damn the below is confusing. Sad
 Space                          | Up    | Forward | Right |
 |---|---|---|---|---|---|---|---|---|---|---|---|---|---|
 | Blender (native scene axes)  | `+Z`  | `+Y`    | `+X` |
 | Blender (`+Y Up` export)     | `+Y`  | `+Z`    | `-X` |
 | glTF standard                | `+Y`  | `+Z`    | `-X` |
 | BabylonJS (RHS true)         | `+Y`  | `-Z`    | `+X` |
 **/
const GLB_URLS_BY_FILE_NAME: Record<string, string> = {
  "startingPlains.glb": testZoneGlbUrl,
};

const resolveGlbSource = (rawPath: string): string => {
  // HTTP/data/blob URLs can be loaded directly.
  if (/^(https?:|data:|blob:)/.test(rawPath)) {
    return rawPath;
  }

  const fileName = rawPath.split("/").at(-1);
  if (!fileName) {
    return rawPath;
  }

  return GLB_URLS_BY_FILE_NAME[fileName] ?? rawPath;
};

export const load = async (scene: Scene, zoneDefinition: ZoneDefinition) => {
  const source = resolveGlbSource(zoneDefinition.sceneData.glbFilePath);
  console.log(`Loading GLB file: ${source}`);
  const container = await LoadAssetContainerAsync(source, scene);
  const { sourceMeshes: sourceNodes, collisionTaggedMeshes } = postLoadProcessScene(scene, {
    meshes: container.meshes,
    transformNodes: container.transformNodes,
  });

  for (const mesh of sourceNodes) {
    mesh.isPickable = true;
  }

  if (collisionTaggedMeshes.length === 0) {
    console.warn(
      "No collision-tagged GLB meshes found. Falling back to checkCollisions=true on all meshes.",
    );
  }

  container.addAllToScene();
  return sourceNodes;
};
