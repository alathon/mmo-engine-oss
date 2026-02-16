import { NavcatQuery, ZoneDefinition } from "@mmo/shared";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NavMesh } from "navcat";

/**
 * Loads navmesh data from the shared assets if configured.
 *
 * @returns navmesh query instance when navmesh data is available.
 */
export async function loadNavmeshFromAssets(definition: ZoneDefinition): Promise<NavcatQuery> {
  const navmeshId = definition.sceneData.navmeshFilePath;
  if (!navmeshId) {
    throw new Error(`No navmesh file path set for zone ${definition.id}`);
  }

  const navmeshPath = path.resolve(
    process.cwd(),
    "../../packages/assets/zones",
    `${definition.id}.navcat.json`,
  );

  const json = await readFile(navmeshPath, "utf8");
  const data = JSON.parse(json) as NavMesh;
  return new NavcatQuery(data);
}
