import { describe, expect, it } from "vitest";
import { InputMoveBuffer } from "./inputBuffer";

interface TestMove {
  seq: number;
  value: string;
}

describe("InputMoveBuffer", () => {
  it("stores moves in order and overwrites oldest when full", () => {
    const buffer = new InputMoveBuffer<TestMove>(3);

    buffer.enqueue({ seq: 1, value: "a" });
    buffer.enqueue({ seq: 2, value: "b" });
    buffer.enqueue({ seq: 3, value: "c" });
    buffer.enqueue({ seq: 4, value: "d" });

    const values: string[] = [];
    buffer.forEach((move) => values.push(move.value));

    expect(buffer.getCount()).toBe(3);
    expect(values).toEqual(["b", "c", "d"]);
  });

  it("drops moves up to a sequence", () => {
    const buffer = new InputMoveBuffer<TestMove>(4);

    buffer.enqueue({ seq: 1, value: "a" });
    buffer.enqueue({ seq: 2, value: "b" });
    buffer.enqueue({ seq: 3, value: "c" });

    buffer.dropUpTo(2);

    const values: string[] = [];
    buffer.forEach((move) => values.push(move.value));

    expect(buffer.getCount()).toBe(1);
    expect(values).toEqual(["c"]);
  });

  it("clears all buffered moves", () => {
    const buffer = new InputMoveBuffer<TestMove>(2);
    buffer.enqueue({ seq: 1, value: "a" });
    buffer.enqueue({ seq: 2, value: "b" });
    buffer.enqueue({ seq: 3, value: "c" });
    buffer.clear();

    expect(buffer.getCount()).toBe(0);
    const values: string[] = [];
    buffer.forEach((move) => values.push(move.value));
    expect(values).toEqual([]);
  });

  it("handles dropUpTo on an empty buffer", () => {
    const buffer = new InputMoveBuffer<TestMove>(2);

    buffer.dropUpTo(5);

    expect(buffer.getCount()).toBe(0);
  });

  it("drops everything when ack is beyond last seq", () => {
    const buffer = new InputMoveBuffer<TestMove>(3);
    buffer.enqueue({ seq: 1, value: "a" });
    buffer.enqueue({ seq: 2, value: "b" });

    buffer.dropUpTo(99);

    expect(buffer.getCount()).toBe(0);
  });

  it("keeps order when wrapping around", () => {
    const buffer = new InputMoveBuffer<TestMove>(3);
    buffer.enqueue({ seq: 1, value: "a" });
    buffer.enqueue({ seq: 2, value: "b" });
    buffer.enqueue({ seq: 3, value: "c" });
    buffer.dropUpTo(1);
    buffer.enqueue({ seq: 4, value: "d" });

    const values: string[] = [];
    buffer.forEach((move) => values.push(move.value));

    expect(values).toEqual(["b", "c", "d"]);
  });
});
