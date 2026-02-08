// Client-to-Server messages
export interface MoveMessage {
  /** Normalized movement direction X. */
  directionX: number;
  /** Normalized movement direction Z. */
  directionZ: number;
  /** Normalized movement direction Y. */
  directionY: number;
  /** Client input sequence number. */
  seq: number;
  /** Client tick number. */
  tick: number;
  /** Whether the player is sprinting. */
  isSprinting: boolean;
  /** Client-predicted X position after applying this input. */
  predictedX: number;
  /** Client-predicted Y position after applying this input. */
  predictedY: number;
  /** Client-predicted Z position after applying this input. */
  predictedZ: number;
}

export interface TargetChangeMessage {
  /** Target entity id to select (omit or empty string to clear). */
  targetEntityId?: string;
}

export type ClientMessage =
  | {
      type: "move";
      payload: MoveMessage;
    }
  | {
      type: "target_change";
      payload: TargetChangeMessage;
    };

export type ChatChannel = "global" | "party" | "guild" | "whisper";

export interface ChatMessage {
  channel?: ChatChannel;
  message: string;
  recipientId?: string;
}

// Server-to-Client messages
export interface ChatBroadcast {
  channel: ChatChannel;
  senderId: string;
  senderName: string;
  message: string;
  recipientId?: string;
}

export interface SnapMessage {
  x: number;
  y: number;
  z: number;
  seq: number;
}
