import { Schema, type } from "@colyseus/schema";

/**
 * Server-side input processing debug metrics for a player.
 */
export class PlayerDebugInfo extends Schema {
  /** Server tick when these values were captured. */
  @type("uint32") serverTick = 0;
  /** Pending inputs before processing this tick. */
  @type("uint32") pendingInputs = 0;
  /** Inputs processed this tick. */
  @type("uint32") processedInputs = 0;
  /** Inputs dropped as stale this tick. */
  @type("uint32") droppedInputs = 0;
  /** Pending inputs remaining after processing. */
  @type("uint32") remainingInputs = 0;
  /** Budget before processing this tick. */
  @type("uint8") budgetBefore = 0;
  /** Budget after processing this tick. */
  @type("uint8") budgetAfter = 0;
}
