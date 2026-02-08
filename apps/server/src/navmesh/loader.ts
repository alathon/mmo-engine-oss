import { NavcatQuery, ZoneDefinition } from "@mmo/shared";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { NavMesh } from "navcat";

/**
 * Loads navmesh data from the shared assets if configured.
 *
 * @returns navmesh query instance or null if no navmesh asset is set.
 */
export async function loadNavmeshFromAssets(definition: ZoneDefinition): Promise<NavcatQuery> {
    const navmeshId = definition.sceneData.navmeshFilePath;
    if (!navmeshId) {
      // Reject promise.
      throw new Error(`No navmesh file path set for zone ${definition.id}`);
    }
  
    const navmeshPath = resolve(
      process.cwd(),
      "../../packages/shared/assets/zones",
      `${definition.id}.navcat.json`
    );
  
    const json = await readFile(navmeshPath, "utf-8");
    const data = JSON.parse(json) as NavMesh;
    return new NavcatQuery(data);
  }
