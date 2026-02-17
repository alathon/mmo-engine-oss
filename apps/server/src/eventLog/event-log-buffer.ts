import type { EventLogEntry } from "@mmo/shared-sim";

export interface EventLogRange<T extends EventLogEntry> {
  fromSeq: number;
  toSeq: number;
  entries: T[];
}

/**
 * Fixed-size ring buffer for event log entries.
 * Stores a contiguous sequence range [oldestSeq, latestSeq].
 */
export class EventLogBuffer<T extends EventLogEntry> {
  private readonly entries: (T | undefined)[];
  private readonly seqs: number[];
  private start = 0;
  private size = 0;
  private nextSeq = 1;

  constructor(private readonly capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error("EventLogBuffer capacity must be positive.");
    }
    this.entries = Array.from({ length: capacity });
    this.seqs = Array.from({ length: capacity }, () => 0);
  }

  get length(): number {
    return this.size;
  }

  get maxSize(): number {
    return this.capacity;
  }

  get oldestSeq(): number | undefined {
    if (this.size === 0) {
      return undefined;
    }
    return this.seqs[this.start];
  }

  get latestSeq(): number | undefined {
    if (this.size === 0) {
      return undefined;
    }
    const index = (this.start + this.size - 1) % this.capacity;
    return this.seqs[index];
  }

  append(entry: T): number {
    const seq = this.nextSeq;
    this.nextSeq += 1;

    let index = 0;
    if (this.size < this.capacity) {
      index = (this.start + this.size) % this.capacity;
      this.size += 1;
    } else {
      index = this.start;
      this.start = (this.start + 1) % this.capacity;
    }

    entry.eventId = seq;
    this.entries[index] = entry;
    this.seqs[index] = seq;

    return seq;
  }

  /**
   * Return all entries with seq in (afterSeq, latestSeq].
   * Returns undefined if the requested range is no longer available.
   */
  getSince(afterSeq: number): EventLogRange<T> | undefined {
    const oldest = this.oldestSeq;
    const latest = this.latestSeq;
    if (oldest === undefined || latest === undefined) {
      return { fromSeq: afterSeq + 1, toSeq: afterSeq, entries: [] };
    }

    if (afterSeq < oldest - 1) {
      return undefined;
    }

    const fromSeq = Math.max(afterSeq + 1, oldest);
    if (fromSeq > latest) {
      return { fromSeq, toSeq: latest, entries: [] };
    }

    return {
      fromSeq,
      toSeq: latest,
      entries: this.getRangeInternal(fromSeq, latest),
    };
  }

  /**
   * Return entries with seq in [fromSeq, toSeq].
   * Returns undefined if the requested range is not fully available.
   */
  getRange(fromSeq: number, toSeq: number): EventLogRange<T> | undefined {
    if (fromSeq > toSeq) {
      return { fromSeq, toSeq, entries: [] };
    }

    const oldest = this.oldestSeq;
    const latest = this.latestSeq;
    if (oldest === undefined || latest === undefined) {
      return undefined;
    }

    if (fromSeq < oldest || toSeq > latest) {
      return undefined;
    }

    return {
      fromSeq,
      toSeq,
      entries: this.getRangeInternal(fromSeq, toSeq),
    };
  }

  private getRangeInternal(fromSeq: number, toSeq: number): T[] {
    const oldest = this.oldestSeq;
    if (oldest === undefined) {
      return [];
    }

    const count = toSeq - fromSeq + 1;
    const offset = fromSeq - oldest;
    const results: T[] = Array.from({ length: count });

    for (let index = 0; index < count; index += 1) {
      const index_ = (this.start + offset + index) % this.capacity;
      const entry = this.entries[index_];
      if (!entry) {
        continue;
      }
      results[index] = entry;
    }

    return results;
  }
}
