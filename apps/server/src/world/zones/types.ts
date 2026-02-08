export type EntityType = "mob" | "obj";

export interface ZoneEntryPoint {
  /** The zone ID the player is coming from. */
  fromZoneId: string;

  /** Position where the player spawns. */
  position: {
    x: number;
    y: number;
    z: number;
  };
}

/** A spawn definition for a mob or object. Used by the Zone lifecycle to spawn entity
 *  at appropriate times / amounts.
 */
export interface ZoneSpawnPoint<T extends EntityType> {
  templateId: string;
  type: T;
  // TODO: Replace below with entityId and look up in entity database.
  // Also this only supports objs atm as its the object fields below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entityData: any;
  position: { x: number; y: number; z: number };
  /** Respawn time in milliseconds. */
  respawnTime: number;
  /** Optional spawn delay in milliseconds. */
  spawnDelay?: number;
  // Count
  countPerSpawn: number;
  // Max count
  maxCount: number;
}

export interface MobSpawnPoint extends ZoneSpawnPoint<"mob"> {
  entityData: {
    mobType: string;
  };
}

export interface ObjSpawnPoint extends ZoneSpawnPoint<"obj"> {
  entityData: {
    shape: "box" | "sphere" | "cylinder";
    size: number;
    color: { r: number; g: number; b: number };
    label?: string;
    pickable?: boolean;
    collidable?: boolean;
  };
}
