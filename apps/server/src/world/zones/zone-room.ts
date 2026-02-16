import {
  ZoneState,
  MoveMessage,
  AuthTokenPayload,
  TICK_MS,
  SnapMessage,
  AbilityUseRequest,
  AbilityCancelRequest,
  TargetChangeMessage,
  DEFAULT_EVENT_RANGE,
  type EventLogEntry,
  type EventStreamBatch,
  type EventStreamResyncRequest,
  type EventStreamResyncResponse,
} from "@mmo/shared";
import { Room, Client, CloseCode, AuthContext } from "colyseus";
import * as CommandHandler from "../../commands/commands";
import { ServerZone, ZoneData } from "./zone";
import { ZoneConnectionManager } from "./zone-connection-manager";
import { logger } from "@mmo/shared-servers";
import type { EventLogBuffer } from "../../eventLog";

export class ZoneRoom extends Room<{ state: ZoneState }> {
  state: ZoneState = new ZoneState();
  maxClients = 100;
  autoDispose = false;

  private connectionManager!: ZoneConnectionManager;
  private zone!: ServerZone;
  private lastBroadcastEventId = 0;
  private readonly clientEventCursors = new Map<string, number>();

  async onCreate(options: { zoneData: ZoneData }) {
    const zoneData = options.zoneData;
    if (!zoneData) {
      throw new Error("Failed to create zone data.");
    }
    this.state.zoneId = zoneData.zoneId;
    const serverZone = new ServerZone(zoneData, this.state);
    this.zone = serverZone;

    this.connectionManager = new ZoneConnectionManager(
      serverZone.zoneData.getSpawnPosition.bind(serverZone.zoneData),
      serverZone.zoneData.resolvePlayerSpawnPosition.bind(serverZone.zoneData),
    );

    let elapsedTimeMs = 0;
    this.setSimulationInterval((deltaTime) => {
      const now = Date.now();
      elapsedTimeMs += deltaTime;
      while (elapsedTimeMs >= TICK_MS) {
        elapsedTimeMs -= TICK_MS;
        this.fixedTick(now, TICK_MS);
      }
    });

    // Bind messages
    this.onMessage("move", (client, data: MoveMessage) => {
      //console.log(`Received move message from client ${client.sessionId}`);
      const player = serverZone.players.get(
        this.connectionManager.getClientUserData(client).playerId,
      );
      if (!player) {
        console.warn(`Player not found for client ${client.sessionId}`);
        return;
      }

      const context: CommandHandler.ClientCommandContext<MoveMessage> = {
        client,
        data,
        player,
        zone: this.zone,
      };

      CommandHandler.moveCommand(context);
    });

    this.onMessage("ability_use", (client, data: AbilityUseRequest) => {
      const player = serverZone.players.get(
        this.connectionManager.getClientUserData(client).playerId,
      );
      if (!player) {
        console.warn(`Player not found for client ${client.sessionId}`);
        return;
      }

      CommandHandler.useAbilityCommand({
        client,
        data,
        player,
        zone: this.zone,
      });
    });

    this.onMessage("ability_cancel", (client, data: AbilityCancelRequest) => {
      const player = serverZone.players.get(
        this.connectionManager.getClientUserData(client).playerId,
      );
      if (!player) {
        console.warn(`Player not found for client ${client.sessionId}`);
        return;
      }

      CommandHandler.cancelAbilityCommand({
        client,
        data,
        player,
        zone: this.zone,
      });
    });

    this.onMessage("target_change", (client, data: TargetChangeMessage) => {
      const player = serverZone.players.get(
        this.connectionManager.getClientUserData(client).playerId,
      );
      if (!player) {
        console.warn(`Player not found for client ${client.sessionId}`);
        return;
      }

      CommandHandler.changeTargetCommand({
        client,
        data,
        player,
        zone: this.zone,
      });
    });

    this.onMessage("event_stream_resync_request", (client, data: EventStreamResyncRequest) => {
      this.handleEventStreamResync(client, data);
    });

    logger.info({ zoneId: this.zone.zoneData.zoneId }, "ZoneRoom created");
  }

  fixedTick(time: number, tickMs: number) {
    // Update zone state
    this.zone.fixedTick(time, tickMs);
    this.flushSnapMessages();
    this.flushEventStream();
  }

  async onAuth(
    client: Client,
    options: { zoneId: string },
    context: AuthContext,
  ): Promise<AuthTokenPayload> {
    return await this.connectionManager.onAuth(client, options, context);
  }

  async onJoin(client: Client, options: { fromZone?: string }) {
    const serverPlayer = this.connectionManager.getExistingOrNewPlayer(client, options, this);
    if (serverPlayer) {
      this.zone.players.set(serverPlayer.synced.id, serverPlayer);
      this.state.players.set(serverPlayer.synced.id, serverPlayer.synced);
      logger.info(
        { playerId: serverPlayer.synced.id, zoneId: this.zone.zoneData.zoneId },
        "Player joined zone",
      );
    }

    const { playerId } = this.connectionManager.getClientUserData(client);
    if (!this.clientEventCursors.has(playerId)) {
      const latest = this.zone.eventLog.getBuffer().latestSeq ?? 0;
      this.clientEventCursors.set(playerId, latest);
    }
  }

  async onLeave(client: Client, code: number) {
    const consented = code === CloseCode.CONSENTED;
    const { playerId } = this.connectionManager.getClientUserData(client);
    this.clientEventCursors.delete(playerId);
    this.connectionManager.onLeave(client, consented, this);
  }

  onDispose() {
    this.zone.dispose();
    return this.connectionManager.dispose();
  }

  private flushSnapMessages(): void {
    for (const player of this.zone.players.values()) {
      const pending = player.snapPending;
      if (!pending) {
        continue;
      }

      const client = this.clients.find(
        (candidate) => candidate.sessionId === player.synced.sessionId,
      );
      if (client) {
        const payload: SnapMessage = pending;
        client.send("snap", payload);
      }
      player.snapPending = undefined;
    }
  }

  private flushEventStream(): void {
    const buffer = this.zone.eventLog.getBuffer();
    const range = buffer.getSince(this.lastBroadcastEventId);
    if (!range) {
      this.lastBroadcastEventId = buffer.latestSeq ?? this.lastBroadcastEventId;
      return;
    }

    if (range.toSeq <= this.lastBroadcastEventId) {
      return;
    }

    this.lastBroadcastEventId = range.toSeq;
    if (range.entries.length === 0) {
      return;
    }

    const maxRangeSq = DEFAULT_EVENT_RANGE * DEFAULT_EVENT_RANGE;

    for (const client of this.clients) {
      let playerId: string;
      try {
        playerId = this.connectionManager.getClientUserData(client).playerId;
      } catch {
        continue;
      }
      const player = this.zone.players.get(playerId);
      if (!player) {
        continue;
      }

      const relevant: EventLogEntry[] = [];
      const px = player.synced.x;
      const py = player.synced.y;
      const pz = player.synced.z;

      for (const entry of range.entries) {
        const source = entry.sourceLocation;
        if (!source) {
          relevant.push(entry);
          continue;
        }
        const dx = source.x - px;
        const dy = source.y - py;
        const dz = source.z - pz;
        const distributionSq = dx * dx + dy * dy + dz * dz;
        if (distributionSq <= maxRangeSq) {
          relevant.push(entry);
        }
      }

      if (relevant.length === 0) {
        continue;
      }

      const lastSent = this.clientEventCursors.get(playerId) ?? 0;
      const fromEventId = lastSent + 1;
      const toEventId = range.toSeq;
      if (fromEventId > toEventId) {
        this.clientEventCursors.set(playerId, toEventId);
        continue;
      }

      const payload: EventStreamBatch = {
        type: "event_stream_batch",
        fromEventId,
        toEventId,
        serverTick: this.zone.getServerTick(),
        events: relevant,
      };

      client.send("event_stream_batch", payload);
      this.clientEventCursors.set(playerId, toEventId);
    }
  }

  private handleEventStreamResync(client: Client, data: EventStreamResyncRequest): void {
    const buffer = this.zone.eventLog.getBuffer();
    const range = buffer.getSince(data.sinceEventId) ?? this.getFallbackResyncRange(buffer);

    if (!range) {
      return;
    }

    let playerId: string;
    try {
      playerId = this.connectionManager.getClientUserData(client).playerId;
    } catch {
      return;
    }
    const player = this.zone.players.get(playerId);
    if (!player) {
      return;
    }

    const maxRangeSq = DEFAULT_EVENT_RANGE * DEFAULT_EVENT_RANGE;
    const px = player.synced.x;
    const py = player.synced.y;
    const pz = player.synced.z;
    const relevant: EventLogEntry[] = [];

    for (const entry of range.entries) {
      const source = entry.sourceLocation;
      if (!source) {
        relevant.push(entry);
        continue;
      }
      const dx = source.x - px;
      const dy = source.y - py;
      const dz = source.z - pz;
      const distributionSq = dx * dx + dy * dy + dz * dz;
      if (distributionSq <= maxRangeSq) {
        relevant.push(entry);
      }
    }

    const response: EventStreamResyncResponse = {
      type: "event_stream_resync_response",
      fromEventId: range.fromSeq,
      toEventId: range.toSeq,
      serverTick: this.zone.getServerTick(),
      events: relevant,
    };

    client.send("event_stream_resync_response", response);
    this.clientEventCursors.set(playerId, range.toSeq);
  }

  private getFallbackResyncRange(
    buffer: EventLogBuffer<EventLogEntry>,
  ): { fromSeq: number; toSeq: number; entries: EventLogEntry[] } | undefined {
    const oldest = buffer.oldestSeq;
    const latest = buffer.latestSeq;
    if (oldest === undefined || latest === undefined) {
      return undefined;
    }

    return (
      buffer.getRange(oldest, latest) ?? {
        fromSeq: oldest,
        toSeq: latest,
        entries: [],
      }
    );
  }
}
