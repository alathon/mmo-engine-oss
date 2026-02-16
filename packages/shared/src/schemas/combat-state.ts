import { MapSchema, Schema, type } from "@colyseus/schema";

/**
 * Synced per-target aggro percentage entry.
 * Percentage values are relative to the current top aggro target (100%).
 */
export class AggroEntry extends Schema {
  /** Relative aggro percentage (0-100). */
  @type("uint8") percent = 0;
}

/**
 * Synced combat state for NPCs.
 * Contains a relative aggro list (percentages only).
 */
export class CombatState extends Schema {
  /**
   * Relative aggro entries by target id.
   */
  @type({ map: AggroEntry }) aggro = new MapSchema<AggroEntry>();
}
