import { type } from "@colyseus/schema";
import { MobState } from "./mobState";
import { CombatState } from "./combatState";

/**
 * Synced NPC state schema.
 */
export class NPCState extends MobState {
  /** Mob type/template identifier. */
  @type("string") templateId = "";

  /** Mob type/template identifier. */
  @type("string") mobType = "";

  /** Synced combat state (aggro list). */
  @type(CombatState) combatState: CombatState = new CombatState();
}
