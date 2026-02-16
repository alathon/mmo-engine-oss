import type { TargetSpec } from "../combat/targeting-types";

export interface EventLogEntry {
  eventId: number;
  category: EventCategory;
  eventType: number;
  serverTick: number;
  serverTimeMs: number;
  contextId?: string;
  actorId?: string;
  sourceLocation?: {
    x: number;
    y: number;
    z: number;
  };
}

export enum EventCategory {
  Combat = 1,
  Social = 2,
  World = 3,
  Player = 4,
  System = 5,
}

export enum CombatEventType {
  AbilityCastStart = 1,
  AbilityCastInterrupt = 2,
  AbilityCastFinish = 3,
  AbilityEffectApplied = 4,
  MobEnterCombat = 5,
  MobExitCombat = 6,
}

export type AbilityCastStartEvent = EventLogEntry & {
  category: EventCategory.Combat;
  eventType: CombatEventType.AbilityCastStart;
  actorId: string;
  castId: number;
  abilityId: string;
  target: TargetSpec;
  gcdStartTimeMs?: number;
  gcdEndTimeMs?: number;
  castStartTimeMs: number;
  castEndTimeMs: number;
};

export type AbilityCastInterruptEvent = EventLogEntry & {
  category: EventCategory.Combat;
  eventType: CombatEventType.AbilityCastInterrupt;
  actorId: string;
  castId: number;
  abilityId: string;
  reason: "movement" | "stun" | "silence" | "manual" | "other";
  interruptSourceId?: string;
};

export type AbilityCastFinishEvent = EventLogEntry & {
  category: EventCategory.Combat;
  eventType: CombatEventType.AbilityCastFinish;
  actorId: string;
  castId: number;
  abilityId: string;
};

export type AbilityEffectAppliedEvent = EventLogEntry & {
  category: EventCategory.Combat;
  eventType: CombatEventType.AbilityEffectApplied;
  actorId: string;
  castId: number;
  abilityId: string;
  effectId: number;
  targetId: string;
  outcome: "hit" | "miss" | "crit" | "blocked" | "immune" | "dodged" | "no_effect";
  damage?: number;
  blockedAmount?: number;
  healing?: number;
  statusApplied?: string[];
  displacement?: { dx: number; dy: number; dz: number };
};

export type MobEnterCombatEvent = EventLogEntry & {
  category: EventCategory.Combat;
  eventType: CombatEventType.MobEnterCombat;
  mobId: string;
  reason: "damaged" | "aggro" | "proximity" | "scripted" | "other";
  instigatorId?: string;
};

export type MobExitCombatEvent = EventLogEntry & {
  category: EventCategory.Combat;
  eventType: CombatEventType.MobExitCombat;
  mobId: string;
  reason: "timeout" | "death" | "evade" | "scripted" | "other";
};

export enum SocialEventType {
  EmoteUsed = 1,
}

export type EmoteUsedEvent = EventLogEntry & {
  category: EventCategory.Social;
  eventType: SocialEventType.EmoteUsed;
  actorId: string;
  emoteId: string;
  targetId?: string;
  position?: { x: number; y: number; z: number };
};

export interface EventStreamBatch {
  type: "event_stream_batch";
  fromEventId: number;
  toEventId: number;
  serverTick: number;
  events: EventLogEntry[];
}

export interface EventStreamResyncRequest {
  type: "event_stream_resync_request";
  sinceEventId: number;
}

export interface EventStreamResyncResponse {
  type: "event_stream_resync_response";
  fromEventId: number;
  toEventId: number;
  serverTick: number;
  events: EventLogEntry[];
}
