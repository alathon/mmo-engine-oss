import { describe, expect, it } from 'vitest';
import { ABILITY_DEFINITIONS } from '@mmo/shared';
import { CombatPredictionState } from '../../../combat/combat-prediction-state';
import type { HotbarSlot } from './hotbar-controller';
import { HotbarViewModel } from './hotbar-view-model';

class FakeHotbar {
  private keyDown = new Set<number>();

  constructor(private slots: HotbarSlot[]) {}

  getSlotsRef(): readonly HotbarSlot[] {
    return this.slots;
  }

  isSlotKeyDown(index: number): boolean {
    return this.keyDown.has(index);
  }

  activateSlot(_index: number): void {}

  setKeyDown(index: number, down: boolean): void {
    if (down) {
      this.keyDown.add(index);
    } else {
      this.keyDown.delete(index);
    }
  }
}

class FakeCombat {
  constructor(private prediction: CombatPredictionState) {}

  getPredictionState(): CombatPredictionState {
    return this.prediction;
  }

  getCastingAbilityId(_nowMs: number): string | undefined {
    return undefined;
  }
}

describe('HotbarViewModel', () => {
  it('projects cooldown, gcd, and pressed state', () => {
    const abilityId = 'shield_bash';
    const ability = ABILITY_DEFINITIONS[abilityId];
    if (!ability) {
      throw new Error('Missing ability definition for test');
    }

    const slots: HotbarSlot[] = [
      {
        index: 0,
        key: '1',
        action: { type: 'ability', abilityId },
      },
    ];

    const hotbar = new FakeHotbar(slots);
    const prediction = new CombatPredictionState();
    const nowMs = 1000;

    prediction.predictedGcdStartTimeMs = nowMs - 100;
    prediction.predictedGcdEndTimeMs = nowMs + 900;
    prediction.setAbilityCooldown(abilityId, nowMs + ability.cooldownMs);

    const viewModel = new HotbarViewModel();
    viewModel.bind(hotbar, new FakeCombat(prediction));
    viewModel.tick(nowMs);

    let snapshot = viewModel.getSnapshot();
    expect(snapshot.slots).toHaveLength(1);
    expect(snapshot.slots[0].gcdActive).toBe(true);
    expect(snapshot.slots[0].cooldownActive).toBe(true);
    expect(snapshot.slots[0].abilityLabel.length).toBeGreaterThan(0);
    expect(snapshot.slots[0].iconId).toBe(ability.iconId);
    expect(snapshot.slots[0].abilityCooldownText).toMatch(/s$/);

    hotbar.setKeyDown(0, true);
    viewModel.tick(nowMs);
    snapshot = viewModel.getSnapshot();
    expect(snapshot.slots[0].isPressed).toBe(true);
  });

  it('clears snapshot on clear', () => {
    const viewModel = new HotbarViewModel();
    viewModel.clear();
    expect(viewModel.getSnapshot().slots).toHaveLength(0);
  });
});
