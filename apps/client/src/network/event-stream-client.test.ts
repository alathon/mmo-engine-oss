import { describe, expect, it } from "vitest";
import { EventCategory, type EventLogEntry, type EventStreamResyncRequest } from "@mmo/shared";
import { EventStreamClient, type EventStreamTransport } from "./event-stream-client";

const createEntry = (eventId: number): EventLogEntry => ({
  eventId,
  category: EventCategory.Combat,
  eventType: 1,
  serverTick: 1,
  serverTimeMs: 1,
});

class FakeTransport implements EventStreamTransport {
  public readonly requests: EventStreamResyncRequest[] = [];

  sendResyncRequest(request: EventStreamResyncRequest): void {
    this.requests.push(request);
  }
}

describe("EventStreamClient", () => {
  it("queues events and advances cursor", () => {
    const transport = new FakeTransport();
    const client = new EventStreamClient(transport);

    client.handleBatch({
      type: "event_stream_batch",
      fromEventId: 10,
      toEventId: 12,
      serverTick: 5,
      events: [createEntry(10), createEntry(12)],
    });

    const drained: EventLogEntry[] = [];
    client.drainEvents(drained);

    expect(drained.map((entry) => entry.eventId)).toEqual([10, 12]);
    expect(client.getLastEventId()).toBe(12);
    expect(transport.requests).toEqual([]);
  });

  it("requests resync on gaps and keeps cursor", () => {
    const transport = new FakeTransport();
    const client = new EventStreamClient(transport);

    client.handleBatch({
      type: "event_stream_batch",
      fromEventId: 1,
      toEventId: 2,
      serverTick: 1,
      events: [createEntry(1), createEntry(2)],
    });

    const drained: EventLogEntry[] = [];
    client.drainEvents(drained);
    expect(client.getLastEventId()).toBe(2);

    client.handleBatch({
      type: "event_stream_batch",
      fromEventId: 4,
      toEventId: 4,
      serverTick: 2,
      events: [createEntry(4)],
    });

    const afterGap: EventLogEntry[] = [];
    client.drainEvents(afterGap);

    expect(afterGap).toEqual([]);
    expect(client.getLastEventId()).toBe(2);
    expect(transport.requests).toEqual([
      {
        type: "event_stream_resync_request",
        sinceEventId: 2,
      },
    ]);
  });

  it("accepts resync responses even if range starts after cursor", () => {
    const transport = new FakeTransport();
    const client = new EventStreamClient(transport);

    client.handleBatch({
      type: "event_stream_batch",
      fromEventId: 1,
      toEventId: 3,
      serverTick: 1,
      events: [createEntry(1), createEntry(2), createEntry(3)],
    });

    client.drainEvents([]);

    client.handleResyncResponse({
      type: "event_stream_resync_response",
      fromEventId: 6,
      toEventId: 7,
      serverTick: 2,
      events: [createEntry(6)],
    });

    const drained: EventLogEntry[] = [];
    client.drainEvents(drained);

    expect(drained.map((entry) => entry.eventId)).toEqual([6]);
    expect(client.getLastEventId()).toBe(7);
  });
});
