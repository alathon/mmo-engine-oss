import { ArraySchema, type } from "@colyseus/schema";
import { MobState } from "./mob-state";
import { PlayerDebugInfo } from "./player-debug-info";

/**
 * Shared player schema synced to clients.
 */
export class PlayerState extends MobState {
  /** Unique player identifier. */
  @type("string") playerId = "";
  /** Session identifier used by Colyseus. */
  @type("string") sessionId = "";
  /** Authoritative vertical velocity from server movement simulation. */
  @type("float32") velocityY = 0;
  /** Whether the player is grounded in server movement simulation. */
  @type("boolean") grounded = true;
  /** Last processed input sequence number. */
  @type("uint32") lastProcessedSeq = 0;
  /** Whether the player has disconnected but is still present in the zone. */
  @type("boolean") isDisconnected = false;
  /** Server debug metrics for input processing. */
  @type(PlayerDebugInfo) debug: PlayerDebugInfo = new PlayerDebugInfo();

  /**
   * Target ids currently in line of sight of this player.
   */
  @type(["string"]) visibleTargets = new ArraySchema<string>();
}
