import { type NavcatQuery, type ZoneDefinition } from "@mmo/shared";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as database from "../../db/db";
import { loadNavmeshFromAssets } from "../../navmesh/loader";
import {
  loadServerCollisionWorld,
  type ServerCollisionWorld,
} from "../../collision/server-collision-world";
import { ZoneData } from "./zone";

export abstract class ZoneDataLoader {
  abstract load(zoneId: string): Promise<ZoneData>;
}

export class DefaultZoneLoader extends ZoneDataLoader {
  private static readonly ZONES_ASSET_PATH = "../../packages/assets/zones";

  async load(zoneId: string): Promise<ZoneData> {
    try {
      const definition = await this.loadZoneDefinitionFromAssets(zoneId);
      const [navmeshQuery, collisionWorld] = await Promise.all([
        this.loadNavmesh(definition),
        this.loadCollisionWorld(definition),
      ]);
      const zoneData = new ZoneData(zoneId, navmeshQuery, definition, collisionWorld);
      zoneData.entryPoints = database.getZoneEntryPoints(zoneId);
      zoneData.mobSpawnPoints = database.getMobSpawnPoints(zoneId);
      zoneData.objSpawnPoints = database.getObjSpawnPoints(zoneId);
      return zoneData;
    } catch (error) {
      console.error(`Failed to load ZoneData for zone ${zoneId}:`, error);
      throw error;
    }
  }

  protected getZoneAssetsPath(): string {
    return path.resolve(process.cwd(), DefaultZoneLoader.ZONES_ASSET_PATH);
  }

  protected async loadZoneDefinitionFromAssets(zoneId: string): Promise<ZoneDefinition> {
    const zonePath = path.resolve(this.getZoneAssetsPath(), `${zoneId}.glb.zone.json`);
    const json = await readFile(zonePath, "utf8");
    return JSON.parse(json) as ZoneDefinition;
  }

  protected async loadNavmesh(definition: ZoneDefinition): Promise<NavcatQuery> {
    return loadNavmeshFromAssets(definition);
  }

  protected async loadCollisionWorld(definition: ZoneDefinition): Promise<ServerCollisionWorld> {
    const glbFilePath = definition.sceneData.glbFilePath;
    if (!glbFilePath) {
      throw new Error(`No GLB file path configured for zone ${definition.id}`);
    }
    const glbPath = path.resolve(this.getZoneAssetsPath(), glbFilePath);
    return loadServerCollisionWorld(definition.id, glbPath);
  }
}
