# Event Log (Server)

Authoritative, server-side event stream for combat and other discrete actions. This module owns the in-memory event buffer and sequence semantics. Delivery to clients is handled by `ZoneRoom` via Colyseus messages.

## Semantics
- `eventId` is a **monotonic number** scoped to a single room/zone.
- Ordering is stable by `(serverTick, eventId)` within a room stream.
- The log stores a fixed-size ring buffer of recent events and overwrites the oldest when full.
- Entries are **authoritative**; clients do not predict or insert log entries.
- The log carries **metadata only**. Client-facing text is derived elsewhere.

## Components
- `EventLog` is the room-level log wrapper.
- `EventLogBuffer` is the ring buffer storing entries and sequence numbers.
- `EVENT_LOG_BUFFER_SIZE` controls default buffer capacity.

## API
### EventLog
- `append(entry: EventLogEntry): number`
  - Appends an entry and assigns `eventId` (sequence).
  - Returns the assigned `eventId`.
- `getBuffer(): EventLogBuffer<EventLogEntry>`

### EventLogBuffer
- `append(entry: T): number`
  - Assigns `eventId` and stores entry in the ring.
- `getSince(afterSeq: number): { fromSeq; toSeq; entries } | undefined`
  - Returns the contiguous range `(afterSeq, latest]`.
  - Returns `undefined` if the requested start is older than the buffer can satisfy.
- `getRange(fromSeq: number, toSeq: number): { fromSeq; toSeq; entries } | undefined`
  - Returns a specific contiguous range.
  - Returns `undefined` if the full range is no longer available.
- `oldestSeq`, `latestSeq`, `length`, `maxSize`

## Delivery (ZoneRoom)
`ZoneRoom` flushes the event stream each fixed tick:
- Collects events appended since the last broadcast.
- Applies **interest filtering** by distance to `sourceLocation` using `DEFAULT_EVENT_RANGE`.
- Sends a single `event_stream_batch` to each client with at least one relevant event.
- Tracks a per-client cursor (`lastEventId`) for resync logic.

### Event Stream Messages
- `event_stream_batch`
  - `fromEventId` is `lastEventId + 1` for that client.
  - `toEventId` is the latest event id in the server buffer at send time.
  - `events` is the filtered subset, not necessarily every id in the range.
- `event_stream_resync_request`
  - Client reports the last event id it processed.
- `event_stream_resync_response`
  - Server responds with the range it can still provide.
  - If the requested range is too old, the server responds with the oldest available range.

## Intended Usage
- **Emit events** at authoritative server systems (combat, social, world).
- **Do not** attach localized text or client-only hints.
- **Batch and filter** events per tick to reduce bandwidth and client churn.

## Notes
- `eventId` is numeric for low overhead and compact network payloads.
- Ring buffer size is tuned for recent history; resync beyond capacity is a best-effort fallback.
- For very high volume streams, prefer targeted sends and keep event payloads small.
