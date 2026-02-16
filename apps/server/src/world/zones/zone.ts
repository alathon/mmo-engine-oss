import {
  PlayerCollisionSimulator,
  TICK_MS,
  ZoneState,
  ZoneDefinition,
  NavcatQuery,
} from "@mmo/shared";
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
import type { ServerCollisionWorld } from "../../collision/server-collision-world";

const PLAYER_SPAWN_START_HEIGHT_OFFSET = 2;
const PLAYER_SPAWN_SETTLE_STEPS = 80;
const PLAYER_SPAWN_GROUNDED_VELOCITY_EPSILON = 0.2;
const PLAYER_SPAWN_OFFSETS = [
  { x: 0, z: 0 },
  { x: 0.6, z: 0 },
  { x: -0.6, z: 0 },
  { x: 0, z: 0.6 },
  { x: 0, z: -0.6 },
  { x: 1.2, z: 0 },
  { x: -1.2, z: 0 },
  { x: 0, z: 1.2 },
  { x: 0, z: -1.2 },
];

export class ZoneData {
  private spawnProbeSeq = 1;

  constructor(
    zoneId: string,
    navmeshQuery: NavcatQuery,
    definition: ZoneDefinition,
    collisionWorld?: ServerCollisionWorld,
  ) {
    this.definition = definition;
    this.navmeshQuery = navmeshQuery;
    this.zoneId = zoneId;
    this.collisionWorld = collisionWorld;
  }

  public readonly zoneId: string;
  public readonly navmeshQuery: NavcatQuery;
  /** The zone definition data. */
  public readonly definition: ZoneDefinition;
  /** Server-side Babylon collision world for this zone. */
  public readonly collisionWorld?: ServerCollisionWorld;

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
      const entryPoint = this.entryPoints.find((entry) => entry.fromZoneId === fromZone);
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
      // Use the first configured entry point as the default spawn.
      const defaultEntryPoint = this.entryPoints[0];
      if (defaultEntryPoint) {
        spawnX = defaultEntryPoint.position.x;
        spawnZ = defaultEntryPoint.position.z;
        spawnY = defaultEntryPoint.position.y ?? 0;
      } else {
        spawnX = 0;
        spawnZ = 0;
        spawnY = 0;
      }
    }

    return this.resolvePlayerSpawnPosition(spawnX, spawnY, spawnZ);
  }

  public resolvePlayerSpawnPosition(
    x: number,
    y = 0,
    z: number,
  ): { x: number; y: number; z: number } {
    const collisionWorld = this.collisionWorld;
    if (!collisionWorld) {
      throw new Error(`Zone ${this.zoneId} is missing collision world for player spawn placement`);
    }

    const simulator = new PlayerCollisionSimulator(
      collisionWorld.scene,
      `server_player_spawn_probe_${this.zoneId}_${this.spawnProbeSeq++}`,
    );

    try {
      let fallback = this.settlePlayerSpawnCandidate(simulator, x, y, z);
      for (const offset of PLAYER_SPAWN_OFFSETS) {
        const candidate = this.settlePlayerSpawnCandidate(simulator, x + offset.x, y, z + offset.z);
        if (candidate.grounded) {
          return { x: candidate.x, y: candidate.y, z: candidate.z };
        }
        fallback = candidate;
      }

      return { x: fallback.x, y: fallback.y, z: fallback.z };
    } finally {
      simulator.dispose();
    }
  }

  private settlePlayerSpawnCandidate(
    simulator: PlayerCollisionSimulator,
    x: number,
    y: number,
    z: number,
  ): { x: number; y: number; z: number; grounded: boolean } {
    let currentX = x;
    let currentY = y + PLAYER_SPAWN_START_HEIGHT_OFFSET;
    let currentZ = z;
    let velocityY = 0;
    let grounded = false;

    for (let step = 0; step < PLAYER_SPAWN_SETTLE_STEPS; step += 1) {
      const result = simulator.simulateStep({
        currentX,
        currentY,
        currentZ,
        directionX: 0,
        directionZ: 0,
        deltaTimeMs: TICK_MS,
        speed: 0,
        velocityY,
        grounded,
        jumpPressed: false,
      });
      currentX = result.x;
      currentY = result.y;
      currentZ = result.z;
      velocityY = result.velocityY;
      grounded = result.grounded;

      if (grounded && Math.abs(velocityY) <= PLAYER_SPAWN_GROUNDED_VELOCITY_EPSILON) {
        return { x: currentX, y: currentY, z: currentZ, grounded: true };
      }
    }

    return { x: currentX, y: currentY, z: currentZ, grounded };
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
      this.zoneData.collisionWorld,
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
    this.movementController.dispose();
    this.zoneData.collisionWorld?.dispose();
  }
}
