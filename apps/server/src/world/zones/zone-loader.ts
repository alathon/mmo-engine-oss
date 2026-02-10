import { type NavcatQuery, type ZoneDefinition } from "@mmo/shared";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as database from "../../db/db";
import { loadNavmeshFromAssets } from "../../navmesh/loader";
import { ZoneData } from "./zone";

export abstract class ZoneDataLoader {
  abstract load(zoneId: string): Promise<ZoneData>;
}

export class DefaultZoneLoader extends ZoneDataLoader {
  private static readonly ZONES_ASSET_PATH =
    "../../packages/shared/assets/zones";

  async load(zoneId: string): Promise<ZoneData> {
    try {
      const definition = await this.loadZoneDefinitionFromAssets(zoneId);
      const navmeshQuery = await this.loadNavmesh(definition);
      const zoneData = new ZoneData(zoneId, navmeshQuery, definition);
      zoneData.entryPoints = database.getZoneEntryPoints(zoneId);
      zoneData.mobSpawnPoints = database.getMobSpawnPoints(zoneId);
      zoneData.objSpawnPoints = database.getObjSpawnPoints(zoneId);
      return zoneData;
    } catch (error) {
      console.error(`Failed to load ZoneData for zone ${zoneId}:`, error);
      throw error;
    }
  }

  protected async loadZoneDefinitionFromAssets(
    zoneId: string,
  ): Promise<ZoneDefinition> {
    const zonePath = path.resolve(
      process.cwd(),
      DefaultZoneLoader.ZONES_ASSET_PATH,
      `${zoneId}.zone.json`,
    );
    const json = await readFile(zonePath, "utf8");
    return JSON.parse(json) as ZoneDefinition;
  }

  protected async loadNavmesh(
    definition: ZoneDefinition,
  ): Promise<NavcatQuery> {
    return loadNavmeshFromAssets(definition);
  }
}
