import { describe, expect, it } from "vitest";
import { ABILITY_DEFINITIONS } from "@mmo/shared";
import { CombatPredictionState } from "./combatPredictionState";

describe("CombatPredictionState", () => {
  it("tracks gcd/internal cooldown gates", () => {
    const state = new CombatPredictionState();
    const gcdAbility = ABILITY_DEFINITIONS.shield_bash;
    const ogcdAbility = ABILITY_DEFINITIONS.quick_dart;

    state.predictedGcdEndTimeMs = 2000;
    expect(state.canAttemptAbility(gcdAbility, 1500)).toBe(false);
    expect(state.canAttemptAbility(ogcdAbility, 1500)).toBe(true);

    state.predictedInternalCooldownEndTimeMs = 1800;
    expect(state.canAttemptAbility(ogcdAbility, 1700)).toBe(false);
  });

  it("tracks ability cooldowns", () => {
    const state = new CombatPredictionState();
    const ability = ABILITY_DEFINITIONS.quick_dart;

    state.setAbilityCooldown(ability.id, 3000);
    expect(state.canAttemptAbility(ability, 2500)).toBe(false);
    expect(state.canAttemptAbility(ability, 3500)).toBe(true);
  });
});
