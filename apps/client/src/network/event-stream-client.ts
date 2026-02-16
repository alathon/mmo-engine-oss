import type {
  EventLogEntry,
  EventStreamBatch,
  EventStreamResyncRequest,
  EventStreamResyncResponse,
} from "@mmo/shared";

export interface EventStreamTransport {
  sendResyncRequest(request: EventStreamResyncRequest): void;
}

export class EventStreamClient {
  private readonly transport: EventStreamTransport;
  private lastEventId?: number;
  private resyncInFlight = false;
  private readonly pendingEvents: EventLogEntry[] = [];

  constructor(transport: EventStreamTransport) {
    this.transport = transport;
  }

  getLastEventId(): number | undefined {
    return this.lastEventId;
  }

  getPendingCount(): number {
    return this.pendingEvents.length;
  }

  handleBatch(batch: EventStreamBatch): void {
    this.handleRange(batch.fromEventId, batch.toEventId, batch.events, true);
  }

  handleResyncResponse(response: EventStreamResyncResponse): void {
    this.resyncInFlight = false;
    this.handleRange(response.fromEventId, response.toEventId, response.events, false);
  }

  drainEvents(target: EventLogEntry[]): void {
    if (this.pendingEvents.length === 0) {
      return;
    }

    for (const event of this.pendingEvents) {
      target.push(event);
    }

    this.pendingEvents.length = 0;
  }

  clear(): void {
    this.pendingEvents.length = 0;
    this.lastEventId = undefined;
    this.resyncInFlight = false;
  }

  private handleRange(
    fromEventId: number,
    toEventId: number,
    events: EventLogEntry[],
    allowResync: boolean,
  ): void {
    if (this.lastEventId === undefined) {
      this.lastEventId = Math.max(0, fromEventId - 1);
    }

    let baseline = this.lastEventId ?? 0;
    const expectedFrom = baseline + 1;

    if (fromEventId > expectedFrom) {
      if (allowResync) {
        if (!this.resyncInFlight) {
          this.resyncInFlight = true;
          this.transport.sendResyncRequest({
            type: "event_stream_resync_request",
            sinceEventId: baseline,
          });
        }
        return;
      }

      baseline = Math.max(0, fromEventId - 1);
      this.lastEventId = baseline;
    }

    if (toEventId <= baseline) {
      return;
    }

    if (events.length > 0) {
      for (const entry of events) {
        if (entry.eventId > baseline) {
          this.pendingEvents.push(entry);
        }
      }
    }

    if (toEventId > baseline) {
      this.lastEventId = toEventId;
    }
  }
}
