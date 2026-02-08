import { describe, expect, it } from "vitest";
import { CombatState } from "@mmo/shared";
import { AggroTable } from "../src/combat/aggroTable";

const createTable = (): { state: CombatState; table: AggroTable } => {
  const state = new CombatState();
  const table = new AggroTable(state);
  return { state, table };
};

describe("AggroTable", () => {
  it("adds aggro and syncs relative percentages", () => {
    const { state, table } = createTable();

    table.addAggro("a", 10);
    table.addAggro("b", 5);

    expect(table.getAggro("a")).toBe(10);
    expect(table.getAggro("b")).toBe(5);
    expect(table.getTopTargetId()).toBe("a");

    expect(state.aggro.get("a")?.percent).toBe(100);
    expect(state.aggro.get("b")?.percent).toBe(50);
  });

  it("rounds percentages and keeps a minimum of 1%", () => {
    const { state, table } = createTable();

    table.addAggro("top", 100);
    table.addAggro("tiny", 0.4);

    expect(state.aggro.get("top")?.percent).toBe(100);
    expect(state.aggro.get("tiny")?.percent).toBe(1);
  });

  it("setAggro updates and removes entries when value is non-positive", () => {
    const { state, table } = createTable();

    table.setAggro("a", 20);
    expect(state.aggro.get("a")?.percent).toBe(100);

    table.setAggro("a", 0);
    expect(table.getAggro("a")).toBe(0);
    expect(state.aggro.get("a")).toBeUndefined();
  });

  it("ignores non-finite or non-positive addAggro inputs", () => {
    const { state, table } = createTable();

    table.addAggro("a", 10);
    table.addAggro("a", 0);
    table.addAggro("a", -5);
    table.addAggro("a", Number.NaN);
    table.addAggro("a", Number.POSITIVE_INFINITY);

    expect(table.getAggro("a")).toBe(10);
    expect(state.aggro.get("a")?.percent).toBe(100);
  });

  it("clear removes raw and synced aggro", () => {
    const { state, table } = createTable();

    table.addAggro("a", 10);
    table.addAggro("b", 5);

    table.clear();

    expect(table.getAggro("a")).toBe(0);
    expect(table.getAggro("b")).toBe(0);
    expect(state.aggro.size).toBe(0);
  });
});
