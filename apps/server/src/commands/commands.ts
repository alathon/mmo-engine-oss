import { Client } from "colyseus";
import {
  AbilityCancelRequest,
  AbilityUseRequest,
  MoveMessage,
  TargetChangeMessage,
} from "@mmo/shared-sim";
import { ServerPlayer } from "../world/entities/player";
import { ServerZone } from "../world/zones/zone";
import { MAX_PENDING_INPUTS, SERVER_SNAP_ACCEPT_DISTANCE } from "../world/constants/movement";

export type ClientCommand =
  | MoveMessage
  | AbilityUseRequest
  | AbilityCancelRequest
  | TargetChangeMessage;

export interface ClientCommandContext<T extends ClientCommand> {
  client: Client;
  data: T;
  player: ServerPlayer;
  zone: ServerZone;
}

/**
 * Handles movement input from the client.
 *
 * @param context - input context for a move command.
 */
export const moveCommand = ({ data, player }: ClientCommandContext<MoveMessage>): void => {
  if (player.snapLocked) {
    const target = player.snapTarget;
    if (!target) {
      return;
    }
    const dx = data.predictedX - target.x;
    const dy = data.predictedY - target.y;
    const dz = data.predictedZ - target.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    const acceptSq = SERVER_SNAP_ACCEPT_DISTANCE * SERVER_SNAP_ACCEPT_DISTANCE;
    if (distanceSq <= acceptSq) {
      player.snapLocked = false;
      player.snapTarget = undefined;
      player.pendingInputs.length = 0;
      player.inputBudgetTicks = 0;
      player.synced.lastProcessedSeq = Math.max(player.synced.lastProcessedSeq, data.seq);
    }
    return;
  }

  if (data.seq <= player.synced.lastProcessedSeq) {
    return;
  }

  if (player.pendingInputs.length >= MAX_PENDING_INPUTS) {
    player.pendingInputs.shift();
  }

  player.pendingInputs.push({
    directionX: data.directionX,
    directionZ: data.directionZ,
    jumpPressed: data.jumpPressed,
    seq: data.seq,
    tick: data.tick,
    isSprinting: data.isSprinting,
    predictedX: data.predictedX,
    predictedY: data.predictedY,
    predictedZ: data.predictedZ,
  });
};

export const useAbilityCommand = ({
  client,
  data,
  player,
  zone,
}: ClientCommandContext<AbilityUseRequest>): void => {
  const serverTimeMs = Date.now();
  const serverTick = zone.getServerTick();

  zone.abilityEngine.handleAbilityUse({
    request: data,
    actor: player,
    serverTimeMs,
    serverTick,
    sendAck: (ack) => client.send("ability_ack", ack),
  });
};

export const cancelAbilityCommand = ({
  data,
  player,
  zone,
}: ClientCommandContext<AbilityCancelRequest>): void => {
  const serverTimeMs = Date.now();
  const serverTick = zone.getServerTick();
  zone.abilityEngine.handleAbilityCancel({
    request: data,
    actor: player,
    serverTimeMs,
    serverTick,
  });
};

export const changeTargetCommand = ({
  data,
  player,
  zone,
}: ClientCommandContext<TargetChangeMessage>): void => {
  const targetId = data.targetEntityId?.trim();
  if (!targetId) {
    player.synced.entityTargetId = "";
    return;
  }

  const hasTarget = zone.players.has(targetId) || zone.npcs.has(targetId);
  if (!hasTarget) {
    player.synced.entityTargetId = "";
    return;
  }

  player.synced.entityTargetId = targetId;
};
