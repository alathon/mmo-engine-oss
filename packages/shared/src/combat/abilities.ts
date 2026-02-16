import type { AbilityAoeShape, DirectionMode, TargetType } from "./targeting-types";
import type { ResourceCost } from "./resources";
import type { AbilityTag } from "./status";
import type { AbilityUseCheck } from "../types/combat-messages";

export interface DamageEffect {
  type: "damage";
  school: string;
  targetFilter: EffectTargetFilter;
}

export interface HealingEffect {
  type: "healing";
  targetFilter: EffectTargetFilter;
}

export interface StatusEffect {
  type: "status";
  statusId: string;
  durationMs: number;
  targetFilter: EffectTargetFilter;
}

export type AbilityEffect = DamageEffect | HealingEffect | StatusEffect;
export type EffectTargetFilter = "all" | "allies" | "enemies";

export interface AbilityDefinition {
  id: string;
  name: string;
  iconId?: string;
  abilityTags?: AbilityTag[];
  isOnGcd: boolean;
  castTimeMs: number;
  cooldownMs: number;
  range: number;
  targetType: TargetType;
  directionMode?: DirectionMode;
  aoeShape: AbilityAoeShape;
  effects: AbilityEffect[];
  resourceCosts?: ResourceCost[];
  rollUseCheck?: () => AbilityUseCheck;
}

export const rollAbilityUseCheck = (ability: AbilityDefinition): AbilityUseCheck => {
  if (ability.rollUseCheck) {
    return ability.rollUseCheck();
  }
  return { roll: 100, maxRoll: 100, result: "success" };
};

export const ABILITY_DEFINITIONS = {
  quick_dart: {
    id: "quick_dart",
    name: "Quick Dart",
    iconId: "quick-dart",
    isOnGcd: false,
    castTimeMs: 0,
    cooldownMs: 12000,
    targetType: "enemy",
    range: 18,
    aoeShape: "single",
    effects: [{ type: "damage", school: "physical", targetFilter: "enemies" }],
    resourceCosts: [{ type: "stamina", amount: 6 }],
  },
  shield_bash: {
    id: "shield_bash",
    name: "Shield Bash",
    iconId: "shield-bash",
    isOnGcd: true,
    castTimeMs: 0,
    cooldownMs: 2500,
    targetType: "enemy",
    range: 6,
    aoeShape: "single",
    effects: [
      { type: "damage", school: "physical", targetFilter: "enemies" },
      {
        type: "status",
        statusId: "stunned",
        durationMs: 1000,
        targetFilter: "enemies",
      },
    ],
    resourceCosts: [{ type: "stamina", amount: 8 }],
  },
  fireball: {
    id: "fireball",
    name: "Fireball",
    iconId: "fireball",
    isOnGcd: true,
    castTimeMs: 5000,
    cooldownMs: 0,
    targetType: "enemy",
    range: 22,
    aoeShape: { type: "circle", radius: 4.5 },
    effects: [{ type: "damage", school: "fire", targetFilter: "enemies" }],
    resourceCosts: [{ type: "mana", amount: 18 }],
  },
  sky_sword: {
    id: "sky_sword",
    name: "Sky Sword",
    iconId: "sky-sword",
    isOnGcd: true,
    castTimeMs: 1500,
    cooldownMs: 0,
    targetType: "enemy",
    directionMode: "target",
    range: 10,
    aoeShape: { type: "cone", angleDeg: 70, length: 8 },
    effects: [{ type: "damage", school: "fire", targetFilter: "enemies" }],
    resourceCosts: [{ type: "mana", amount: 12 }],
  },
  ice_storm: {
    id: "ice_storm",
    name: "Ice Storm",
    iconId: "ice-storm",
    isOnGcd: true,
    castTimeMs: 1000,
    cooldownMs: 12000,
    targetType: "ground",
    range: 18,
    aoeShape: { type: "circle", radius: 3.5 },
    effects: [{ type: "damage", school: "arcane", targetFilter: "enemies" }],
    resourceCosts: [{ type: "mana", amount: 16 }],
  },
  overgrowth: {
    id: "overgrowth",
    name: "Overgrowth",
    iconId: "overgrowth",
    isOnGcd: true,
    castTimeMs: 900,
    cooldownMs: 7000,
    targetType: "enemy",
    directionMode: "target",
    range: 10,
    aoeShape: { type: "cone", angleDeg: 75, length: 7.5 },
    effects: [{ type: "damage", school: "electric", targetFilter: "enemies" }],
    resourceCosts: [{ type: "stamina", amount: 10 }],
  },
  cleave_line: {
    id: "cleave_line",
    name: "Cleave Line",
    isOnGcd: true,
    castTimeMs: 700,
    cooldownMs: 9000,
    targetType: "self",
    directionMode: "cursor",
    range: 9,
    aoeShape: { type: "line", length: 7, width: 3 },
    effects: [{ type: "damage", school: "physical", targetFilter: "enemies" }],
    resourceCosts: [{ type: "stamina", amount: 12 }],
  },
  radiant_pulse: {
    id: "radiant_pulse",
    name: "Radiant Pulse",
    isOnGcd: true,
    castTimeMs: 1800,
    cooldownMs: 10000,
    targetType: "ground",
    range: 18,
    aoeShape: { type: "circle", radius: 6 },
    effects: [
      { type: "damage", school: "holy", targetFilter: "enemies" },
      { type: "healing", targetFilter: "allies" },
    ],
    resourceCosts: [{ type: "mana", amount: 20 }],
  },
} satisfies Record<string, AbilityDefinition>;

export type AbilityId = keyof typeof ABILITY_DEFINITIONS;
export const ABILITY_LIST = Object.values(ABILITY_DEFINITIONS);
