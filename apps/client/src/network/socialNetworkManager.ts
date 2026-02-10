import { Client, Room } from "@colyseus/sdk";
import {
  ChatBroadcast,
  ChatChannel,
  ChatMessage,
  toFiniteNumber,
} from "@mmo/shared";
import { ChatEventSource } from "../ui/widgets/chat/chatEventSource";

const SIMULATED_LATENCY_MS = toFiniteNumber(
  import.meta.env.VITE_SIMULATED_LATENCY_MS,
  0,
);

/**
 * Connection options for the social server.
 */
export interface SocialConnectionOptions {
  token: string;
}

export type ChatMessageCallback = (
  channel: ChatChannel,
  playerId: string,
  playerName: string,
  message: string,
) => void;

/**
 * Manages the social/chat network connection.
 */
export class SocialNetworkManager implements ChatEventSource {
  private client?: Client;
  private room?: Room;
  private chatMessageCallback?: ChatMessageCallback;
  private systemMessageCallback?: (message: string) => void;
  private isInitialized = false;

  public get initialized(): boolean {
    return this.isInitialized;
  }

  async initialize(options: SocialConnectionOptions): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const serverUrl =
        import.meta.env.VITE_SOCIAL_SERVER_URL || "ws://localhost:2568";
      this.client = new Client(serverUrl);
      this.client.auth.token = options.token;
      this.room = await this.client.joinOrCreate("social", {});
      console.debug("SocialNetworkManager connected", {
        sessionId: this.room.sessionId,
      });
      this.systemMessageCallback?.("Connected to social server");

      this.setupRoomHandlers();
    } catch (error) {
      console.error("Failed to connect to social server:", error);
      this.systemMessageCallback?.("Failed to connect to social server");
    }

    this.isInitialized = true;
  }

  sendChatMessage(message: string, channel: ChatChannel = "global"): void {
    if (!this.room) return;

    const payload: ChatMessage = { message, channel };
    if (SIMULATED_LATENCY_MS > 0) {
      window.setTimeout(() => {
        this.room?.send("chat", payload);
      }, SIMULATED_LATENCY_MS);
      return;
    }

    this.room.send("chat", payload);
  }

  onChatMessage(callback: ChatMessageCallback): void {
    this.chatMessageCallback = callback;
  }

  onSystemMessage(callback: (message: string) => void): void {
    this.systemMessageCallback = callback;
  }

  onMessage(
    callback: (playerId: string, playerName: string, message: string) => void,
  ): void {
    this.onChatMessage((_channel, playerId, playerName, message) => {
      callback(playerId, playerName, message);
    });
  }

  sendMessage(message: string): void {
    this.sendChatMessage(message);
  }

  /**
   * Tears down network resources and callbacks.
   */
  public dispose(): void {
    this.room?.leave();
    this.room = undefined;
    this.chatMessageCallback = undefined;
    this.systemMessageCallback = undefined;
    this.isInitialized = false;
  }

  private setupRoomHandlers(): void {
    if (!this.room) return;

    this.room.onMessage("chat", (data: ChatBroadcast) => {
      if (SIMULATED_LATENCY_MS > 0) {
        window.setTimeout(() => {
          this.chatMessageCallback?.(
            data.channel,
            data.senderId,
            data.senderName,
            data.message,
          );
        }, SIMULATED_LATENCY_MS);
        return;
      }

      this.chatMessageCallback?.(
        data.channel,
        data.senderId,
        data.senderName,
        data.message,
      );
    });

    this.room.onError((code, message) => {
      console.error("Social room error:", code, message);
      this.systemMessageCallback?.(`Error: ${message}`);
    });

    this.room.onLeave((code) => {
      console.log("Left social room:", code);
      this.systemMessageCallback?.("Disconnected from social server");
    });
  }
}
