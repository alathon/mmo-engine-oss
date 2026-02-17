import jwt from "jsonwebtoken";
import { AuthContext, Client } from "colyseus";
import { AuthTokenPayload, PlayerState, toFiniteNumber } from "@mmo/shared-sim";
import { ServerPlayer } from "../entities/player";
import { ZoneRoom } from "./zone-room";
import { logger } from "@mmo/shared-servers";

/**
 * Manages player connection lifecycle within a zone.
 */
export class ZoneConnectionManager {
  private disconnectTimeouts = new Map<string, NodeJS.Timeout>();

  /**
   * Creates a new zone connection manager.
   *
   * @param getSpawnPosition - function for resolving spawn positions.
   * @param resolvePlayerSpawnPosition - function for collision-safe player placement.
   */
  constructor(
    private getSpawnPosition: (fromZone?: string) => {
      x: number;
      y: number;
      z: number;
    },
    private resolvePlayerSpawnPosition: (
      x: number,
      y: number,
      z: number,
    ) => { x: number; y: number; z: number },
  ) {}

  /**
   * Validates auth tokens and attaches identity to the client.
   *
   * @param client - connecting client.
   * @param options - auth options containing token.
   * @return parsed auth payload.
   */
  async onAuth(
    client: Client,
    _options: { zoneId: string },
    context: AuthContext,
  ): Promise<AuthTokenPayload> {
    if (!context.token) {
      throw new Error("Missing auth token.");
    }

    const authPayload = ZoneConnectionManager.parseAuthToken(context.token);
    client.userData = {
      playerId: authPayload.playerId,
      displayName: authPayload.displayName,
    } satisfies ClientUserData;
    return authPayload;
  }

  /**
   * Handles joining and reconnecting players.
   *
   * @param client - joining client.
   * @param options - join options.
   */
  getExistingOrNewPlayer(
    client: Client,
    options: { fromZone?: string },
    zoneRoom: ZoneRoom,
  ): ServerPlayer | undefined {
    const { playerId, displayName } = this.getClientUserData(client);
    const existingPlayer = zoneRoom.state.players.get(playerId);
    if (existingPlayer) {
      const disconnectTimeout = this.disconnectTimeouts.get(playerId);
      if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        this.disconnectTimeouts.delete(playerId);
      }

      const resolved = this.resolvePlayerSpawnPosition(
        existingPlayer.x,
        existingPlayer.y,
        existingPlayer.z,
      );
      existingPlayer.x = resolved.x;
      existingPlayer.y = resolved.y;
      existingPlayer.z = resolved.z;

      existingPlayer.isDisconnected = false;
      existingPlayer.sessionId = client.sessionId;
      return;
    }

    const spawnPos = this.getSpawnPosition(options?.fromZone);

    const playerState = new PlayerState();
    playerState.playerId = playerId;
    playerState.sessionId = client.sessionId;
    playerState.name = displayName;
    playerState.id = playerId;
    playerState.factionId = "players";
    playerState.facingYaw = 0;
    playerState.maxHp = 100;
    playerState.currentHp = 100;
    playerState.maxMana = 100;
    playerState.mana = 100;
    playerState.maxStamina = 100;
    playerState.stamina = 100;
    playerState.strength = ZoneConnectionManager.rollStat();
    playerState.dexterity = ZoneConnectionManager.rollStat();
    playerState.intelligence = ZoneConnectionManager.rollStat();
    playerState.constitution = ZoneConnectionManager.rollStat();
    playerState.x = spawnPos.x;
    playerState.y = spawnPos.y;
    playerState.z = spawnPos.z;
    playerState.isDisconnected = false;

    const serverPlayer = new ServerPlayer(playerState);
    return serverPlayer;
  }

  private static rollStat(): number {
    return Math.floor(Math.random() * 13) + 6;
  }

  /**
   * Handles disconnecting players with a grace period.
   *
   * @param client - leaving client.
   * @param consented - whether the client consented to leaving.
   */
  onLeave(client: Client, consented: boolean, zoneRoom: ZoneRoom): void {
    logger.info({ sessionId: client.sessionId, consented }, "Client left ZoneRoom");

    const { playerId } = this.getClientUserData(client);
    const playerState = zoneRoom.state.players.get(playerId);
    if (!playerState) {
      return;
    }

    playerState.isDisconnected = true;
    playerState.sessionId = "";

    if (this.disconnectTimeouts.has(playerId)) {
      return;
    }

    const timeout = setTimeout(() => {
      zoneRoom.state.players.delete(playerId);
      this.disconnectTimeouts.delete(playerId);
    }, ZoneConnectionManager.getDisconnectGraceMs());

    this.disconnectTimeouts.set(playerId, timeout);
  }

  /**
   * Disposes timers associated with this manager.
   */
  dispose(): void {
    for (const timeout of this.disconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.disconnectTimeouts.clear();
  }

  /**
   * Returns the client identity attached during auth.
   *
   * @param client - target client.
   * @return client user data.
   */
  getClientUserData(client: Client): ClientUserData {
    const userData = client.userData;
    if (!userData || typeof userData !== "object") {
      throw new Error("Missing client user data.");
    }

    const record = userData as { playerId?: unknown; displayName?: unknown };
    const playerId = typeof record.playerId === "string" ? record.playerId : "";
    const displayName = typeof record.displayName === "string" ? record.displayName : "";

    if (!playerId || !displayName) {
      throw new Error("Missing client user data.");
    }

    return { playerId, displayName };
  }

  private static getDisconnectGraceMs(): number {
    const value = process.env.PLAYER_DISCONNECT_GRACE_MS;
    if (!value) {
      return 2 * 60 * 1000;
    }

    return Math.max(1, toFiniteNumber(value, 2 * 60 * 1000));
  }

  private static getAuthTokenSecret(): string {
    const secret = process.env.AUTH_TOKEN_SECRET;
    if (secret && secret.length > 0) {
      return secret;
    }

    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_TOKEN_SECRET must be set in production.");
    }

    return "dev-secret";
  }

  private static parseAuthToken(token: string): AuthTokenPayload {
    const payload = jwt.verify(token, ZoneConnectionManager.getAuthTokenSecret());

    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid auth token payload.");
    }

    const playerId = typeof payload.playerId === "string" ? payload.playerId : "";
    const displayName = typeof payload.displayName === "string" ? payload.displayName : "";

    if (!playerId || !displayName) {
      throw new Error("Auth token missing required fields.");
    }

    return { playerId, displayName };
  }
}

interface ClientUserData {
  playerId: string;
  displayName: string;
}
