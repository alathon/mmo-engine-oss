import {
  applyNavmeshMovementStep,
  NAVMESH_RECOVERY_DISTANCE,
  PLAYER_SPEED,
  ZoneState,
  ZoneDefinition,
  NavcatQuery,
} from "@mmo/shared";
import { ServerPlayer } from "../entities/player";
import { ServerNPC } from "../entities/npc";
import { ZoneEntryPoint, ZoneSpawnPoint } from "./types";
import { ZoneLifecycle } from "./zoneLifecycle";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  MAX_INPUT_CATCH_UP_TICKS,
  MAX_INPUT_LAG_TICKS,
  SERVER_SNAP_DISTANCE,
} from "../constants/movement";
import { AbilityEngine, CombatEngine } from "../../combat";
import { LineOfSightTracker } from "./lineOfSightTracker";
import { EventLog } from "../../eventLog";

export class ZoneData {
  constructor(public readonly zoneId: string) {}

  /** The zone definition data. */
  public definition!: ZoneDefinition;

  /** The entry points for this zone. */
  public entryPoints: ZoneEntryPoint[] = [];

  /** The mob spawn points for this zone. */
  public mobSpawnPoints: ZoneSpawnPoint<"mob">[] = [];

  /** The object spawn points for this zone. */
  public objSpawnPoints: ZoneSpawnPoint<"obj">[] = [];

  /** The navmesh query for this zone. */
  public navmeshQuery?: NavcatQuery;

  public getSpawnPosition(fromZone?: string): {
    x: number;
    y: number;
    z: number;
  } {
    let spawnX: number;
    let spawnZ: number;
    let spawnY = 0;

    // Check for entry point from another zone
    if (fromZone) {
      const entryPoint = this.entryPoints.find(
        (e) => e.fromZoneId === fromZone,
      );
      if (entryPoint) {
        spawnX = entryPoint.position.x;
        spawnZ = entryPoint.position.z;
        spawnY = entryPoint.position.y ?? 0;
      } else {
        // Fall back to origin 0,0,0 if no entry point found
        spawnX = 0;
        spawnZ = 0;
        spawnY = 0;
      }
    } else {
      // Use default spawn for new players
      spawnX = 0;
      spawnZ = 0;
      spawnY = 0;
    }

    // Validate and adjust spawn position against navmesh
    const navmesh = this.navmeshQuery;
    if (navmesh) {
      if (!navmesh.isPointOnNavmesh(spawnX, spawnZ)) {
        const nearest = navmesh.findNearestPoint(spawnX, spawnZ, 10.0);
        if (nearest) {
          spawnX = nearest.x;
          spawnZ = nearest.z;
          spawnY = nearest.y;
        }
      } else {
        const height = navmesh.sampleHeight(spawnX, spawnZ);
        if (height !== null) {
          spawnY = height;
        }
      }
    }

    return { x: spawnX, y: spawnY, z: spawnZ };
  }
}

export class ServerZone {
  //private readonly simulationTimer: FixedSimulationTimer;
  public players = new Map<string, ServerPlayer>();
  public npcs = new Map<string, ServerNPC>();
  public objects = new Map<string, unknown>(); // TODO: Add ServerObject that wraps ObjState
  private zoneLifecycle: ZoneLifecycle;
  private serverTick = 0;
  public readonly abilityEngine: AbilityEngine;
  public readonly combatEngine: CombatEngine;
  public readonly eventLog: EventLog;
  private readonly lineOfSightTracker: LineOfSightTracker;

  constructor(
    public readonly zoneData: ZoneData,
    public readonly zoneState: ZoneState,
  ) {
    this.zoneLifecycle = new ZoneLifecycle();
    this.zoneLifecycle.initializeFromZone(this);
    this.eventLog = new EventLog();
    this.combatEngine = new CombatEngine(this);
    this.abilityEngine = new AbilityEngine(this);
    this.abilityEngine.addEventListener(this.combatEngine);
    this.lineOfSightTracker = new LineOfSightTracker();

    this.zoneLifecycle.onNpcSpawned((npc: ServerNPC) => {
      this.npcs.set(npc.synced.id, npc);
      this.zoneState.npcs.set(npc.synced.id, npc.synced);
    });

    //this.simulationTimer = new FixedSimulationTimer((deltaTimeMs) => this.update(deltaTimeMs));
  }

  public fixedTick(time: number, tickMs: number): void {
    this.serverTick += 1;
    const navmesh = this.zoneData.navmeshQuery;

    this.abilityEngine.fixedTick(time, this.serverTick);
    this.combatEngine.fixedTick(time);

    // Spawns and other zone lifecycle updates
    this.zoneLifecycle.update(tickMs);

    // NPC ai updates
    const combatants = [...this.players.values(), ...this.npcs.values()];
    this.npcs.forEach((npc) => {
      npc.npcAi.updateMob(navmesh ?? null, tickMs, combatants);
    });

    // Players
    // TODO: Move all this movement stuff somewhere more contained / somewhere else.
    this.players.forEach((serverPlayer) => {
      if (!navmesh) {
        return;
      }

      const pendingBefore = serverPlayer.pendingInputs.length;

      // Accumulate a bounded per-player budget of inputs to process this tick.
      serverPlayer.inputBudgetTicks = Math.min(
        serverPlayer.inputBudgetTicks + 1,
        MAX_INPUT_CATCH_UP_TICKS,
      );
      const budgetBefore = serverPlayer.inputBudgetTicks;

      if (serverPlayer.pendingInputs.length === 0) {
        const debugInfo = serverPlayer.synced.debug;
        if (debugInfo) {
          debugInfo.serverTick = this.serverTick;
          debugInfo.pendingInputs = pendingBefore;
          debugInfo.processedInputs = 0;
          debugInfo.droppedInputs = 0;
          debugInfo.remainingInputs = 0;
          debugInfo.budgetBefore = budgetBefore;
          debugInfo.budgetAfter = serverPlayer.inputBudgetTicks;
        }
        serverPlayer.synced.serverTimeMs = time;
        return;
      }

      if (serverPlayer.clientTickOffset === undefined) {
        // Map client tick numbers into server tick space using the first input.
        serverPlayer.clientTickOffset =
          this.serverTick - serverPlayer.pendingInputs[0].tick;
      }

      // Drop inputs that are too old to prevent time-banking bursts.
      const oldestAllowedTick = this.serverTick - MAX_INPUT_LAG_TICKS;
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

        // TODO: validate that input.directionX and input.directionZ are within [-1; 1]
        const direction = new Vector3(input.directionX, 0, input.directionZ);

        // TODO: Store speed on playerstate and just use that.
        const speed = PLAYER_SPEED;

        if (this.zoneData.navmeshQuery) {
          const deltaSeconds = tickMs / 1000;
          const result = applyNavmeshMovementStep({
            currentX: serverPlayer.synced.x,
            currentZ: serverPlayer.synced.z,
            directionX: direction.x,
            directionZ: direction.z,
            deltaTime: deltaSeconds,
            speed,
            navmesh: this.zoneData.navmeshQuery,
            startNodeRef: serverPlayer.navmeshNodeRef ?? undefined,
            recoveryDistance: NAVMESH_RECOVERY_DISTANCE,
          });

          serverPlayer.navmeshNodeRef = result.nodeRef || null;
          serverPlayer.synced.x = result.x;
          serverPlayer.synced.y = result.y;
          serverPlayer.synced.z = result.z;
        }

        serverPlayer.synced.lastProcessedSeq = input.seq;
        inputBudget -= 1;
        processedInputs += 1;

        const dx = serverPlayer.synced.x - input.predictedX;
        const dy = serverPlayer.synced.y - input.predictedY;
        const dz = serverPlayer.synced.z - input.predictedZ;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        const snapDistanceSq = SERVER_SNAP_DISTANCE * SERVER_SNAP_DISTANCE;
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
      serverPlayer.synced.serverTimeMs = time;
      const debugInfo = serverPlayer.synced.debug;
      if (debugInfo) {
        debugInfo.serverTick = this.serverTick;
        debugInfo.pendingInputs = pendingBefore;
        debugInfo.processedInputs = processedInputs;
        debugInfo.droppedInputs = droppedStale;
        debugInfo.remainingInputs = serverPlayer.pendingInputs.length;
        debugInfo.budgetBefore = budgetBefore;
        debugInfo.budgetAfter = serverPlayer.inputBudgetTicks;
      }
    });

    this.lineOfSightTracker.update(this, this.serverTick);
  }

  public getServerTick(): number {
    return this.serverTick;
  }

  /**
   * Releases timers and transient server state.
   */
  public dispose(): void {
    //this.simulationTimer.dispose();
    this.players.clear();
    this.npcs.clear();
    this.objects.clear();
  }
}
