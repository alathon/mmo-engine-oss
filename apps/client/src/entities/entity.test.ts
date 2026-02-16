import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Entity } from "./entity";

describe("Entity collision flags", () => {
  it("creates a collision mesh that can skip Babylon collision checks", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const modelMesh = MeshBuilder.CreateBox("model", { size: 1 }, scene);

    const entity = new Entity("test", scene, {
      id: "test",
      x: 0,
      z: 0,
      color: new Color3(1, 1, 1),
      modelMesh,
      hasCollision: true,
      collisionChecksEnabled: false,
    });

    expect(entity.getCollisionMesh()).toBeDefined();
    expect(entity.getCollisionMesh()?.checkCollisions).toBe(false);

    scene.dispose();
    engine.dispose();
  });

  it("defaults collisionChecksEnabled to true when hasCollision is true", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const modelMesh = MeshBuilder.CreateBox("model_default", { size: 1 }, scene);

    const entity = new Entity("test_default", scene, {
      id: "test_default",
      x: 0,
      z: 0,
      color: new Color3(1, 1, 1),
      modelMesh,
      hasCollision: true,
    });

    expect(entity.getCollisionMesh()).toBeDefined();
    expect(entity.getCollisionMesh()?.checkCollisions).toBe(true);

    scene.dispose();
    engine.dispose();
  });
});
