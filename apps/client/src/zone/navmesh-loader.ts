import type { NavMesh } from "navcat";

/**
 * Loads a navmesh JSON file and parses it into a Navmesh object.
 *
 * @param url - URL to the navmesh JSON asset.
 * @returns parsed Navmesh data.
 */
export async function loadNavmeshFromUrl(url: string): Promise<NavMesh> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load navmesh: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as NavMesh;
  return data;
}
