import type {
  AbilityDefinition,
  AbilityId,
  AbilityResult,
  EffectResult,
  EffectTargetFilter,
  MobState,
  TargetResult,
} from "@mmo/shared";
import {
  areAllies,
  areEnemies,
  rollAbilityUseCheck,
  type AbilityEffect,
} from "@mmo/shared";
import { createRng } from "./prng";

const HIT_CHANCE = 0.75;
const DODGE_CHANCE = 0.3;
const BLOCK_CHANCE = 0.2;
const CRIT_CHANCE = 0.5;
const HEAL_CRIT_CHANCE = 0.5;

const BLOCK_MULTIPLIER = 0.5;
const CRIT_MULTIPLIER = 1.5;

interface EffectCalculation {
  damage?: number;
  healing?: number;
}

type EffectCalculator = (
  source: MobState,
  target: MobState,
) => EffectCalculation;

const NO_EFFECT: EffectCalculator = () => ({});

const ABILITY_EFFECT_CALCULATORS: Record<AbilityId, EffectCalculator[]> = {
  quick_dart: [() => ({ damage: 18 })],
  shield_bash: [() => ({ damage: 12 }), NO_EFFECT],
  fireball: [() => ({ damage: 42 })],
  sky_sword: [() => ({ damage: 26 })],
  ice_storm: [() => ({ damage: 24 })],
  overgrowth: [() => ({ damage: 20 })],
  cleave_line: [() => ({ damage: 22 })],
  radiant_pulse: [() => ({ damage: 20 }), () => ({ healing: 16 })],
};

const rollOutcome = (rng: () => number): TargetResult["outcome"] => {
  if (rng() > HIT_CHANCE) {
    return "miss";
  }
  if (rng() < DODGE_CHANCE) {
    return "dodged";
  }
  if (rng() < BLOCK_CHANCE) {
    return "blocked";
  }
  if (rng() < CRIT_CHANCE) {
    return "crit";
  }
  return "hit";
};

const applyOutcomeMultipliers = (
  outcome: TargetResult["outcome"],
  damage: number,
): number => {
  if (damage <= 0) {
    return 0;
  }
  if (
    outcome === "miss" ||
    outcome === "dodged" ||
    outcome === "immune" ||
    outcome === "no_effect"
  ) {
    return 0;
  }
  if (outcome === "blocked") {
    return Math.max(0, Math.round(damage * BLOCK_MULTIPLIER));
  }
  if (outcome === "crit") {
    return Math.max(0, Math.round(damage * CRIT_MULTIPLIER));
  }
  return Math.max(0, Math.round(damage));
};

const applyHealingMultiplier = (isCrit: boolean, healing: number): number => {
  if (healing <= 0) {
    return 0;
  }
  if (isCrit) {
    return Math.max(0, Math.round(healing * CRIT_MULTIPLIER));
  }
  return Math.max(0, Math.round(healing));
};

const resolveEffectTargetFilter = (
  effect: AbilityEffect,
): EffectTargetFilter => {
  return effect.targetFilter;
};

const effectAppliesToTarget = (
  filter: EffectTargetFilter,
  source: MobState,
  target: MobState,
): boolean => {
  if (filter === "all") {
    return true;
  }
  if (filter === "allies") {
    return areAllies(source, target);
  }
  if (filter === "enemies") {
    return areEnemies(source, target);
  }
  return true;
};

export const resolveAbilityOutcome = (
  ability: AbilityDefinition,
  actor: MobState,
  possibleTargets: MobState[],
  rngSeed: number,
): AbilityResult => {
  const rng = createRng(rngSeed);
  const useCheck = rollAbilityUseCheck(ability);
  const useFailed =
    useCheck.result === "failure" || useCheck.result === "crit_failure";
  const effectCalculators =
    ABILITY_EFFECT_CALCULATORS[ability.id as AbilityId] ?? [];
  const effects: EffectResult[] = [];

  for (const [index, effect] of ability.effects.entries()) {
    const effectType = effect.type;
    const calculator = effectCalculators[index] ?? NO_EFFECT;
    const targetFilter = resolveEffectTargetFilter(effect);
    const legalTargets = possibleTargets.filter((target) =>
      effectAppliesToTarget(targetFilter, actor, target),
    );

    const targets: TargetResult[] = [];

    for (const target of legalTargets) {
      if (useFailed) {
        targets.push({ targetId: target.id, outcome: "no_effect" });
        continue;
      }

      if (effectType === "damage") {
        const resolved = calculator(actor, target);
        const baseDamage = resolved.damage ?? 0;
        if (baseDamage <= 0) {
          targets.push({ targetId: target.id, outcome: "no_effect" });
          continue;
        }
        const outcome = rollOutcome(rng);
        const finalDamage = applyOutcomeMultipliers(outcome, baseDamage);
        const result: TargetResult = {
          targetId: target.id,
          outcome,
        };
        if (finalDamage > 0) {
          result.damage = finalDamage;
        }
        if (outcome === "blocked") {
          const blockedAmount = Math.max(0, baseDamage - finalDamage);
          if (blockedAmount > 0) {
            result.blockedAmount = blockedAmount;
          }
        }
        targets.push(result);
        continue;
      }

      if (effectType === "healing") {
        const resolved = calculator(actor, target);
        const baseHealing = resolved.healing ?? 0;
        if (baseHealing <= 0) {
          targets.push({ targetId: target.id, outcome: "no_effect" });
          continue;
        }
        const healCrit = rng() < HEAL_CRIT_CHANCE;
        const finalHealing = applyHealingMultiplier(healCrit, baseHealing);
        const result: TargetResult = {
          targetId: target.id,
          outcome: healCrit ? "crit" : "hit",
        };
        if (finalHealing > 0) {
          result.healing = finalHealing;
        }
        targets.push(result);
        continue;
      }

      targets.push({
        targetId: target.id,
        outcome: "hit",
        statusApplied: [effect.statusId],
      });
    }

    effects.push({ effectIndex: index, effectType, targets });
  }

  return {
    abilityId: ability.id,
    actorId: actor.id,
    useCheck,
    effects,
  };
};
