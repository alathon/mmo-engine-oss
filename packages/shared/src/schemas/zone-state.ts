import { Schema, MapSchema, type } from "@colyseus/schema";
import { PlayerState } from "./player-state";
import { ObjState } from "./obj-state";
import { NPCState } from "./npc-state";

/**
 * World state schema synced to clients.
 * Contains all entities in the current zone.
 */
export class ZoneState extends Schema {
  /** The zone ID this room represents. */
  @type("string") zoneId = "";

  /** Player entities in the zone. */
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();

  /** Static objects in the zone. */
  @type({ map: ObjState }) objects = new MapSchema<ObjState>();

  /** NPC entities in the zone. */
  @type({ map: NPCState }) npcs = new MapSchema<NPCState>();
}
