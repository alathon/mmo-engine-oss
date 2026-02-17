import { Schema, type } from "@colyseus/schema";

/**
 * Synced ability timing state for any ability user.
 */
export class AbilityState extends Schema {
  /** Global cooldown end time (ms). */
  @type("float64") gcdEndTimeMs = 0;

  /** Internal cooldown end time (ms). */
  @type("float64") internalCooldownEndTimeMs = 0;

  /** Current cast start time (ms). */
  @type("float64") castStartTimeMs = 0;

  /** Current cast end time (ms). */
  @type("float64") castEndTimeMs = 0;

  /** Ability id currently being cast. */
  @type("string") castAbilityId = "";
  /** Server-assigned cast id for the active cast (0 when idle). */
  @type("uint32") castId = 0;

  /** Server time (ms) of the last hostile ability action involving this entity. */
  @type("float64") lastHostileActionTimeMs = 0;

  public isGcdReady(serverTimeMs: number): boolean {
    return this.gcdEndTimeMs <= serverTimeMs;
  }

  public isInternalCooldownActive(serverTimeMs: number): boolean {
    return serverTimeMs <= this.internalCooldownEndTimeMs;
  }

  public isCasting(serverTimeMs: number): boolean {
    return (
      this.castStartTimeMs <= serverTimeMs && serverTimeMs <= this.castEndTimeMs
    );
  }
}
