import { ZoneDefinition } from "@mmo/shared";
import startingPlainsNavcatUrl from "@mmo/shared/assets/zones/startingPlains.navcat.json?url";
import startingPlainsZoneDefinition from "@mmo/shared/assets/zones/startingPlains.zone.json";

const NAVCAT_ASSETS: Record<string, string> = {
  "startingPlains": startingPlainsNavcatUrl,
};

const ZONE_DEFINITIONS: Record<string, ZoneDefinition> = {
  "startingPlains": startingPlainsZoneDefinition as ZoneDefinition,
};

/**
 * Returns the navcat asset URL for a given navmesh ID.
 *
 * @param zoneId - navmesh asset identifier.
 * @returns asset URL string, or null if not found.
 */
export function getNavcatAssetUrl(zoneId: string): string | null {
  return NAVCAT_ASSETS[zoneId] ?? null;
}

/**
 * Returns the zone definition for a given zone ID.
 *
 * @param zoneId - zone identifier.
 * @returns zone definition, or null if not found.
 */
export function getZoneDefinition(zoneId: string): ZoneDefinition | null {
  return ZONE_DEFINITIONS[zoneId] ?? null;
}