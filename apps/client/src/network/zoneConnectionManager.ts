import { Callbacks, ColyseusSDK, Room } from "@colyseus/sdk";
//import type { server } from "../../../server/src/appConfig.ts";
//import type { ZoneRoom } from "../../../server/src/world/zones/zoneRoom.ts";

import {
  ClientMessage,
  PlayerState,
  ZoneState,
  ObjState,
  NPCState,
  SnapMessage,
  AbilityAck,
  AbilityUseRequest,
  AbilityCancelRequest,
  TargetChangeMessage,
  type EventLogEntry,
  type EventStreamBatch,
  type EventStreamResyncRequest,
  type EventStreamResyncResponse,
} from "@mmo/shared";
import type {
  ConnectionEventEmitter,
  ConnectionStatus,
} from "./connectionEventEmitter";
import { EventStreamClient } from "./eventStreamClient";

const DEBUG_MOVEMENT = import.meta.env.VITE_DEBUG_MOVEMENT === "true";

/**
 * Connection options for the game server.
 */
export interface GameConnectionOptions {
  token: string;
  playerId: string;
  zoneId: string;
}

/**
 * Manages the authoritative game-state room connection.
 */
export class ZoneConnectionManager implements ConnectionEventEmitter {
  private client?: ColyseusSDK; // ColyseusSDK<typeof server>;
  private room?: Room<typeof ZoneState>; // Room<ZoneRoom>
  private zoneId?: string;
  private isInitialized = false;
  private lastStatusText = "Disconnected";
  private lastStatusConnected = false;
  private statusHandlers: ((text: string, connected: boolean) => void)[] = [];

  public get initialized(): boolean {
    return this.isInitialized;
  }

  private systemMessageCallback?: (message: string) => void;
  private connectedCallback?: () => void;
  private disconnectedCallback?: () => void;
  private playerAddCallback?: (playerId: string, player: PlayerState) => void;
  private playerUpdateCallback?: (
    playerId: string,
    player: PlayerState,
  ) => void;
  private playerRemoveCallback?: (
    playerId: string,
    player: PlayerState,
  ) => void;
  private objectAddCallback?: (objectId: string, object: ObjState) => void;
  private objectUpdateCallback?: (objectId: string, object: ObjState) => void;
  private objectRemoveCallback?: (objectId: string, object: ObjState) => void;
  private npcAddCallback?: (npcId: string, npc: NPCState) => void;
  private npcUpdateCallback?: (npcId: string, npc: NPCState) => void;
  private npcRemoveCallback?: (npcId: string, npc: NPCState) => void;
  private zoneReadyCallback?: (zoneId: string) => void;
  private snapCallback?: (snap: SnapMessage) => void;
  private abilityAckCallback?: (ack: AbilityAck) => void;
  private eventStreamClient?: EventStreamClient;

  public async initialize(options: GameConnectionOptions): Promise<void> {
    // TODO: Handle re-initialization if you want to connect to a *different* room. Or is that a separate ZoneConnectionManager and we don't make it a singleton?
    if (this.isInitialized) {
      return;
    }

    try {
      const serverUrl =
        import.meta.env.VITE_GAME_SERVER_URL || "ws://localhost:2567";
      this.client = new ColyseusSDK(serverUrl);
      this.client.auth.token = options.token;
      this.updateStatus("Connecting...", false);
      console.log("Connecting to server with options ", options);
      this.room = await this.client.joinOrCreate(
        "zone",
        { zoneId: options.zoneId },
        ZoneState,
      );
      console.info("ZoneConnectionManager connected to room", {
        sessionId: this.room.sessionId,
      });

      this.updateStatus("Connected", true);
      this.systemMessageCallback?.("Connected to server");
      this.connectedCallback?.();

      this.eventStreamClient = new EventStreamClient({
        sendResyncRequest: (request) => this.sendEventStreamResync(request),
      });

      this.setupRoomHandlers();
      const zoneId = this.room.state.zoneId;
      if (zoneId) {
        this.zoneId = zoneId;
        console.debug("Zone assigned by server", { zoneId });
        this.zoneReadyCallback?.(zoneId);
      }
    } catch (error) {
      console.error("Failed to connect:", error);
      this.updateStatus("Connection failed", false);
      this.systemMessageCallback?.("Failed to connect to server");
    }

    this.isInitialized = true;
  }

  public sendMessage(message: ClientMessage): void {
    if (!this.room) {
      return;
    }

    if (DEBUG_MOVEMENT && message.type === "move") {
      console.debug("Sending movement", message.payload);
    }

    this.room.send(message.type, message.payload);
  }

  public sendAbilityUse(request: AbilityUseRequest): void {
    if (!this.room) {
      return;
    }

    this.room.send("ability_use", request);
  }

  public sendAbilityCancel(request: AbilityCancelRequest): void {
    if (!this.room) {
      return;
    }

    this.room.send("ability_cancel", request);
  }

  public sendTargetChange(payload: TargetChangeMessage): void {
    if (!this.room) {
      return;
    }

    this.room.send("target_change", payload);
  }

  public onSystemMessage(callback: (message: string) => void): void {
    this.systemMessageCallback = callback;
  }

  public onStatusUpdate(
    handler: (text: string, connected: boolean) => void,
  ): void {
    this.statusHandlers.push(handler);
  }

  public getStatus(): ConnectionStatus {
    return {
      text: this.lastStatusText,
      connected: this.lastStatusConnected,
    };
  }

  public onConnected(callback: () => void): void {
    this.connectedCallback = callback;
  }

  public onDisconnected(callback: () => void): void {
    this.disconnectedCallback = callback;
  }

  public onPlayerAdded(
    callback: (playerId: string, player: PlayerState) => void,
  ): void {
    this.playerAddCallback = callback;
  }

  public onPlayerUpdated(
    callback: (playerId: string, player: PlayerState) => void,
  ): void {
    this.playerUpdateCallback = callback;
  }

  public onPlayerRemoved(
    callback: (playerId: string, player: PlayerState) => void,
  ): void {
    this.playerRemoveCallback = callback;
  }

  public onObjectAdded(
    callback: (objectId: string, object: ObjState) => void,
  ): void {
    this.objectAddCallback = callback;
  }

  public onObjectUpdated(
    callback: (objectId: string, object: ObjState) => void,
  ): void {
    this.objectUpdateCallback = callback;
  }

  public onObjectRemoved(
    callback: (objectId: string, object: ObjState) => void,
  ): void {
    this.objectRemoveCallback = callback;
  }

  public onNpcAdded(callback: (npcId: string, npc: NPCState) => void): void {
    this.npcAddCallback = callback;
  }

  public onNpcUpdated(callback: (npcId: string, npc: NPCState) => void): void {
    this.npcUpdateCallback = callback;
  }

  public onNpcRemoved(callback: (npcId: string, npc: NPCState) => void): void {
    this.npcRemoveCallback = callback;
  }

  public onSnap(callback: (snap: SnapMessage) => void): void {
    this.snapCallback = callback;
  }

  public onAbilityAck(callback: (ack: AbilityAck) => void): void {
    this.abilityAckCallback = callback;
  }

  public drainEventStream(target: EventLogEntry[]): void {
    this.eventStreamClient?.drainEvents(target);
  }

  public getEventStreamCursor(): number | undefined {
    return this.eventStreamClient?.getLastEventId();
  }

  /**
   * Returns the zone ID assigned by the server, if available.
   *
   * @returns the zone identifier, or null if not connected.
   */
  public getZoneId(): string | undefined {
    return this.zoneId;
  }

  /**
   * Registers a callback fired when the server assigns a zone.
   *
   * @param callback - invoked with the zone identifier.
   */
  public onZoneReady(callback: (zoneId: string) => void): void {
    this.zoneReadyCallback = callback;
  }

  private setupRoomHandlers(): void {
    if (!this.room) {
      return;
    }

    this.room.onMessage("snap", (data: SnapMessage) => {
      this.snapCallback?.(data);
    });

    this.room.onMessage("ability_ack", (data: AbilityAck) => {
      this.abilityAckCallback?.(data);
    });

    this.room.onMessage("event_stream_batch", (data: EventStreamBatch) => {
      this.eventStreamClient?.handleBatch(data);
    });

    this.room.onMessage(
      "event_stream_resync_response",
      (data: EventStreamResyncResponse) => {
        this.eventStreamClient?.handleResyncResponse(data);
      },
    );

    const callbacks = Callbacks.get<ZoneState>(this.room);

    callbacks.listen("zoneId", (zoneId) => {
      if (!zoneId || zoneId === this.zoneId) {
        return;
      }

      this.zoneId = zoneId;
      console.debug("Zone assigned by server", { zoneId });
      this.zoneReadyCallback?.(zoneId);
    });

    callbacks.onAdd("players", (player: PlayerState, playerId: string) => {
      console.log("Player joined:", playerId);

      this.playerAddCallback?.(playerId, player);

      callbacks.onChange(player, () => {
        this.playerUpdateCallback?.(playerId, player);
      });

      this.systemMessageCallback?.(`${player.name || "Player"} joined`);
    });

    callbacks.onRemove("players", (player: PlayerState, playerId: string) => {
      console.log("Player left:", playerId);

      this.playerRemoveCallback?.(playerId, player);
      this.systemMessageCallback?.(`${player.name || "Player"} left`);
    });

    callbacks.onAdd("objects", (object: ObjState, objectId: string) => {
      console.debug("Object added", { objectId, object });
      this.objectAddCallback?.(objectId, object);

      callbacks.onChange(object, () => {
        this.objectUpdateCallback?.(objectId, object);
      });
    });

    callbacks.onRemove("objects", (object: ObjState, objectId: string) => {
      console.debug("Object removed", { objectId, object });
      this.objectRemoveCallback?.(objectId, object);
    });

    callbacks.onAdd("npcs", (npc: NPCState, npcId: string) => {
      console.debug("Npc added", { npcId, npc });
      this.npcAddCallback?.(npcId, npc);

      callbacks.onChange(npc, () => {
        this.npcUpdateCallback?.(npcId, npc);
      });
    });

    callbacks.onRemove("npcs", (npc: NPCState, npcId: string) => {
      console.debug("Npc removed", { npcId, npc });
      this.npcRemoveCallback?.(npcId, npc);
    });

    this.room.onError((code, message) => {
      console.error("Room error:", code, message);
      this.systemMessageCallback?.(`Error: ${message}`);
    });

    this.room.onLeave((code) => {
      console.log("Left room:", code);
      this.updateStatus("Disconnected", false);
      this.systemMessageCallback?.("Disconnected from server");
      this.disconnectedCallback?.();
      this.zoneId = undefined;
      this.eventStreamClient?.clear();
    });

    this.room.onStateChange.once((state) => {
      if (state.zoneId && !this.zoneId) {
        this.zoneId = state.zoneId;
        console.debug("Zone assigned by initial state", {
          zoneId: state.zoneId,
        });
        this.zoneReadyCallback?.(state.zoneId);
      }
      console.debug("Initial zone state received", {
        zoneId: state.zoneId,
        players: state.players.size,
        objects: state.objects.size,
        npcs: state.npcs.size,
      });
    });
  }

  /**
   * Re-emits the latest connection status to subscribers.
   */
  public refreshStatus(): void {
    this.updateStatus(this.lastStatusText, this.lastStatusConnected);
  }

  /**
   * Tears down network resources and callbacks.
   */
  public dispose(): void {
    this.room?.leave();
    this.room = undefined;
    this.client = undefined;
    this.zoneId = undefined;
    this.isInitialized = false;
    this.lastStatusText = "Disconnected";
    this.lastStatusConnected = false;
    this.statusHandlers = [];
    this.systemMessageCallback = undefined;
    this.connectedCallback = undefined;
    this.disconnectedCallback = undefined;
    this.playerAddCallback = undefined;
    this.playerUpdateCallback = undefined;
    this.playerRemoveCallback = undefined;
    this.objectAddCallback = undefined;
    this.objectUpdateCallback = undefined;
    this.objectRemoveCallback = undefined;
    this.npcAddCallback = undefined;
    this.npcUpdateCallback = undefined;
    this.npcRemoveCallback = undefined;
    this.zoneReadyCallback = undefined;
    this.snapCallback = undefined;
    this.abilityAckCallback = undefined;
    this.eventStreamClient?.clear();
    this.eventStreamClient = undefined;
  }

  private updateStatus(text: string, connected: boolean): void {
    this.lastStatusText = text;
    this.lastStatusConnected = connected;
    this.emitStatus(text, connected);
  }

  private emitStatus(text: string, connected: boolean): void {
    this.statusHandlers.forEach((handler) => {
      handler(text, connected);
    });
  }

  private sendEventStreamResync(request: EventStreamResyncRequest): void {
    if (!this.room) {
      return;
    }

    this.room.send("event_stream_resync_request", request);
  }
}
