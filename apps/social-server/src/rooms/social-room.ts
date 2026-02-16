import { Room, Client, CloseCode } from "colyseus";
import jwt from "jsonwebtoken";
import { ChatBroadcast, ChatChannel, ChatMessage, AuthTokenPayload } from "@mmo/shared";
import { SocialState } from "./schema/social-state";
import { logger } from "@mmo/shared-servers";
import { AuthContext } from "@colyseus/core";

const MAX_MESSAGE_LENGTH = 200;

const getAuthTokenSecret = (): string => {
  return process.env.AUTH_TOKEN_SECRET || "dev-secret";
};

const parseAuthToken = (token: string): AuthTokenPayload => {
  const payload = jwt.verify(token, getAuthTokenSecret());

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid auth token payload.");
  }

  const playerId = typeof payload.playerId === "string" ? payload.playerId : "";
  const displayName = typeof payload.displayName === "string" ? payload.displayName : "";

  if (!playerId || !displayName) {
    throw new Error("Auth token missing required fields.");
  }

  return { playerId, displayName };
};

const normalizeChatChannel = (value: unknown): ChatChannel => {
  if (value === "party" || value === "guild" || value === "whisper") {
    return value;
  }

  return "global";
};

/**
 * Social room handling chat and social messaging.
 */
export class SocialRoom extends Room<{ state: SocialState }> {
  private authBySessionId = new Map<string, AuthTokenPayload>();
  state: SocialState = new SocialState();

  onCreate(_options: unknown) {
    this.onMessage("chat", (client, data: ChatMessage) => {
      const auth = this.authBySessionId.get(client.sessionId);
      if (!auth) return;

      const rawMessage = typeof data?.message === "string" ? data.message : "";
      const message = rawMessage.trim().slice(0, MAX_MESSAGE_LENGTH);

      if (!message) return;

      const channel = normalizeChatChannel(data?.channel);
      const chatBroadcast: ChatBroadcast = {
        channel,
        message,
        senderId: auth.playerId,
        senderName: auth.displayName,
        recipientId: data?.recipientId,
      };

      this.broadcast("chat", chatBroadcast);
    });

    logger.info("SocialRoom created");
  }

  async onAuth(client: Client, options: object, context: AuthContext): Promise<AuthTokenPayload> {
    try {
      if (!context.token) {
        throw new Error("Missing auth token.");
      }
      const authPayload = parseAuthToken(context.token);
      this.authBySessionId.set(client.sessionId, authPayload);
      return authPayload;
    } catch (error) {
      if (error instanceof Error && error.message) {
        throw new Error(error.message);
      }
      throw new Error("Invalid auth token.");
    }
  }

  onJoin(client: Client, _options: unknown) {
    logger.info({ sessionId: client.sessionId }, "Client joined SocialRoom");
  }

  onLeave(client: Client, code: number) {
    const consented = code === CloseCode.CONSENTED;
    this.authBySessionId.delete(client.sessionId);
    logger.info({ sessionId: client.sessionId }, "Client left SocialRoom");
  }

  onDispose() {
    logger.info("SocialRoom disposing");
  }
}
