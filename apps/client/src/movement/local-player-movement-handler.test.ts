import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Collisions/collisionCoordinator";
import type { PendingMove } from "./movement-types";
import { LocalPlayerMovementHandler } from "./local-player-movement-handler";
import type { InputManager } from "../input/input-manager";
import type { PlayerEntity } from "../entities/player-entity";
import type { ZoneConnectionManager } from "../network/zone-connection-manager";

const createMove = (overrides: Partial<PendingMove>): PendingMove => ({
  seq: 0,
  tick: 0,
  dirX: 0,
  dirZ: 0,
  jumpPressed: false,
  isSprinting: false,
  velocityY: 0,
  grounded: true,
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
    velocityY?: number;
    grounded?: boolean;
    jumpPressed?: boolean;
  }) {
    return this.predictMovementStep({
      ...params,
      velocityY: params.velocityY ?? 0,
      grounded: params.grounded ?? false,
      jumpPressed: params.jumpPressed ?? false,
    });
  }

  public resolveMovementDirectionForTest(inputDir: Vector3): Vector3 {
    return this.resolveMovementDirection(inputDir);
  }

  override getMoveSpeed(_isSprinting: boolean): number {
    return 1;
  }
}

const createTestPlayer = (scene?: Scene): PlayerEntity => {
  const position = new Vector3(0, 0, 0);
  const targetPosition = new Vector3(0, 0, 0);
  const serverPosition = new Vector3(0, 0, 0);
  return {
    position,
    getId: () => "test-player",
    getScene: () => scene as Scene,
    getTargetPosition: () => targetPosition,
    setTargetPosition: (x: number, y: number, z: number) => {
      targetPosition.set(x, y, z);
    },
    getServerPositionSnapshot: () => serverPosition.clone(),
    setServerPosition: (x: number, y: number, z: number) => {
      serverPosition.set(x, y, z);
    },
    setMovementYaw: () => {},
    getCollisionMesh: () => undefined,
    setNavmeshMoveDebug: () => {},
  } as unknown as PlayerEntity;
};

const createHandler = (player = createTestPlayer()) => {
  const input = {
    getMovementDirection: () => Vector3.Zero(),
    consumeKeyPress: () => false,
  } as unknown as InputManager;
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

  it("predicts movement for idle inputs", () => {
    const handler = createHandler();
    const position = new Vector3(1, 2, 3);
    const direction = new Vector3(0, 0, 0);

    const result = handler.predictMovementStepForTest({
      currentPosition: position,
      direction,
      deltaTimeMs: 100,
      speed: 5,
      velocityY: 0,
    });

    expect(result.position.x).toBeCloseTo(position.x);
    expect(result.position.y).toBeLessThan(position.y);
    expect(result.position.z).toBeCloseTo(position.z);
    expect(result.position).not.toBe(position);
    expect(result.debug).toBeUndefined();
    expect(result.grounded).toBe(false);
    expect(result.velocityY).toBeLessThan(0);
  });

  it("predicts movement without a collision scene", () => {
    const handler = createHandler();
    const position = new Vector3(0, 0, 0);
    const direction = new Vector3(1, 0, 0);

    const result = handler.predictMovementStepForTest({
      currentPosition: position,
      direction,
      deltaTimeMs: 500,
      speed: 2,
      velocityY: 0,
    });

    expect(result.position.x).toBeCloseTo(1);
    expect(result.position.y).toBeLessThan(0);
    expect(result.position.z).toBeCloseTo(0);
    expect(result.grounded).toBe(false);
    expect(result.velocityY).toBeLessThan(0);
  });

  it("predicts movement with collisions and emits movement debug", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.collisionsEnabled = true;
    const ground = MeshBuilder.CreateBox("ground", { width: 20, height: 1, depth: 20 }, scene);
    ground.position.set(0, -0.5, 0);
    ground.checkCollisions = true;
    const wall = MeshBuilder.CreateBox("wall", { width: 1, height: 4, depth: 2 }, scene);
    wall.position.set(1, 1, 2);
    wall.checkCollisions = true;

    const handler = createHandler(createTestPlayer(scene));
    const position = new Vector3(2, 0, 2);
    const direction = new Vector3(-1, 0, 0);

    const result = handler.predictMovementStepForTest({
      currentPosition: position,
      direction,
      deltaTimeMs: 1000,
      speed: 2,
      velocityY: 0,
    });

    expect(result.position.x).toBeCloseTo(0);
    expect(result.position.z).toBeCloseTo(2);
    expect(result.debug?.requested).toBeCloseTo(2);
    expect(result.debug?.actual).toBeCloseTo(2);
    expect(result.debug?.ratio).toBeCloseTo(1);
    expect(result.debug?.collided).toBe(false);
    expect(result.velocityY).toBeLessThanOrEqual(0);

    scene.dispose();
    engine.dispose();
  });

  it("applies gravity when no supporting collision mesh is below", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.collisionsEnabled = true;
    const handler = createHandler(createTestPlayer(scene));

    const result = handler.predictMovementStepForTest({
      currentPosition: new Vector3(0, 5, 0),
      direction: new Vector3(0, 0, 0),
      deltaTimeMs: 100,
      speed: 0,
      velocityY: 0,
    });

    expect(result.position.y).toBeLessThan(5);
    expect(result.grounded).toBe(false);
    expect(result.velocityY).toBeLessThan(0);

    scene.dispose();
    engine.dispose();
  });

  it("maps input relative to camera forward", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 2, 10, Vector3.Zero(), scene);

    const handler = createHandler();
    handler.setCamera(camera);

    const forward = handler.resolveMovementDirectionForTest(new Vector3(0, 0, 1));
    expect(forward.x).toBeCloseTo(0);
    expect(forward.z).toBeCloseTo(1);

    const left = handler.resolveMovementDirectionForTest(new Vector3(1, 0, 0));
    expect(left.x).toBeCloseTo(1);
    expect(left.z).toBeCloseTo(0);
  });

  it("jumps upward while preserving forward movement", () => {
    const targetPosition = new Vector3(0, 0, 0);
    const input = {
      getMovementDirection: () => new Vector3(0, 0, 1),
      consumeKeyPress: vi.fn(() => true),
    } as unknown as InputManager;
    const zoneNetwork = {
      sendMessage: vi.fn(),
    } as unknown as ZoneConnectionManager;
    const player = {
      position: targetPosition.clone(),
      getId: () => "test-player",
      getScene: () => undefined as unknown as Scene,
      getTargetPosition: () => targetPosition,
      setTargetPosition: (x: number, y: number, z: number) => {
        targetPosition.set(x, y, z);
      },
      getServerPositionSnapshot: () => targetPosition.clone(),
      setServerPosition: () => {},
      setMovementYaw: () => {},
      getCollisionMesh: () => undefined,
      setNavmeshMoveDebug: () => {},
    } as unknown as PlayerEntity;
    const handler = new TestMovementHandler(player, input, zoneNetwork);

    handler.fixedTick(50);

    expect(targetPosition.y).toBeGreaterThan(0);
    expect(targetPosition.z).toBeGreaterThan(0);
    expect(zoneNetwork.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not re-apply jump impulse while airborne", () => {
    const targetPosition = new Vector3(0, 0, 0);
    const input = {
      getMovementDirection: () => Vector3.Zero(),
      consumeKeyPress: vi.fn(() => true),
    } as unknown as InputManager;
    const zoneNetwork = {
      sendMessage: vi.fn(),
    } as unknown as ZoneConnectionManager;
    const player = {
      position: targetPosition.clone(),
      getId: () => "test-player",
      getScene: () => undefined as unknown as Scene,
      getTargetPosition: () => targetPosition,
      setTargetPosition: (x: number, y: number, z: number) => {
        targetPosition.set(x, y, z);
      },
      getServerPositionSnapshot: () => targetPosition.clone(),
      setServerPosition: () => {},
      setMovementYaw: () => {},
      getCollisionMesh: () => undefined,
      setNavmeshMoveDebug: () => {},
    } as unknown as PlayerEntity;
    const handler = new TestMovementHandler(player, input, zoneNetwork);

    handler.fixedTick(50);
    const yAfterFirstTick = targetPosition.y;
    handler.fixedTick(50);
    const yAfterSecondTick = targetPosition.y;

    const sentMessages = vi.mocked(zoneNetwork.sendMessage).mock.calls.map((call) => call[0]) as {
      payload: {
        jumpPressed: boolean;
      };
    }[];

    expect(yAfterSecondTick - yAfterFirstTick).toBeLessThan(yAfterFirstTick);
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]?.payload.jumpPressed).toBe(true);
    expect(sentMessages[1]?.payload.jumpPressed).toBe(false);
  });

  it("treats a 65-degree slope as downhill-walkable but uphill-non-walkable", () => {
    const handler = createHandler();
    const slopeDegrees = 65;
    const normalY = Math.cos((slopeDegrees * Math.PI) / 180);
    const normalZ = -Math.sin((slopeDegrees * Math.PI) / 180);
    const handlerAny = handler as unknown as {
      isShallowGroundForMotion: (
        groundHit:
          | {
              y: number;
              normalX: number;
              normalY: number;
              normalZ: number;
            }
          | undefined,
        horizontalDeltaX: number,
        horizontalDeltaZ: number,
      ) => boolean;
    };
    const groundHit = {
      y: 0,
      normalX: 0,
      normalY,
      normalZ,
    };

    const uphillIsShallow = handlerAny.isShallowGroundForMotion(groundHit, 0, 0.1);
    const downhillIsShallow = handlerAny.isShallowGroundForMotion(groundHit, 0, -0.1);

    expect(uphillIsShallow).toBe(false);
    expect(downhillIsShallow).toBe(true);
  });

  it("computes slope-follow y displacement from ground normal", () => {
    const handler = createHandler();
    const handlerAny = handler as unknown as {
      computeSlopeDeltaYFromNormal: (
        normalX: number,
        normalY: number,
        normalZ: number,
        horizontalDeltaX: number,
        horizontalDeltaZ: number,
      ) => number;
    };
    const slopeDegrees = 60;
    const normalY = Math.cos((slopeDegrees * Math.PI) / 180);
    const normalZ = -Math.sin((slopeDegrees * Math.PI) / 180);
    const horizontalDeltaZ = 0.1;

    const slopeFollowDeltaY = handlerAny.computeSlopeDeltaYFromNormal(
      0,
      normalY,
      normalZ,
      0,
      horizontalDeltaZ,
    );

    expect(slopeFollowDeltaY).toBeGreaterThan(0);
    expect(slopeFollowDeltaY).toBeCloseTo(Math.tan((slopeDegrees * Math.PI) / 180) * 0.1);
  });

  it("collapses interpolation state when idle and grounded", () => {
    const targetPosition = new Vector3(3, 1, 7);
    const setTargetPosition = vi.fn((x: number, y: number, z: number) => {
      targetPosition.set(x, y, z);
    });
    const player = {
      position: targetPosition.clone(),
      getId: () => "test-player",
      getScene: () => undefined as unknown as Scene,
      getTargetPosition: () => targetPosition,
      setTargetPosition,
      getServerPositionSnapshot: () => targetPosition.clone(),
      setServerPosition: () => {},
      setMovementYaw: () => {},
      getCollisionMesh: () => undefined,
      setNavmeshMoveDebug: () => {},
    } as unknown as PlayerEntity;

    const input = {
      getMovementDirection: () => Vector3.Zero(),
      consumeKeyPress: () => false,
    } as unknown as InputManager;
    const zoneNetwork = {
      sendMessage: vi.fn(),
    } as unknown as ZoneConnectionManager;
    const handler = new TestMovementHandler(player, input, zoneNetwork);

    handler.fixedTick(50);

    expect(setTargetPosition).toHaveBeenCalledWith(3, 1, 7, false);
    expect(zoneNetwork.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps interpolation enabled while idle but airborne", () => {
    const targetPosition = new Vector3(0, 0, 0);
    const setTargetPosition = vi.fn((x: number, y: number, z: number) => {
      targetPosition.set(x, y, z);
    });
    const input = {
      getMovementDirection: () => Vector3.Zero(),
      consumeKeyPress: vi.fn(() => true),
    } as unknown as InputManager;
    const zoneNetwork = {
      sendMessage: vi.fn(),
    } as unknown as ZoneConnectionManager;
    const player = {
      position: targetPosition.clone(),
      getId: () => "test-player",
      getScene: () => undefined as unknown as Scene,
      getTargetPosition: () => targetPosition,
      setTargetPosition,
      getServerPositionSnapshot: () => targetPosition.clone(),
      setServerPosition: () => {},
      setMovementYaw: () => {},
      getCollisionMesh: () => undefined,
      setNavmeshMoveDebug: () => {},
    } as unknown as PlayerEntity;
    const handler = new TestMovementHandler(player, input, zoneNetwork);

    handler.fixedTick(50);

    expect(setTargetPosition).toHaveBeenLastCalledWith(
      targetPosition.x,
      targetPosition.y,
      targetPosition.z,
      true,
    );
  });

  it("sets yaw from movement input direction", () => {
    const targetPosition = new Vector3(0, 0, 0);
    const setMovementYaw = vi.fn();
    const input = {
      getMovementDirection: () => new Vector3(1, 0, 0),
      consumeKeyPress: () => false,
    } as unknown as InputManager;
    const zoneNetwork = {
      sendMessage: vi.fn(),
    } as unknown as ZoneConnectionManager;
    const player = {
      position: targetPosition.clone(),
      getId: () => "test-player",
      getScene: () => undefined as unknown as Scene,
      getTargetPosition: () => targetPosition,
      setTargetPosition: (x: number, y: number, z: number) => {
        targetPosition.set(x, y, z);
      },
      getServerPositionSnapshot: () => targetPosition.clone(),
      setServerPosition: () => {},
      setMovementYaw,
      getCollisionMesh: () => undefined,
      setNavmeshMoveDebug: () => {},
    } as unknown as PlayerEntity;
    const handler = new TestMovementHandler(player, input, zoneNetwork);

    handler.fixedTick(50);

    expect(setMovementYaw).toHaveBeenCalledWith(Math.PI / 2);
  });

  it("does not change yaw when there is no movement input", () => {
    const targetPosition = new Vector3(0, 0, 0);
    const setMovementYaw = vi.fn();
    const input = {
      getMovementDirection: () => Vector3.Zero(),
      consumeKeyPress: vi.fn(() => true),
    } as unknown as InputManager;
    const zoneNetwork = {
      sendMessage: vi.fn(),
    } as unknown as ZoneConnectionManager;
    const player = {
      position: targetPosition.clone(),
      getId: () => "test-player",
      getScene: () => undefined as unknown as Scene,
      getTargetPosition: () => targetPosition,
      setTargetPosition: (x: number, y: number, z: number) => {
        targetPosition.set(x, y, z);
      },
      getServerPositionSnapshot: () => targetPosition.clone(),
      setServerPosition: () => {},
      setMovementYaw,
      getCollisionMesh: () => undefined,
      setNavmeshMoveDebug: () => {},
    } as unknown as PlayerEntity;
    const handler = new TestMovementHandler(player, input, zoneNetwork);

    handler.fixedTick(50);

    expect(setMovementYaw).not.toHaveBeenCalled();
  });
});
