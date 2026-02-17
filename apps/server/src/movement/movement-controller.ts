import {
  CLIENT_RECONCILE_DISTANCE_EPSILON,
  PLAYER_SPEED,
  PLAYER_SPRINT_MULTIPLIER,
  type MobState,
  type NavcatQuery,
} from "@mmo/shared-sim";
import type { ServerCollisionWorld } from "../collision/server-collision-world";
import { PlayerCollisionSimulator } from "./player-collision-simulator";
import type { ServerPlayer } from "../world/entities/player";
import type { ServerMob } from "../world/entities/server-mob";
import type { ServerZone } from "../world/zones/zone";
import {
  MAX_INPUT_CATCH_UP_TICKS,
  MAX_INPUT_LAG_TICKS,
  SERVER_SNAP_DISTANCE,
} from "../world/constants/movement";

const MOVEMENT_EPSILON_SQ = 0.0001 * 0.0001;
const DIRECTION_EPSILON = 0.0001;
const SERVER_SNAP_DEBUG_ENABLED = (() => {
  const raw = process.env.MMO_SERVER_SNAP_DEBUG?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
})();
const SERVER_SNAP_DEBUG_SAMPLE_LIMIT = 120;

export interface MobMovementEvent {
  mob: ServerMob<MobState>;
  positionBeforeTick: { x: number; y: number; z: number };
  positionAfterTick: { x: number; y: number; z: number };
  attempted: boolean;
  moved: boolean;
  direction: { x: number; z: number };
  movementRatio?: number;
  collided?: boolean;
}

export type MobMovementListener = (
  event: MobMovementEvent,
  serverTick: number,
  serverTimeMs: number,
) => void;

export class MovementController {
  private readonly mobMovementListeners: MobMovementListener[] = [];
  private playerCollisionSimulator?: PlayerCollisionSimulator;
  private playerCollisionWorld?: ServerCollisionWorld;
  private snapDebugSamplesRemaining = SERVER_SNAP_DEBUG_SAMPLE_LIMIT;

  constructor(private readonly zone: ServerZone) {}

  fixedTick(
    serverTimeMs: number,
    tickMs: number,
    serverTick: number,
    navmesh: NavcatQuery,
    collisionWorld?: ServerCollisionWorld,
  ): void {
    if (!collisionWorld) {
      throw new Error(
        `Zone ${this.zone.zoneData.zoneId} is missing collision world for player movement`,
      );
    }
    this.tickNpcs(serverTimeMs, tickMs, serverTick, navmesh);
    this.tickPlayers(serverTimeMs, tickMs, serverTick, collisionWorld);
  }

  dispose(): void {
    this.playerCollisionSimulator?.dispose();
    this.playerCollisionSimulator = undefined;
    this.playerCollisionWorld = undefined;
  }

  onMobMovement(listener: MobMovementListener): () => void {
    if (this.mobMovementListeners.includes(listener)) {
      return () => {};
    }
    this.mobMovementListeners.push(listener);
    return () => {
      const index = this.mobMovementListeners.indexOf(listener);
      if (index !== -1) {
        this.mobMovementListeners.splice(index, 1);
      }
    };
  }

  private tickNpcs(
    serverTimeMs: number,
    tickMs: number,
    serverTick: number,
    navmesh: NavcatQuery,
  ): void {
    const deltaSeconds = tickMs / 1000;
    for (const npc of this.zone.npcs.values()) {
      const before = {
        x: npc.synced.x,
        y: npc.synced.y,
        z: npc.synced.z,
      };
      const steering = npc.steeringIntent;
      const directionX = steering.directionX;
      const directionZ = steering.directionZ;
      npc.dirX = directionX;
      npc.dirZ = directionZ;
      npc.synced.facingYaw = steering.facingYaw;

      const attempted =
        Math.abs(directionX) > DIRECTION_EPSILON || Math.abs(directionZ) > DIRECTION_EPSILON;

      if (attempted) {
        const moveX = directionX * npc.aiConfig.moveSpeed * deltaSeconds;
        const moveZ = directionZ * npc.aiConfig.moveSpeed * deltaSeconds;

        const result = navmesh.validateMovement(
          npc.synced.x,
          npc.synced.z,
          moveX,
          moveZ,
          npc.navmeshNodeRef ?? undefined,
        );
        npc.synced.x = result.x;
        npc.synced.y = result.y;
        npc.synced.z = result.z;
        npc.navmeshNodeRef = result.nodeRef ?? undefined;

        if (result.collided && result.movementRatio < 0.01) {
          npc.brainState.movingUntilMs = npc.brainState.elapsedTimeMs;
        }
      }

      const after = { x: npc.synced.x, y: npc.synced.y, z: npc.synced.z };
      this.emitMobMovementIfChanged(
        npc,
        before,
        after,
        attempted,
        serverTimeMs,
        undefined,
        undefined,
        { x: directionX, z: directionZ },
        serverTick,
      );
    }
  }

  private tickPlayers(
    serverTimeMs: number,
    tickMs: number,
    serverTick: number,
    collisionWorld: ServerCollisionWorld,
  ): void {
    const collisionSimulator = this.getPlayerCollisionSimulator(collisionWorld);
    const snapDistanceSq = SERVER_SNAP_DISTANCE * SERVER_SNAP_DISTANCE;
    const reconcileDistanceSq =
      CLIENT_RECONCILE_DISTANCE_EPSILON * CLIENT_RECONCILE_DISTANCE_EPSILON;

    for (const serverPlayer of this.zone.players.values()) {
      const pendingBefore = serverPlayer.pendingInputs.length;

      // Accumulate a bounded per-player budget of inputs to process this tick.
      serverPlayer.inputBudgetTicks = Math.min(
        serverPlayer.inputBudgetTicks + 1,
        MAX_INPUT_CATCH_UP_TICKS,
      );
      const budgetBefore = serverPlayer.inputBudgetTicks;

      if (serverPlayer.pendingInputs.length === 0) {
        serverPlayer.synced.velocityY = serverPlayer.velocityY;
        serverPlayer.synced.grounded = serverPlayer.grounded;
        this.updateMovementDebug(serverPlayer, {
          serverTick,
          pendingInputs: pendingBefore,
          processedInputs: 0,
          droppedInputs: 0,
          remainingInputs: 0,
          budgetBefore,
          budgetAfter: serverPlayer.inputBudgetTicks,
        });
        serverPlayer.synced.serverTimeMs = serverTimeMs;
        continue;
      }

      if (serverPlayer.clientTickOffset === undefined) {
        // Map client tick numbers into server tick space using the first input.
        serverPlayer.clientTickOffset = serverTick - serverPlayer.pendingInputs[0].tick;
      }

      // Drop inputs that are too old to prevent time-banking bursts.
      const oldestAllowedTick = serverTick - MAX_INPUT_LAG_TICKS;
      const nextPendingInputs: typeof serverPlayer.pendingInputs = [];
      let inputBudget = serverPlayer.inputBudgetTicks;
      let droppedStale = 0;
      let processedInputs = 0;

      for (const input of serverPlayer.pendingInputs) {
        const mappedTick = input.tick + (serverPlayer.clientTickOffset ?? 0);
        if (mappedTick < oldestAllowedTick) {
          droppedStale += 1;
          continue;
        }

        // Do not process client inputs that map to future server ticks.
        // Processing these early causes simulation phase drift (especially in vertical motion).
        if (mappedTick > serverTick) {
          nextPendingInputs.push(input);
          continue;
        }

        if (inputBudget <= 0) {
          nextPendingInputs.push(input);
          continue;
        }

        if (input.seq <= serverPlayer.synced.lastProcessedSeq) {
          console.log(
            `Skipping input ${input.seq} for player as lastProcessedSeq is greater: ${serverPlayer.synced.lastProcessedSeq}`,
          );
          continue;
        }

        // Validate that input.directionX and input.directionZ are within [-1; 1].
        const directionX = input.directionX;
        const directionZ = input.directionZ;

        const before = {
          x: serverPlayer.synced.x,
          y: serverPlayer.synced.y,
          z: serverPlayer.synced.z,
        };
        const attemptedHorizontal =
          Math.abs(directionX) > DIRECTION_EPSILON || Math.abs(directionZ) > DIRECTION_EPSILON;
        const attempted = attemptedHorizontal || input.jumpPressed;

        const speed = input.isSprinting ? PLAYER_SPEED * PLAYER_SPRINT_MULTIPLIER : PLAYER_SPEED;
        const result = collisionSimulator.simulateStep({
          currentX: serverPlayer.synced.x,
          currentY: serverPlayer.synced.y,
          currentZ: serverPlayer.synced.z,
          directionX,
          directionZ,
          deltaTimeMs: tickMs,
          speed,
          velocityY: serverPlayer.velocityY,
          grounded: serverPlayer.grounded,
          jumpPressed: input.jumpPressed,
        });

        serverPlayer.velocityY = result.velocityY;
        serverPlayer.grounded = result.grounded;
        serverPlayer.synced.x = result.x;
        serverPlayer.synced.y = result.y;
        serverPlayer.synced.z = result.z;
        serverPlayer.synced.velocityY = result.velocityY;
        serverPlayer.synced.grounded = result.grounded;
        serverPlayer.navmeshNodeRef = undefined;
        const after = {
          x: serverPlayer.synced.x,
          y: serverPlayer.synced.y,
          z: serverPlayer.synced.z,
        };
        this.emitMobMovementIfChanged(
          serverPlayer,
          before,
          after,
          attempted,
          serverTimeMs,
          result.movementRatio,
          result.collided,
          { x: directionX, z: directionZ },
          serverTick,
        );

        serverPlayer.synced.lastProcessedSeq = input.seq;
        inputBudget -= 1;
        processedInputs += 1;

        const dx = serverPlayer.synced.x - input.predictedX;
        const dy = serverPlayer.synced.y - input.predictedY;
        const dz = serverPlayer.synced.z - input.predictedZ;
        const distanceSq = dx * dx + dy * dy + dz * dz;

        if (
          SERVER_SNAP_DEBUG_ENABLED &&
          this.snapDebugSamplesRemaining > 0 &&
          distanceSq > reconcileDistanceSq
        ) {
          this.snapDebugSamplesRemaining -= 1;
          console.log("[server-reconcile] drift", {
            zoneId: this.zone.zoneData.zoneId,
            playerId: serverPlayer.synced.playerId,
            seq: input.seq,
            serverTick,
            mappedTick,
            dx,
            dy,
            dz,
            predictedY: input.predictedY,
            serverY: serverPlayer.synced.y,
            distance: Math.sqrt(distanceSq),
            reconcileThreshold: CLIENT_RECONCILE_DISTANCE_EPSILON,
            snapThreshold: SERVER_SNAP_DISTANCE,
            wouldServerSnap: distanceSq > snapDistanceSq,
            directionX,
            directionZ,
            jumpPressed: input.jumpPressed,
            velocityY: serverPlayer.velocityY,
            grounded: serverPlayer.grounded,
          });
        }

        if (distanceSq > snapDistanceSq) {
          if (SERVER_SNAP_DEBUG_ENABLED && this.snapDebugSamplesRemaining > 0) {
            this.snapDebugSamplesRemaining -= 1;
            console.log("[server-snap] correction", {
              zoneId: this.zone.zoneData.zoneId,
              playerId: serverPlayer.synced.playerId,
              seq: input.seq,
              distance: Math.sqrt(distanceSq),
              threshold: Math.sqrt(snapDistanceSq),
              directionX,
              directionZ,
              jumpPressed: input.jumpPressed,
              velocityY: serverPlayer.velocityY,
              grounded: serverPlayer.grounded,
              serverX: serverPlayer.synced.x,
              serverY: serverPlayer.synced.y,
              serverZ: serverPlayer.synced.z,
              predictedX: input.predictedX,
              predictedY: input.predictedY,
              predictedZ: input.predictedZ,
            });
          }
          serverPlayer.snapLocked = true;
          serverPlayer.snapTarget = {
            x: serverPlayer.synced.x,
            y: serverPlayer.synced.y,
            z: serverPlayer.synced.z,
          };
          serverPlayer.snapPending = {
            x: serverPlayer.synced.x,
            y: serverPlayer.synced.y,
            z: serverPlayer.synced.z,
            seq: input.seq,
          };
          nextPendingInputs.length = 0;
          inputBudget = 0;
          break;
        }
      }
      serverPlayer.pendingInputs = nextPendingInputs;
      serverPlayer.inputBudgetTicks = inputBudget;
      serverPlayer.synced.serverTimeMs = serverTimeMs;
      this.updateMovementDebug(serverPlayer, {
        serverTick,
        pendingInputs: pendingBefore,
        processedInputs,
        droppedInputs: droppedStale,
        remainingInputs: serverPlayer.pendingInputs.length,
        budgetBefore,
        budgetAfter: serverPlayer.inputBudgetTicks,
      });
    }
  }

  private getPlayerCollisionSimulator(
    collisionWorld: ServerCollisionWorld,
  ): PlayerCollisionSimulator {
    if (
      this.playerCollisionSimulator !== undefined &&
      this.playerCollisionWorld === collisionWorld
    ) {
      return this.playerCollisionSimulator;
    }

    this.playerCollisionSimulator?.dispose();
    this.playerCollisionSimulator = new PlayerCollisionSimulator(collisionWorld);
    this.playerCollisionWorld = collisionWorld;
    return this.playerCollisionSimulator;
  }

  private updateMovementDebug(
    player: ServerPlayer,
    info: {
      serverTick: number;
      pendingInputs: number;
      processedInputs: number;
      droppedInputs: number;
      remainingInputs: number;
      budgetBefore: number;
      budgetAfter: number;
    },
  ): void {
    const debugInfo = player.synced.debug;
    if (!debugInfo) {
      return;
    }
    debugInfo.serverTick = info.serverTick;
    debugInfo.pendingInputs = info.pendingInputs;
    debugInfo.processedInputs = info.processedInputs;
    debugInfo.droppedInputs = info.droppedInputs;
    debugInfo.remainingInputs = info.remainingInputs;
    debugInfo.budgetBefore = info.budgetBefore;
    debugInfo.budgetAfter = info.budgetAfter;
  }

  private emitMobMovement(event: MobMovementEvent, serverTick: number, serverTimeMs: number): void {
    for (const listener of this.mobMovementListeners) {
      listener(event, serverTick, serverTimeMs);
    }
  }

  private emitMobMovementIfChanged(
    mob: ServerMob<MobState>,
    before: { x: number; y: number; z: number },
    after: { x: number; y: number; z: number },
    attempted: boolean,
    serverTimeMs: number,
    movementRatio: number | undefined,
    collided: boolean | undefined,
    direction: { x: number; z: number },
    serverTick: number,
  ): void {
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const dz = after.z - before.z;
    const moved = dx * dx + dy * dy + dz * dz > MOVEMENT_EPSILON_SQ;
    if (!attempted && !moved) {
      return;
    }
    this.emitMobMovement(
      {
        mob,
        positionBeforeTick: before,
        positionAfterTick: after,
        attempted,
        moved,
        direction,
        movementRatio,
        collided,
      },
      serverTick,
      serverTimeMs,
    );
  }
}
