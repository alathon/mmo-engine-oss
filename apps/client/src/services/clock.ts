export interface Clock {
  nowMs(): number;
}

export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
}
