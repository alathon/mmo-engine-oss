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
