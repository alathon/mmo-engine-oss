import { type NavcatQuery, type ZoneDefinition } from "@mmo/shared";
import { readFile } from "fs/promises";
import { resolve } from "path";
import * as db from "../../db/db";
import { loadNavmeshFromAssets } from "../../navmesh/loader";
import { ZoneData } from "./zone";

export abstract class ZoneDataLoader {
  abstract load(zoneId: string): Promise<ZoneData>;
}

export class DefaultZoneLoader extends ZoneDataLoader {
  private static readonly ZONES_ASSET_PATH = "../../packages/shared/assets/zones";

  async load(zoneId: string): Promise<ZoneData> {
    try {
      const zoneData = new ZoneData(zoneId);
      zoneData.definition = await this.loadZoneDefinitionFromAssets(zoneId);
      zoneData.entryPoints = db.getZoneEntryPoints(zoneId);
      zoneData.mobSpawnPoints = db.getMobSpawnPoints(zoneId);
      zoneData.objSpawnPoints = db.getObjSpawnPoints(zoneId);
      zoneData.navmeshQuery = await this.loadNavmesh(zoneData.definition);
      return zoneData;
    } catch (error) {
      console.error(`Failed to load ZoneData for zone ${zoneId}:`, error);
      throw error;
    }
  }

  protected async loadZoneDefinitionFromAssets(
    zoneId: string,
  ): Promise<ZoneDefinition> {
    const zonePath = resolve(
      process.cwd(),
      DefaultZoneLoader.ZONES_ASSET_PATH,
      `${zoneId}.zone.json`,
    );
    const json = await readFile(zonePath, "utf-8");
    return JSON.parse(json) as ZoneDefinition;
  }

  protected async loadNavmesh(
    definition: ZoneDefinition,
  ): Promise<NavcatQuery> {
    return loadNavmeshFromAssets(definition);
  }
}
