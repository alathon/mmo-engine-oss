import { Schema, type } from "@colyseus/schema";
import { AbilityState } from "./ability-state";

/**
 * Shared mob state schema synced to clients.
 * Represents common state for any moving entity.
 */
export class MobState extends Schema {
  /** Unique entity instance identifier. */
  @type("string") id = "";

  /** World X position. */
  @type("float32") x = 0;

  /** World Y position (height). */
  @type("float32") y = 0;

  /** World Z position. */
  @type("float32") z = 0;

  /** Direction the entity is facing (yaw in radians). */
  @type("float32") facingYaw = 0;

  /** Current health points. */
  @type("int32") currentHp = 100;

  /** Maximum health points. */
  @type("int32") maxHp = 100;

  /** Current mana points. */
  @type("int32") mana = 100;

  /** Maximum mana points. */
  @type("int32") maxMana = 100;

  /** Current stamina points. */
  @type("int32") stamina = 100;

  /** Maximum stamina points. */
  @type("int32") maxStamina = 100;

  /** Strength stat (placeholder). */
  @type("int32") strength = 10;

  /** Dexterity stat (placeholder). */
  @type("int32") dexterity = 10;

  /** Intelligence stat (placeholder). */
  @type("int32") intelligence = 10;

  /** Constitution stat (placeholder). */
  @type("int32") constitution = 10;

  /** Display name. */
  @type("string") name = "";

  /** Faction identifier for ally/enemy logic. */
  @type("string") factionId = "";

  /** Server timestamp for remote interpolation. */
  @type("float64") serverTimeMs = 0;

  /** Synced ability state for UI (cast bars, cooldowns). */
  @type(AbilityState) abilityState: AbilityState = new AbilityState();

  /** Whether the entity is currently considered in combat. */
  @type("boolean") inCombat = false;

  /**
   * Current target entity id (empty string when no target).
   */
  @type("string") entityTargetId = "";
}
