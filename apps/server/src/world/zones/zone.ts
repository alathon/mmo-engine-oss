import { ZoneState, ZoneDefinition, NavcatQuery } from "@mmo/shared";
import { ServerPlayer } from "../entities/player";
import { ServerNPC } from "../entities/npc";
import { ZoneEntryPoint, ZoneSpawnPoint } from "./types";
import { ZoneLifecycle } from "./zone-lifecycle";
import { AbilityEngine, CombatEngine } from "../../combat";
import { LineOfSightTracker } from "./line-of-sight-tracker";
import { EventLog } from "../../eventLog";
import { MovementController } from "../../movement/movement-controller";
import { AiController } from "../../ai/ai-controller";
import { AbilityIntentSystem } from "../../ai/systems/ability-intent-system";

export class ZoneData {
  constructor(
    zoneId: string,
    navmeshQuery: NavcatQuery,
    definition: ZoneDefinition,
  ) {
    this.definition = definition;
    this.navmeshQuery = navmeshQuery;
    this.zoneId = zoneId;
  }

  public readonly zoneId: string;
  public readonly navmeshQuery: NavcatQuery;
  /** The zone definition data. */
  public readonly definition: ZoneDefinition;

  /** The entry points for this zone. */
  public entryPoints: ZoneEntryPoint[] = [];

  /** The mob spawn points for this zone. */
  public mobSpawnPoints: ZoneSpawnPoint<"mob">[] = [];

  /** The object spawn points for this zone. */
  public objSpawnPoints: ZoneSpawnPoint<"obj">[] = [];

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
        (entry) => entry.fromZoneId === fromZone,
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
    if (navmesh.isPointOnNavmesh(spawnX, spawnZ)) {
      const height = navmesh.sampleHeight(spawnX, spawnZ) ?? undefined;
      if (height !== undefined) {
        spawnY = height;
      }
    } else {
      const nearest = navmesh.findNearestPoint(spawnX, spawnZ, 10);
      if (nearest) {
        spawnX = nearest.x;
        spawnZ = nearest.z;
        spawnY = nearest.y;
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
  public readonly movementController: MovementController;
  private readonly aiController: AiController;
  private readonly abilityIntentSystem: AbilityIntentSystem;
  private readonly lineOfSightTracker: LineOfSightTracker;

  constructor(
    public readonly zoneData: ZoneData,
    public readonly zoneState: ZoneState,
  ) {
    this.zoneLifecycle = new ZoneLifecycle();
    this.zoneLifecycle.initializeFromZone(this);
    this.eventLog = new EventLog();
    this.movementController = new MovementController(this);
    this.aiController = new AiController(this);
    this.abilityIntentSystem = new AbilityIntentSystem();
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

    this.abilityEngine.fixedTick(time, this.serverTick);
    this.combatEngine.fixedTick(time);

    this.zoneLifecycle.update(tickMs);

    this.aiController.fixedTick(tickMs);
    this.abilityIntentSystem.update(this, time, this.serverTick);

    this.movementController.fixedTick(
      time,
      tickMs,
      this.serverTick,
      this.zoneData.navmeshQuery,
    );

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
