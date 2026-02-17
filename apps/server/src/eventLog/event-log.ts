import type { EventLogEntry } from "@mmo/shared-sim";
import { EVENT_LOG_BUFFER_SIZE } from "./constants";
import { EventLogBuffer } from "./event-log-buffer";

export class EventLog {
  private readonly buffer: EventLogBuffer<EventLogEntry>;

  constructor(bufferSize: number = EVENT_LOG_BUFFER_SIZE) {
    this.buffer = new EventLogBuffer<EventLogEntry>(bufferSize);
  }

  append(entry: EventLogEntry): number {
    return this.buffer.append(entry);
  }

  getBuffer(): EventLogBuffer<EventLogEntry> {
    return this.buffer;
  }
}
