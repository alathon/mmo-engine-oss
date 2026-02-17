import { NPCState } from "@mmo/shared-sim";
import { ServerNPC } from "../entities/npc";
import { ZoneData, ServerZone } from "./zone";
import { ZoneSpawnPoint } from "./types";

export class ZoneLifecycle {
  // Keep track of time since last spawn of each spawn point.
  private lastSpawnTime: Record<string, number> = {};
  private elapsedTimeMs = 0;
  private zoneData!: ZoneData;
  private zone!: ServerZone;

  /**
   * Initializes lifecycle state from the owning zone.
   *
   * @param zone - owning server zone.
   * @param resetStartedAt - unused placeholder for future use.
   */
  public initializeFromZone(zone: ServerZone): void {
    this.zoneData = zone.zoneData;
    this.zone = zone;
    this.lastSpawnTime = {};
  }

  /**
   * Updates spawn timers and lifecycle systems.
   *
   * @param deltaTimeMs - elapsed time since last update in milliseconds.
   */
  public update(deltaTimeMs: number): void {
    // Only check for spawns once per second.
    this.elapsedTimeMs += deltaTimeMs;
    if (this.elapsedTimeMs % 1000 !== 0) {
      return;
    }

    // The below is pretty inefficient to have to calculate every time we check...
    const templateIdCounts = new Map<string, number>();
    for (const npc of this.zone.npcs.values()) {
      templateIdCounts.set(
        npc.synced.templateId,
        (templateIdCounts.get(npc.synced.templateId) ?? 0) + 1,
      );
    }
    //console.log(`templateIdCounts: ${JSON.stringify(templateIdCounts)}`);

    for (const spawnPoint of this.zoneData.mobSpawnPoints) {
      const templateId = spawnPoint.templateId;
      let spawnTime = spawnPoint.respawnTime;

      if (this.lastSpawnTime[templateId] === undefined) {
        this.lastSpawnTime[templateId] = 0;
        // If we've never spawned before, use spawnDelay.
        spawnTime = spawnPoint.spawnDelay ?? 0;
      }

      if (this.lastSpawnTime[templateId] + spawnTime < this.elapsedTimeMs) {
        const currentCount = templateIdCounts.get(templateId) ?? 0;

        if (currentCount < spawnPoint.maxCount) {
          // Spawn an NPC
          const id = `${spawnPoint.templateId}_${currentCount + 1}`;
          const npc = this.spawnNpc(spawnPoint, id);
          for (const callback of this.onNpcSpawnedCallbacks) {
            callback(npc);
          }
          templateIdCounts.set(templateId, currentCount + 1);
          this.lastSpawnTime[templateId] = this.elapsedTimeMs;
        }
      }
    }

    // TODO: obj spawns
  }

  private onNpcSpawnedCallbacks: ((npc: ServerNPC) => void)[] = [];

  /**
   * Registers a callback for NPC spawn events.
   *
   * @param callback - invoked when an NPC is spawned.
   */
  public onNpcSpawned(callback: (npc: ServerNPC) => void): void {
    this.onNpcSpawnedCallbacks.push(callback);
  }

  private spawnNpc(spawnPoint: ZoneSpawnPoint<"mob">, id: string): ServerNPC {
    const mobState = new NPCState();
    mobState.id = id;
    mobState.templateId = spawnPoint.templateId;
    mobState.factionId = "npcs";
    mobState.x = spawnPoint.position.x;
    mobState.y = spawnPoint.position.y;
    mobState.z = spawnPoint.position.z;
    mobState.facingYaw = 0;
    mobState.currentHp = 100;
    mobState.maxHp = 100;
    mobState.maxMana = 100;
    mobState.mana = 100;
    mobState.maxStamina = 100;
    mobState.stamina = 100;
    mobState.strength = ZoneLifecycle.rollStat();
    mobState.dexterity = ZoneLifecycle.rollStat();
    mobState.intelligence = ZoneLifecycle.rollStat();
    mobState.constitution = ZoneLifecycle.rollStat();
    mobState.name = spawnPoint.templateId;
    mobState.mobType = spawnPoint.entityData.mobType;
    return new ServerNPC(mobState);
  }

  private static rollStat(): number {
    return Math.floor(Math.random() * 13) + 6;
  }
}
