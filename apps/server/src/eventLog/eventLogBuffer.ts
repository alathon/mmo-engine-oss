import type { EventLogEntry } from "@mmo/shared";

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
    this.entries = new Array<T | undefined>(capacity);
    this.seqs = new Array<number>(capacity).fill(0);
  }

  get length(): number {
    return this.size;
  }

  get maxSize(): number {
    return this.capacity;
  }

  get oldestSeq(): number | null {
    if (this.size === 0) {
      return null;
    }
    return this.seqs[this.start];
  }

  get latestSeq(): number | null {
    if (this.size === 0) {
      return null;
    }
    const idx = (this.start + this.size - 1) % this.capacity;
    return this.seqs[idx];
  }

  append(entry: T): number {
    const seq = this.nextSeq;
    this.nextSeq += 1;

    let idx = 0;
    if (this.size < this.capacity) {
      idx = (this.start + this.size) % this.capacity;
      this.size += 1;
    } else {
      idx = this.start;
      this.start = (this.start + 1) % this.capacity;
    }

    entry.eventId = seq;
    this.entries[idx] = entry;
    this.seqs[idx] = seq;

    return seq;
  }

  /**
   * Return all entries with seq in (afterSeq, latestSeq].
   * Returns null if the requested range is no longer available.
   */
  getSince(afterSeq: number): EventLogRange<T> | null {
    const oldest = this.oldestSeq;
    const latest = this.latestSeq;
    if (oldest === null || latest === null) {
      return { fromSeq: afterSeq + 1, toSeq: afterSeq, entries: [] };
    }

    if (afterSeq < oldest - 1) {
      return null;
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
   * Returns null if the requested range is not fully available.
   */
  getRange(fromSeq: number, toSeq: number): EventLogRange<T> | null {
    if (fromSeq > toSeq) {
      return { fromSeq, toSeq, entries: [] };
    }

    const oldest = this.oldestSeq;
    const latest = this.latestSeq;
    if (oldest === null || latest === null) {
      return null;
    }

    if (fromSeq < oldest || toSeq > latest) {
      return null;
    }

    return {
      fromSeq,
      toSeq,
      entries: this.getRangeInternal(fromSeq, toSeq),
    };
  }

  private getRangeInternal(fromSeq: number, toSeq: number): T[] {
    const oldest = this.oldestSeq;
    if (oldest === null) {
      return [];
    }

    const count = toSeq - fromSeq + 1;
    const offset = fromSeq - oldest;
    const results: T[] = new Array<T>(count);

    for (let i = 0; i < count; i += 1) {
      const idx = (this.start + offset + i) % this.capacity;
      const entry = this.entries[idx];
      if (!entry) {
        continue;
      }
      results[i] = entry;
    }

    return results;
  }
}
