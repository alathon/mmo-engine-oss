export class InputMoveBuffer<T extends { seq: number }> {
  private readonly buffer: (T | undefined)[];
  private readonly capacity: number;
  private start = 0;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = Array.from({ length: capacity }) as (T | undefined)[];
  }

  getCount(): number {
    return this.count;
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
    this.buffer.fill(void 0);
  }

  enqueue(move: T): void {
    if (this.count === this.capacity) {
      this.buffer[this.start] = undefined;
      this.start = (this.start + 1) % this.capacity;
      this.count -= 1;
    }

    const index = (this.start + this.count) % this.capacity;
    this.buffer[index] = move;
    this.count += 1;
  }

  dropUpTo(seq: number): void {
    while (this.count > 0) {
      const move = this.buffer[this.start];
      if (!move || move.seq > seq) {
        break;
      }
      this.buffer[this.start] = undefined;
      this.start = (this.start + 1) % this.capacity;
      this.count -= 1;
    }
  }

  forEach(callback: (move: T, index: number) => void): void {
    for (let i = 0; i < this.count; i += 1) {
      const index = (this.start + i) % this.capacity;
      const move = this.buffer[index];
      if (move) {
        callback(move, i);
      }
    }
  }

  *values(): IterableIterator<T> {
    for (let i = 0; i < this.count; i += 1) {
      const index = (this.start + i) % this.capacity;
      const move = this.buffer[index];
      if (move) {
        yield move;
      }
    }
  }

  *entries(): IterableIterator<[number, T]> {
    let index = 0;
    for (const move of this.values()) {
      yield [index, move];
      index += 1;
    }
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.values();
  }
}
