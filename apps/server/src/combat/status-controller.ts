import type {
  AbilityTag,
  CombatStats,
  MobState,
  StatusEffectDefinition,
  StatusStacking,
  StatusState,
  StatModifier,
} from "@mmo/shared";

export interface StatusSnapshot {
  sourceStats: Partial<CombatStats>;
  targetStats: Partial<CombatStats>;
  resolvedValues?: Record<string, number>;
}

export interface ActiveStatus {
  id: string;
  sourceId: string;
  appliedAtMs: number;
  expiresAtMs: number;
  stacks: number;
  nextTickAtMs?: number;
  snapshot?: StatusSnapshot;
}

export interface StatusHistory {
  record(groupId: string, timeMs: number): void;
  countWithin(groupId: string, windowMs: number, nowMs: number): number;
  lastAppliedAt(groupId: string): number | undefined;
}

class StatusHistoryRingBuffer implements StatusHistory {
  private readonly capacity = 12;
  private readonly records = new Map<string, number[]>();

  record(groupId: string, timeMs: number): void {
    const buffer = this.records.get(groupId) ?? [];
    buffer.push(timeMs);
    if (buffer.length > this.capacity) {
      buffer.shift();
    }
    this.records.set(groupId, buffer);
  }

  countWithin(groupId: string, windowMs: number, nowMs: number): number {
    const buffer = this.records.get(groupId);
    if (!buffer) {
      return 0;
    }
    let count = 0;
    for (let index = buffer.length - 1; index >= 0; index -= 1) {
      if (nowMs - buffer[index] <= windowMs) {
        count += 1;
      } else {
        break;
      }
    }
    return count;
  }

  lastAppliedAt(groupId: string): number | undefined {
    const buffer = this.records.get(groupId);
    if (!buffer || buffer.length === 0) {
      return undefined;
    }
    return buffer.at(-1);
  }
}

export type StatusDefinitionMap = Record<string, StatusEffectDefinition>;

const buildBaseStats = (mob: MobState): CombatStats => ({
  strength: mob.strength,
  dexterity: mob.dexterity,
  intelligence: mob.intelligence,
  constitution: mob.constitution,
  maxHp: mob.maxHp,
  maxMana: mob.maxMana,
  maxStamina: mob.maxStamina,
});

export class StatusController {
  private readonly statuses: ActiveStatus[] = [];
  private readonly history: StatusHistory = new StatusHistoryRingBuffer();
  private cacheDirty = true;
  private cachedModifiers: StatModifier[] = [];
  private cachedBlockedAbilityTags = new Set<AbilityTag>();
  private cachedStateFlags = new Set<StatusState>();
  private cachedImmunityTags = new Set<string>();
  private onChange?: () => void;

  constructor(
    private readonly target: MobState,
    private readonly definitions: StatusDefinitionMap,
    onChange?: () => void,
  ) {
    this.onChange = onChange;
  }

  applyStatus(effect: StatusEffectDefinition, source: MobState, nowMs: number): boolean {
    const stacking = effect.stacking as StatusStacking;
    const existing = this.statuses.filter((status) => status.id === effect.id);
    const durationMs = effect.durationMs;
    const expiresAtMs = durationMs > 0 ? nowMs + durationMs : nowMs;

    if (stacking === "replace" && existing.length > 0) {
      this.removeStatus(effect.id);
    }

    if (stacking === "refresh" && existing.length > 0) {
      const status = existing[0];
      status.expiresAtMs = expiresAtMs;
      this.markDirty();
      return true;
    }

    if (stacking === "stack" && existing.length > 0) {
      const status = existing[0];
      status.stacks = Math.min(effect.maxStacks ?? Number.MAX_SAFE_INTEGER, status.stacks + 1);
      status.expiresAtMs = expiresAtMs;
      this.markDirty();
      return true;
    }

    const snapshot: StatusSnapshot = {
      sourceStats: buildBaseStats(source),
      targetStats: buildBaseStats(this.target),
    };

    this.statuses.push({
      id: effect.id,
      sourceId: source.id,
      appliedAtMs: nowMs,
      expiresAtMs,
      stacks: 1,
      nextTickAtMs: effect.tickIntervalMs ? nowMs + effect.tickIntervalMs : undefined,
      snapshot,
    });

    const groupId = effect.tags?.[0] ?? effect.id;
    this.history.record(groupId, nowMs);
    this.markDirty();
    return true;
  }

  removeStatus(statusId: string): void {
    const next = this.statuses.filter((status) => status.id !== statusId);
    if (next.length !== this.statuses.length) {
      this.statuses.length = 0;
      this.statuses.push(...next);
      this.markDirty();
    }
  }

  clearAll(): void {
    if (this.statuses.length === 0) {
      return;
    }
    this.statuses.length = 0;
    this.markDirty();
  }

  fixedTick(nowMs: number): void {
    let changed = false;
    for (let index = this.statuses.length - 1; index >= 0; index -= 1) {
      const status = this.statuses[index];
      if (status.expiresAtMs > 0 && nowMs >= status.expiresAtMs) {
        this.statuses.splice(index, 1);
        changed = true;
      }
    }
    if (changed) {
      this.markDirty();
    }
  }

  getActiveStatuses(): readonly ActiveStatus[] {
    return this.statuses;
  }

  getStatusEffects(): {
    status: ActiveStatus;
    definition: StatusEffectDefinition;
  }[] {
    return this.statuses
      .map((status) => ({
        status,
        definition: this.definitions[status.id],
      }))
      .filter(
        (
          entry,
        ): entry is {
          status: ActiveStatus;
          definition: StatusEffectDefinition;
        } => Boolean(entry.definition),
      );
  }

  getStatModifiers(): readonly StatModifier[] {
    this.ensureCache();
    return this.cachedModifiers;
  }

  hasStateFlag(flag: StatusState): boolean {
    this.ensureCache();
    return this.cachedStateFlags.has(flag);
  }

  hasImmunity(tag: string): boolean {
    this.ensureCache();
    return this.cachedImmunityTags.has(tag);
  }

  getBlockedAbilityTags(): ReadonlySet<AbilityTag> {
    this.ensureCache();
    return this.cachedBlockedAbilityTags;
  }

  getHistory(): StatusHistory {
    return this.history;
  }

  private ensureCache(): void {
    if (!this.cacheDirty) {
      return;
    }
    this.recomputeCache();
  }

  private markDirty(): void {
    this.cacheDirty = true;
    this.onChange?.();
  }

  private recomputeCache(): void {
    const modifiers: StatModifier[] = [];
    const blocked = new Set<AbilityTag>();
    const flags = new Set<StatusState>();
    const immunities = new Set<string>();

    for (const status of this.statuses) {
      const definition = this.definitions[status.id];
      if (!definition) {
        continue;
      }
      if (definition.statModifiers) {
        modifiers.push(...definition.statModifiers);
      }
      if (definition.blockedAbilityTags) {
        for (const tag of definition.blockedAbilityTags) blocked.add(tag);
      }
      if (definition.stateFlags) {
        for (const flag of definition.stateFlags) flags.add(flag);
      }
      if (definition.immunityTags) {
        for (const tag of definition.immunityTags) immunities.add(tag);
      }
    }

    this.cachedModifiers = modifiers;
    this.cachedBlockedAbilityTags = blocked;
    this.cachedStateFlags = flags;
    this.cachedImmunityTags = immunities;
    this.cacheDirty = false;
  }
}
