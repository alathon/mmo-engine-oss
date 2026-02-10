import type { PlayerState } from "@mmo/shared";
import { ServerMob } from "./server-mob";

export interface QueuedMoveInput {
  directionX: number;
  directionZ: number;
  seq: number;
  tick: number;
  isSprinting: boolean;
  predictedX: number;
  predictedY: number;
  predictedZ: number;
}

/**
 * Server-only player wrapper around synced state.
 */
export class ServerPlayer extends ServerMob<PlayerState> {
  pendingInputs: QueuedMoveInput[] = [];
  /** Accumulated budget of input steps the server may process for this player. */
  inputBudgetTicks = 0;
  /** Offset between client tick numbers and server tick numbers. */
  clientTickOffset?: number;
  /** Whether the server is waiting for a client snap acknowledgement. */
  snapLocked = false;
  /** Target position for the current snap lock. */
  snapTarget?: { x: number; y: number; z: number };
  /** Pending snap message to send to the client. */
  snapPending?: { x: number; y: number; z: number; seq: number };
}
