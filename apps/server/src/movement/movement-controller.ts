import {
  applyNavmeshMovementStep,
  NAVMESH_RECOVERY_DISTANCE,
  PLAYER_SPEED,
  type MobState,
  type NavcatQuery,
} from "@mmo/shared";
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

  constructor(private readonly zone: ServerZone) {}

  fixedTick(
    serverTimeMs: number,
    tickMs: number,
    serverTick: number,
    navmesh: NavcatQuery,
  ): void {
    this.tickNpcs(serverTimeMs, tickMs, serverTick, navmesh);
    this.tickPlayers(serverTimeMs, tickMs, serverTick, navmesh);
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
        Math.abs(directionX) > DIRECTION_EPSILON ||
        Math.abs(directionZ) > DIRECTION_EPSILON;

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
    navmesh: NavcatQuery,
  ): void {
    const deltaSeconds = tickMs / 1000;
    const speed = PLAYER_SPEED;
    const snapDistanceSq = SERVER_SNAP_DISTANCE * SERVER_SNAP_DISTANCE;

    for (const serverPlayer of this.zone.players.values()) {
      const pendingBefore = serverPlayer.pendingInputs.length;

      // Accumulate a bounded per-player budget of inputs to process this tick.
      serverPlayer.inputBudgetTicks = Math.min(
        serverPlayer.inputBudgetTicks + 1,
        MAX_INPUT_CATCH_UP_TICKS,
      );
      const budgetBefore = serverPlayer.inputBudgetTicks;

      if (serverPlayer.pendingInputs.length === 0) {
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
        serverPlayer.clientTickOffset =
          serverTick - serverPlayer.pendingInputs[0].tick;
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
        const attempted =
          Math.abs(directionX) > DIRECTION_EPSILON ||
          Math.abs(directionZ) > DIRECTION_EPSILON;

        const result = applyNavmeshMovementStep({
          currentX: serverPlayer.synced.x,
          currentZ: serverPlayer.synced.z,
          directionX,
          directionZ,
          deltaTime: deltaSeconds,
          speed,
          navmesh,
          startNodeRef: serverPlayer.navmeshNodeRef ?? undefined,
          recoveryDistance: NAVMESH_RECOVERY_DISTANCE,
        });

        serverPlayer.navmeshNodeRef = result.nodeRef ?? undefined;
        serverPlayer.synced.x = result.x;
        serverPlayer.synced.y = result.y;
        serverPlayer.synced.z = result.z;
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
        if (distanceSq > snapDistanceSq) {
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

  private emitMobMovement(
    event: MobMovementEvent,
    serverTick: number,
    serverTimeMs: number,
  ): void {
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
