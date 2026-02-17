import type { EventCategory, EventLogEntry } from "./event-log";

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
