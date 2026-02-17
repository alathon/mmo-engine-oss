import {
  DEFAULT_PLAYER_GRAVITY,
  DEFAULT_PLAYER_JUMP_VELOCITY,
  DEFAULT_PLAYER_MAX_FALL_SPEED,
  PLAYER_COLLISION_EPSILON,
  PlayerCollisionSimulator as SharedPlayerCollisionSimulator,
  type SimulatePlayerCollisionStepParams as SharedSimulateStepParams,
} from "@mmo/shared-sim";
import type { ServerCollisionWorld } from "../collision/server-collision-world";

const COLLISION_DEBUG_ENABLED = (() => {
  const raw = process.env.MMO_SERVER_COLLISION_DEBUG?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
})();
const COLLISION_TRACE_STEPS_ENABLED = (() => {
  const raw = process.env.MMO_SERVER_COLLISION_TRACE_STEPS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
})();
const COLLISION_DEBUG_SAMPLE_LIMIT = 120;

export interface SimulatePlayerCollisionStepParams {
  currentX: number;
  currentY: number;
  currentZ: number;
  directionX: number;
  directionZ: number;
  deltaTimeMs: number;
  speed: number;
  velocityY: number;
  grounded: boolean;
  jumpPressed: boolean;
}

export interface SimulatePlayerCollisionStepResult {
  x: number;
  y: number;
  z: number;
  velocityY: number;
  grounded: boolean;
  movementRatio: number;
  collided: boolean;
}

export class PlayerCollisionSimulator {
  private readonly collisionWorld: ServerCollisionWorld;
  private readonly simulator: SharedPlayerCollisionSimulator;
  private debugSamplesRemaining = COLLISION_DEBUG_SAMPLE_LIMIT;

  constructor(collisionWorld: ServerCollisionWorld) {
    this.collisionWorld = collisionWorld;
    this.simulator = new SharedPlayerCollisionSimulator(
      this.collisionWorld.scene,
      `server_player_collision_probe_${collisionWorld.zoneId}`,
    );
    if (COLLISION_DEBUG_ENABLED) {
      const sceneMeshes = this.collisionWorld.scene.meshes;
      const collidableMeshes = sceneMeshes.filter((mesh) => mesh.checkCollisions);
      const enabledCollidableMeshes = collidableMeshes.filter((mesh) => mesh.isEnabled());
      console.log("[server-collision] Player collision simulator ready", {
        zoneId: this.collisionWorld.zoneId,
        sceneMeshCount: sceneMeshes.length,
        collidableCount: collidableMeshes.length,
        enabledCollidableCount: enabledCollidableMeshes.length,
        collisionsEnabled: this.collisionWorld.scene.collisionsEnabled,
      });
    }
  }

  dispose(): void {
    this.simulator.dispose();
  }

  simulateStep(params: SimulatePlayerCollisionStepParams): SimulatePlayerCollisionStepResult {
    const sharedParams: SharedSimulateStepParams = {
      ...params,
      gravity: DEFAULT_PLAYER_GRAVITY,
      maxFallSpeed: DEFAULT_PLAYER_MAX_FALL_SPEED,
      jumpVelocity: DEFAULT_PLAYER_JUMP_VELOCITY,
    };
    const result = this.simulator.simulateStep(sharedParams);

    if (
      COLLISION_DEBUG_ENABLED &&
      COLLISION_TRACE_STEPS_ENABLED &&
      this.debugSamplesRemaining > 0 &&
      (params.jumpPressed ||
        Math.abs(params.directionX) > PLAYER_COLLISION_EPSILON ||
        Math.abs(params.directionZ) > PLAYER_COLLISION_EPSILON)
    ) {
      this.debugSamplesRemaining -= 1;
      console.log("[server-collision] Sim step", {
        zoneId: this.collisionWorld.zoneId,
        startX: params.currentX,
        startY: params.currentY,
        startZ: params.currentZ,
        endX: result.x,
        endY: result.y,
        endZ: result.z,
        directionX: params.directionX,
        directionZ: params.directionZ,
        speed: params.speed,
        jumpPressed: params.jumpPressed,
        velocityYIn: params.velocityY,
        velocityYOut: result.velocityY,
        groundedIn: params.grounded,
        groundedOut: result.grounded,
        sawGroundHit: result.sawGroundHit,
        sawVerticalCollision: result.sawVerticalCollision,
        movementRatio: result.movementRatio,
      });
    }

    return {
      x: result.x,
      y: result.y,
      z: result.z,
      velocityY: result.velocityY,
      grounded: result.grounded,
      movementRatio: result.movementRatio,
      collided: result.collided,
    };
  }
}
