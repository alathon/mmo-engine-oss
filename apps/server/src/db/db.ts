/* Temporary file to mimic some DB-like functionality for now, to get certain assets that aren't in shared/client like spawn points */

import { ZoneEntryPoint, ZoneSpawnPoint } from "../world/zones/types";

const MOB_SPAWN_POINTS: Record<string, ZoneSpawnPoint<"mob">[]> = {
  "startingPlains": [
    {
      templateId: "npc_wanderer_1",
      type: "mob",
      entityData: {
        mobType: "wanderer",
      },
      position: {
        x: 6,
        y: 0,
        z: 8,
      },
      respawnTime: 10_000,
      countPerSpawn: 1,
      maxCount: 3,
    },
    {
      templateId: "npc_wanderer_2",
      type: "mob",
      entityData: {
        mobType: "wanderer",
      },
      position: {
        x: -6,
        y: 0,
        z: -8,
      },
      respawnTime: 10_000,
      countPerSpawn: 1,
      maxCount: 1,
    },
    {
      templateId: "npc_wanderer_3",
      type: "mob",
      entityData: {
        mobType: "wanderer",
      },
      position: {
        x: 12,
        y: 0,
        z: -12,
      },
      respawnTime: 10_000,
      countPerSpawn: 2,
      maxCount: 1,
    },
  ],
};

const OBJ_SPAWN_POINTS: Record<string, ZoneSpawnPoint<"obj">[]> = {
  "startingPlains": [
    {
      templateId: "obj_1",
      type: "obj",
      entityData: {
        shape: "box",
        size: 1,
        color: { r: 0.5, g: 0.5, b: 0.5 },
      },
      position: {
        x: 0,
        y: 0,
        z: 0,
      },
      respawnTime: 10_000,
      countPerSpawn: 1,
      maxCount: 1,
    },
  ],
};

const ZONE_ENTRY_POINTS: Record<string, ZoneEntryPoint[]> = {
  "startingPlains": [
    {
      fromZoneId: "startingPlains",
      position: {
        x: 0,
        y: 0,
        z: 0,
      },
    },
  ],
};

export const getMobSpawnPoints = (zoneId: string): ZoneSpawnPoint<"mob">[] => {
  return MOB_SPAWN_POINTS[zoneId] ?? [];
};

export const getObjSpawnPoints = (zoneId: string): ZoneSpawnPoint<"obj">[] => {
  return OBJ_SPAWN_POINTS[zoneId] ?? [];
};

export const getZoneEntryPoints = (zoneId: string): ZoneEntryPoint[] => {
  return ZONE_ENTRY_POINTS[zoneId] ?? [];
};
