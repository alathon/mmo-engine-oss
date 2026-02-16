import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MobState } from "@mmo/shared";
import { MobEntity } from "../entities/mob-entity";
import { applyMovementSmoothing } from "./smoothing";
import type { UiLayer } from "../ui/ui-layer";

const createMob = (scene: Scene, uiLayer: UiLayer) => {
  const sync = new MobState();
  sync.id = "mob_test";
  sync.name = "Test Mob";
  sync.x = 0;
  sync.y = 0;
  sync.z = 0;
  sync.facingYaw = 0;
  sync.currentHp = 100;
  sync.maxHp = 100;
  const mob = new MobEntity("mob_test", scene, sync, uiLayer);

  return mob;
};

const uiLayer: UiLayer = {
  addControl: () => uiLayer,
  removeControl: () => uiLayer,
};

describe("applyMovementSmoothing", () => {
  let scene: Scene;
  let engine: NullEngine;

  beforeAll(() => {
    engine = new NullEngine();
  });

  afterAll(() => {
    engine.dispose();
  });

  beforeEach(() => {
    scene = new Scene(engine);
  });

  afterEach(() => {
    scene.dispose();
  });

  it("interpolates position between previous target and current target", () => {
    const mob = createMob(scene, uiLayer);
    mob.setTargetPosition(10, 0, 0);

    applyMovementSmoothing(mob, 16, 0.5);

    expect(mob.position.x).toBeCloseTo(5);
    expect(mob.position.y).toBeCloseTo(0);
    expect(mob.position.z).toBeCloseTo(0);
  });

  it("snaps rotation toward movement yaw", () => {
    const mob = createMob(scene, uiLayer);
    mob.setTargetPosition(1, 0, 0);

    applyMovementSmoothing(mob, 1000);

    expect(mob.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it("leaves rotation unchanged when delta time is zero", () => {
    const mob = createMob(scene, uiLayer);
    mob.rotation.y = 1;
    mob.setTargetPosition(0, 0, 1);

    applyMovementSmoothing(mob, 0);

    expect(mob.rotation.y).toBeCloseTo(1);
  });

  it("interpolates vertical position with fixed tick alpha", () => {
    const mob = createMob(scene, uiLayer);
    mob.setTargetPosition(0, 8, 0);

    applyMovementSmoothing(mob, 16, 0.25);

    expect(mob.position.y).toBeCloseTo(2);
  });

  it("falls back to target position when no previous target position is provided", () => {
    const entity = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { y: 0 },
      getTargetPosition: () => ({ x: 0, y: 10, z: 0 }),
      getMovementYaw: () => 0,
    };

    applyMovementSmoothing(entity, 16, 0.4);

    expect(entity.position.y).toBeCloseTo(10);
  });
});
