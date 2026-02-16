import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NavcatQuery } from "@mmo/shared";
import type { NavMesh } from "navcat";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
let cached: NavcatQuery | undefined;

export const createTestNavmeshQuery = (): NavcatQuery => {
  if (cached) {
    return cached;
  }
  const navmeshPath = path.resolve(
    currentDir,
    "../../../packages/assets/zones/startingPlains.navcat.json",
  );
  const json = readFileSync(navmeshPath, "utf8");
  const data = JSON.parse(json) as NavMesh;
  cached = new NavcatQuery(data);
  return cached;
};
