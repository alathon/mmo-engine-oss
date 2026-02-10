import type { CombatStats, MobState, StatModifier } from "@mmo/shared";

export interface StatModifierSource {
  getStatModifiers(): readonly StatModifier[];
}

const PRIMARY_STATS: (keyof CombatStats)[] = [
  "strength",
  "dexterity",
  "intelligence",
  "constitution",
];

const SECONDARY_STATS: (keyof CombatStats)[] = [
  "maxHp",
  "maxMana",
  "maxStamina",
];

const applyModifiers = (
  base: CombatStats,
  modifiers: StatModifier[],
  allowed: Set<keyof CombatStats>,
): CombatStats => {
  const result: CombatStats = { ...base };
  const add = new Map<keyof CombatStats, number>();
  const mul = new Map<keyof CombatStats, number>();
  const override = new Map<keyof CombatStats, number>();

  for (const modifier of modifiers) {
    if (!allowed.has(modifier.stat)) {
      continue;
    }
    switch (modifier.mode) {
    case "add": {
      add.set(
        modifier.stat,
        (add.get(modifier.stat) ?? 0) + modifier.value,
      );
    
    break;
    }
    case "mul": {
      mul.set(
        modifier.stat,
        (mul.get(modifier.stat) ?? 1) * modifier.value,
      );
    
    break;
    }
    case "override": {
      override.set(modifier.stat, modifier.value);
    
    break;
    }
    // No default
    }
  }

  for (const stat of (Object.keys(result) as (keyof CombatStats)[])) {
    if (!allowed.has(stat)) {
      continue;
    }
    let value = result[stat];
    value += add.get(stat) ?? 0;
    value *= mul.get(stat) ?? 1;
    if (override.has(stat)) {
      value = override.get(stat) ?? value;
    }
    result[stat] = value;
  }

  return result;
};

const clampStat = (value: number, min = 1): number => {
  return Math.max(min, Math.round(value));
};

const computeDerivedFromPrimary = (primary: CombatStats): CombatStats => ({
  ...primary,
  maxHp: 100 + primary.constitution * 25,
  maxMana: 50 + primary.intelligence * 15,
  maxStamina: 50 + primary.strength * 10,
});

export class StatsController {
  private sources: StatModifierSource[] = [];
  private derivedStats: CombatStats;
  private dirty = true;

  constructor(target: MobState, sources: StatModifierSource[] = []) {
    this.target = target;
    this.sources = sources;
    this.derivedStats = this.buildDerived();
    this.applyToTarget();
  }

  private readonly target: MobState;

  setSources(sources: StatModifierSource[]): void {
    this.sources = sources;
    this.markDirty();
  }

  markDirty(): void {
    this.dirty = true;
  }

  getDerivedStats(): CombatStats {
    this.ensureDerived();
    return this.derivedStats;
  }

  private ensureDerived(): void {
    if (!this.dirty) {
      return;
    }
    this.derivedStats = this.buildDerived();
    this.applyToTarget();
    this.dirty = false;
  }

  private buildDerived(): CombatStats {
    const base: CombatStats = {
      strength: this.target.strength,
      dexterity: this.target.dexterity,
      intelligence: this.target.intelligence,
      constitution: this.target.constitution,
      maxHp: this.target.maxHp,
      maxMana: this.target.maxMana,
      maxStamina: this.target.maxStamina,
    };

    const modifiers = this.sources.flatMap((source) =>
      source.getStatModifiers(),
    );

    const primaryAllowed = new Set(PRIMARY_STATS);
    const secondaryAllowed = new Set(SECONDARY_STATS);

    const primaryStats = applyModifiers(base, modifiers, primaryAllowed);
    const derivedBase = computeDerivedFromPrimary(primaryStats);
    const derived = applyModifiers(derivedBase, modifiers, secondaryAllowed);

    derived.strength = clampStat(derived.strength);
    derived.dexterity = clampStat(derived.dexterity);
    derived.intelligence = clampStat(derived.intelligence);
    derived.constitution = clampStat(derived.constitution);
    derived.maxHp = clampStat(derived.maxHp);
    derived.maxMana = clampStat(derived.maxMana);
    derived.maxStamina = clampStat(derived.maxStamina);

    return derived;
  }

  private applyToTarget(): void {
    this.target.maxHp = clampStat(this.derivedStats.maxHp);
    this.target.maxMana = clampStat(this.derivedStats.maxMana);
    this.target.maxStamina = clampStat(this.derivedStats.maxStamina);
    this.target.currentHp = Math.min(
      this.target.currentHp,
      this.target.maxHp,
    );
    this.target.mana = Math.min(this.target.mana, this.target.maxMana);
    this.target.stamina = Math.min(this.target.stamina, this.target.maxStamina);
  }
}
