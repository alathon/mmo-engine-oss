import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { ServerCollisionWorld } from "../src/collision/server-collision-world";

export const createTestCollisionWorld = (zoneId: string): ServerCollisionWorld => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.collisionsEnabled = true;

  scene.onDisposeObservable.add(() => {
    engine.dispose();
  });

  const ground = MeshBuilder.CreateBox(
    `${zoneId}_test_ground`,
    {
      width: 100,
      height: 2,
      depth: 100,
    },
    scene,
  );
  ground.position.set(0, -1, 0);
  ground.checkCollisions = true;
  ground.isPickable = true;
  ground.computeWorldMatrix(true);

  return new ServerCollisionWorld(zoneId, scene, [ground], [ground]);
};
