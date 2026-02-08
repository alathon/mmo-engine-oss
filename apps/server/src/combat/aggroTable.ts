import { AggroEntry, CombatState } from "@mmo/shared";

const MAX_PERCENT = 100;

/**
 * Server-only aggro table that tracks raw aggro values and syncs
 * relative percentages to the NPC's CombatState.
 */
export class AggroTable {
  private readonly raw = new Map<string, number>();

  constructor(private readonly combatState: CombatState) {}

  addAggro(targetId: string, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }
    const next = (this.raw.get(targetId) ?? 0) + amount;
    this.raw.set(targetId, next);
    this.sync();
  }

  setAggro(targetId: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      this.raw.delete(targetId);
      this.sync();
      return;
    }
    this.raw.set(targetId, value);
    this.sync();
  }

  getAggro(targetId: string): number {
    return this.raw.get(targetId) ?? 0;
  }

  hasTarget(targetId: string): boolean {
    return (this.raw.get(targetId) ?? 0) > 0;
  }

  getTopTargetId(): string | undefined {
    let bestId: string | undefined;
    let bestValue = 0;
    for (const [id, value] of this.raw) {
      if (value > bestValue) {
        bestValue = value;
        bestId = id;
      }
    }
    return bestId;
  }

  getTopAggroValue(): number {
    let bestValue = 0;
    for (const value of this.raw.values()) {
      if (value > bestValue) {
        bestValue = value;
      }
    }
    return bestValue;
  }

  clear(): void {
    if (this.raw.size === 0) {
      return;
    }
    this.raw.clear();
    this.clearSynced();
  }

  hasAnyTargets(activeIds?: Set<string>): boolean {
    if (activeIds) {
      let changed = false;
      for (const id of this.raw.keys()) {
        if (!activeIds.has(id)) {
          this.raw.delete(id);
          changed = true;
        }
      }
      if (changed) {
        this.sync();
      }
    }
    return this.raw.size > 0;
  }

  private sync(): void {
    this.pruneInvalid();

    const top = this.getTopAggroValue();
    if (top <= 0) {
      this.clearSynced();
      return;
    }

    for (const key of this.combatState.aggro.keys()) {
      if (!this.raw.has(key)) {
        this.combatState.aggro.delete(key);
      }
    }

    for (const [id, value] of this.raw) {
      const percent = this.toPercent(value, top);
      const entry = this.combatState.aggro.get(id);
      if (entry) {
        if (entry.percent !== percent) {
          entry.percent = percent;
        }
      } else {
        const next = new AggroEntry();
        next.percent = percent;
        this.combatState.aggro.set(id, next);
      }
    }
  }

  private toPercent(value: number, top: number): number {
    if (top <= 0) {
      return 0;
    }
    const raw = Math.round((value / top) * MAX_PERCENT);
    if (raw <= 0) {
      return 1;
    }
    return raw > MAX_PERCENT ? MAX_PERCENT : raw;
  }

  private pruneInvalid(): void {
    for (const [id, value] of this.raw) {
      if (!Number.isFinite(value) || value <= 0) {
        this.raw.delete(id);
      }
    }
  }

  private clearSynced(): void {
    for (const key of this.combatState.aggro.keys()) {
      this.combatState.aggro.delete(key);
    }
  }
}
