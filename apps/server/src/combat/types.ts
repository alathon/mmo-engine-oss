import type { AbilityAck, AbilityResult, AbilityUseRequest } from "@mmo/shared-sim";

export interface ActiveCast {
  castId: number;
  actorId: string;
  abilityId: string;
  requestId: string;
  sequence: number;
  serverTick: number;
  castStartTimeMs: number;
  castEndTimeMs: number;
  result: AbilityResult;
}

export interface BufferedAbilityRequest {
  request: AbilityUseRequest;
  receivedAtMs: number;
  serverTick: number;
  sendAck: (ack: AbilityAck) => void;
}
