import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { NavcatQuery } from "@mmo/shared";
import type { PendingMove } from "./movementTypes";
import { LocalPlayerMovementHandler } from "./localPlayerMovementHandler";
import type { InputManager } from "../input/inputManager";
import type { PlayerEntity } from "../entities/playerEntity";
import type { ZoneConnectionManager } from "../network/zoneConnectionManager";

const createMove = (overrides: Partial<PendingMove>): PendingMove => ({
  seq: 0,
  tick: 0,
  dirX: 0,
  dirZ: 0,
  isSprinting: false,
  predictedX: 0,
  predictedY: 0,
  predictedZ: 0,
  ...overrides,
});

class TestMovementHandler extends LocalPlayerMovementHandler {
  public replayPendingMovesForTest(startPosition: Vector3) {
    return this.replayPendingMoves(startPosition);
  }

  public predictMovementStepForTest(params: {
    currentPosition: Vector3;
    direction: Vector3;
    deltaTimeMs: number;
    speed: number;
    navmesh?: NavcatQuery;
    navmeshNodeRef?: number;
  }) {
    return this.predictMovementStep(params);
  }

  public resolveMovementDirectionForTest(inputDir: Vector3): Vector3 {
    return this.resolveMovementDirection(inputDir);
  }

  override getMoveSpeed(_isSprinting: boolean): number {
    return 1;
  }
}

const createHandler = () => {
  const player = {} as PlayerEntity;
  const input = {} as InputManager;
  const zoneNetwork = {
    sendMessage: () => {},
  } as unknown as ZoneConnectionManager;
  return new TestMovementHandler(player, input, zoneNetwork);
};

describe("LocalPlayerMovementHandler", () => {
  it("replays moves in order", () => {
    const handler = createHandler();
    handler.queuePendingMove(createMove({ seq: 1, dirX: 1, dirZ: 0 }));
    handler.queuePendingMove(createMove({ seq: 2, dirX: 0, dirZ: 1 }));

    const result = handler.replayPendingMovesForTest(new Vector3(0, 0, 0));

    expect(result.position.x).toBeCloseTo(0.05);
    expect(result.position.z).toBeCloseTo(0.05);
  });

  it("propagates navmesh node refs and debug callbacks", () => {
    const navmeshCalls: number[] = [];
    const navmesh = {
      validateMovement: (
        currentX: number,
        currentZ: number,
        deltaX: number,
        deltaZ: number,
        startNodeRef?: number,
      ) => {
        navmeshCalls.push(startNodeRef ?? -1);
        return {
          x: currentX + deltaX,
          y: 0,
          z: currentZ + deltaZ,
          collided: false,
          movementRatio: 1,
          nodeRef: (startNodeRef ?? 0) + 1,
        };
      },
      findNearestPoint: () => null,
    } as unknown as NavcatQuery;

    const handler = createHandler();
    handler.setNavmesh(navmesh);
    handler.queuePendingMove(
      createMove({ seq: 1, dirX: 1, navmeshNodeRef: 10 }),
    );
    handler.queuePendingMove(createMove({ seq: 2, dirX: 1 }));

    const result = handler.replayPendingMovesForTest(new Vector3(0, 0, 0));

    expect(navmeshCalls).toEqual([10, 11]);
    expect(result.navmeshNodeRef).toBe(12);
    expect(result.lastDebug).toBeDefined();
  });

  it("predicts movement for idle inputs", () => {
    const handler = createHandler();
    const position = new Vector3(1, 2, 3);
    const direction = new Vector3(0, 0, 0);

    const result = handler.predictMovementStepForTest({
      currentPosition: position,
      direction,
      deltaTimeMs: 100,
      speed: 5,
    });

    expect(result.position.equals(position)).toBe(true);
    expect(result.position).not.toBe(position);
    expect(result.debug).toBeUndefined();
  });

  it("predicts movement without navmesh", () => {
    const handler = createHandler();
    const position = new Vector3(0, 0, 0);
    const direction = new Vector3(1, 0, 0);

    const result = handler.predictMovementStepForTest({
      currentPosition: position,
      direction,
      deltaTimeMs: 500,
      speed: 2,
    });

    expect(result.position.x).toBeCloseTo(1);
    expect(result.position.y).toBeCloseTo(0);
    expect(result.position.z).toBeCloseTo(0);
  });

  it("predicts movement with navmesh debug", () => {
    const calls: {
      currentX: number;
      currentZ: number;
      deltaX: number;
      deltaZ: number;
      startNodeRef?: number;
    }[] = [];
    const navmesh = {
      validateMovement: (
        currentX: number,
        currentZ: number,
        deltaX: number,
        deltaZ: number,
        startNodeRef?: number,
      ) => {
        calls.push({ currentX, currentZ, deltaX, deltaZ, startNodeRef });
        return {
          x: currentX + deltaX * 0.5,
          y: 0,
          z: currentZ + deltaZ * 0.5,
          collided: true,
          movementRatio: 0.5,
          nodeRef: 7,
        };
      },
      findNearestPoint: () => null,
    } as unknown as NavcatQuery;

    const handler = createHandler();
    const position = new Vector3(2, 0, 2);
    const direction = new Vector3(1, 0, 0);

    const result = handler.predictMovementStepForTest({
      currentPosition: position,
      direction,
      deltaTimeMs: 1000,
      speed: 2,
      navmesh,
      navmeshNodeRef: 3,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.deltaX).toBeCloseTo(2);
    expect(calls[0]?.deltaZ).toBeCloseTo(0);
    expect(calls[0]?.startNodeRef).toBe(3);

    expect(result.position.x).toBeCloseTo(3);
    expect(result.position.z).toBeCloseTo(2);
    expect(result.navmeshNodeRef).toBe(7);
    expect(result.debug?.requested).toBeCloseTo(2);
    expect(result.debug?.actual).toBeCloseTo(1);
    expect(result.debug?.ratio).toBeCloseTo(0.5);
    expect(result.debug?.collided).toBe(true);
  });

  it("maps input relative to camera forward", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const camera = new ArcRotateCamera(
      "cam",
      -Math.PI / 2,
      Math.PI / 2,
      10,
      Vector3.Zero(),
      scene,
    );

    const handler = createHandler();
    handler.setCamera(camera);

    const forward = handler.resolveMovementDirectionForTest(
      new Vector3(0, 0, 1),
    );
    expect(forward.x).toBeCloseTo(0);
    expect(forward.z).toBeCloseTo(1);

    const left = handler.resolveMovementDirectionForTest(new Vector3(1, 0, 0));
    expect(left.x).toBeCloseTo(1);
    expect(left.z).toBeCloseTo(0);
  });
});
