import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import {
  hasLineOfSight,
  hasLineOfSightReentrantSafe,
  type LineOfSightOptions,
} from "@mmo/shared-sim";

describe("hasLineOfSight", () => {
  let engine: NullEngine;
  let scene: Scene;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    scene.useRightHandedSystem = true;

    const ground = MeshBuilder.CreateBox(
      "ground",
      {
        width: 50,
        depth: 50,
        height: 1,
      },
      scene,
    );
    ground.position.set(0, -0.5, 0);
    ground.checkCollisions = true;
    ground.isPickable = true;
    ground.computeWorldMatrix(true);
  });

  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  it("returns true when no blocker intersects the ray", () => {
    const clear = hasLineOfSight(scene, { x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });

    expect(clear).toBe(true);
  });

  it("returns false when a blocking mesh intersects the ray", () => {
    const wall = MeshBuilder.CreateBox(
      "wall",
      {
        width: 1,
        depth: 6,
        height: 3,
      },
      scene,
    );
    wall.position.set(0, 1.5, 0);
    wall.checkCollisions = true;
    wall.isPickable = true;
    wall.computeWorldMatrix(true);

    const clear = hasLineOfSight(scene, { x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });

    expect(clear).toBe(false);
  });

  it("supports filtering meshes with a custom predicate", () => {
    const wall = MeshBuilder.CreateBox(
      "ignored-wall",
      {
        width: 1,
        depth: 6,
        height: 3,
      },
      scene,
    );
    wall.position.set(0, 1.5, 0);
    wall.checkCollisions = true;
    wall.isPickable = true;
    wall.computeWorldMatrix(true);

    const options: LineOfSightOptions = {
      meshPredicate: (mesh) => mesh.checkCollisions && mesh.isEnabled() && mesh !== wall,
    };

    const clear = hasLineOfSight(scene, { x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, options);

    expect(clear).toBe(true);
  });

  it("supports re-entrant LOS calls when using hasLineOfSightReentrantSafe", () => {
    const outerWall = MeshBuilder.CreateBox(
      "outer-wall",
      {
        width: 1,
        depth: 6,
        height: 3,
      },
      scene,
    );
    outerWall.position.set(0, 1.5, 0);
    outerWall.checkCollisions = true;
    outerWall.isPickable = true;
    outerWall.computeWorldMatrix(true);

    const innerWall = MeshBuilder.CreateBox(
      "inner-wall",
      {
        width: 1,
        depth: 6,
        height: 3,
      },
      scene,
    );
    innerWall.position.set(0, 1.5, 10);
    innerWall.checkCollisions = true;
    innerWall.isPickable = true;
    innerWall.computeWorldMatrix(true);

    let nestedChecks = 0;
    const options: LineOfSightOptions = {
      meshPredicate: (mesh) => {
        if (mesh === outerWall) {
          nestedChecks += 1;
          const nestedClear = hasLineOfSight(scene, { x: -5, y: 0, z: 10 }, { x: 5, y: 0, z: 10 });
          expect(nestedClear).toBe(false);
        }

        return mesh.checkCollisions && mesh.isEnabled();
      },
    };

    const clear = hasLineOfSightReentrantSafe(
      scene,
      { x: -5, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      options,
    );

    expect(nestedChecks).toBeGreaterThan(0);
    expect(clear).toBe(false);
  });
});
