import type { TargetSpec } from "./targeting-types";

// Client -> Server
export interface AbilityUseRequest {
  type: "ability_use";
  requestId: string;
  sequence: number;
  clientTick: number;
  actorId: string;
  abilityId: string;
  target: TargetSpec;
  clientTimeMs: number;
}

export interface AbilityCancelRequest {
  type: "ability_cancel";
  requestId: string;
  sequence: number;
  clientTick: number;
  actorId: string;
  reason: "manual" | "movement" | "other";
  clientTimeMs: number;
}

export type AbilityUseRejectionReason =
  | "illegal"
  | "cooldown"
  | "resources"
  | "out_of_range"
  | "stunned"
  | "silenced"
  | "disarmed"
  | "rooted";

export type AbilityAckRejectReason =
  | AbilityUseRejectionReason
  | "buffer_full"
  | "buffer_window_closed"
  | "other";

// Server -> Client
export interface AbilityAck {
  type: "ability_ack";
  requestId: string;
  sequence: number;
  accepted: boolean;
  serverTimeMs: number;
  serverTick: number;
  castStartTimeMs: number;
  castEndTimeMs: number;
  castId?: number;
  gcdStartTimeMs?: number;
  gcdEndTimeMs?: number;
  result?: AbilityResult;
  rejectReason?: AbilityAckRejectReason;
}

export interface AbilityUseCheck {
  roll: number;
  maxRoll: 100;
  result: "success" | "crit_success" | "failure" | "crit_failure";
}

export interface EffectResult {
  effectIndex: number;
  effectType: "damage" | "healing" | "status";
  targets: TargetResult[];
}

export interface AbilityResult {
  abilityId: string;
  actorId: string;
  useCheck: AbilityUseCheck;
  effects: EffectResult[];
}

export interface TargetResult {
  targetId: string;
  outcome: "hit" | "miss" | "crit" | "blocked" | "immune" | "dodged" | "no_effect";
  damage?: number;
  blockedAmount?: number;
  healing?: number;
  statusApplied?: string[];
  displacement?: { dx: number; dy: number; dz: number };
}
