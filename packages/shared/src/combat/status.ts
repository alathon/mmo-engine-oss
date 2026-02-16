export type StatusCategory = "buff" | "debuff";
export type StatusStacking = "refresh" | "stack" | "replace" | "independent";
export type StatusState = "stunned" | "immobilized" | "silenced" | "rooted" | "disarmed";

export type AbilityTag = "spell" | "melee" | "ranged" | "movement" | "utility";

export interface CombatStats {
  strength: number;
  dexterity: number;
  intelligence: number;
  constitution: number;
  maxHp: number;
  maxMana: number;
  maxStamina: number;
}

export interface StatModifier {
  stat: keyof CombatStats;
  mode: "add" | "mul" | "override";
  value: number;
}

export interface StatusEffectDefinition {
  id: string;
  name: string;
  category: StatusCategory;
  tags?: string[];
  durationMs: number;
  maxDurationMs?: number;
  stacking: StatusStacking;
  maxStacks?: number;
  tickIntervalMs?: number;
  statModifiers?: StatModifier[];
  stateFlags?: StatusState[];
  immunityTags?: string[];
  blockedAbilityTags?: AbilityTag[];
}
