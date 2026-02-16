/* Temporary file to mimic some DB-like functionality for now, to get certain assets that aren't in shared/client like spawn points */

import { ZoneEntryPoint, ZoneSpawnPoint } from "../world/zones/types";

const MOB_SPAWN_POINTS: Record<string, ZoneSpawnPoint<"mob">[]> = {
  startingPlains: [
    {
      templateId: "npc_wanderer_1",
      type: "mob",
      entityData: {
        mobType: "wanderer",
      },
      position: {
        x: -25.47,
        y: 9.16,
        z: 48.69,
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
        x: -39.8,
        y: 9.35,
        z: 47.29,
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
        x: -53.59,
        y: 9.12,
        z: 36.81,
      },
      respawnTime: 10_000,
      countPerSpawn: 2,
      maxCount: 1,
    },
  ],
};

const OBJ_SPAWN_POINTS: Record<string, ZoneSpawnPoint<"obj">[]> = {
  startingPlains: [
    {
      templateId: "obj_1",
      type: "obj",
      entityData: {
        shape: "box",
        size: 1,
        color: { r: 0.5, g: 0.5, b: 0.5 },
      },
      position: {
        x: 39,
        y: 7,
        z: -50,
      },
      respawnTime: 10_000,
      countPerSpawn: 1,
      maxCount: 1,
    },
  ],
};

const ZONE_ENTRY_POINTS: Record<string, ZoneEntryPoint[]> = {
  startingPlains: [
    {
      fromZoneId: "startingPlains",
      position: {
        x: -25,
        y: 5,
        z: 17.71,
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
