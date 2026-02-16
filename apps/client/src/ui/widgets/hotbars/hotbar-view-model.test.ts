import { describe, expect, it } from "vitest";
import { ABILITY_DEFINITIONS } from "@mmo/shared";
import type { HotbarSlot } from "./hotbar-controller";
import { HotbarViewModel } from "./hotbar-view-model";

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
  private gcdState = { active: false, ratio: 0, remainingMs: 0 };
  private cooldownStates = new Map<
    string,
    { active: boolean; ratio: number; remainingMs: number }
  >();
  private usingAbilityId?: string;

  getAbilityCooldownState(
    abilityId: string,
    _nowMs: number,
  ): {
    active: boolean;
    ratio: number;
    remainingMs: number;
  } {
    return this.cooldownStates.get(abilityId) ?? { active: false, ratio: 0, remainingMs: 0 };
  }

  getGcdState(_nowMs: number): { active: boolean; ratio: number; remainingMs: number } {
    return this.gcdState;
  }

  isUsingAbility(abilityId: string, _nowMs: number): boolean {
    return this.usingAbilityId === abilityId;
  }

  setGcdState(state: { active: boolean; ratio: number; remainingMs: number }): void {
    this.gcdState = state;
  }

  setCooldownState(
    abilityId: string,
    state: { active: boolean; ratio: number; remainingMs: number },
  ): void {
    this.cooldownStates.set(abilityId, state);
  }

  setUsingAbility(abilityId?: string): void {
    this.usingAbilityId = abilityId;
  }
}

describe("HotbarViewModel", () => {
  it("uses cooldown > gcd > casting visual priority and pressed state", () => {
    const abilityId = "shield_bash";
    const ability = ABILITY_DEFINITIONS[abilityId];
    if (!ability) {
      throw new Error("Missing ability definition for test");
    }

    const slots: HotbarSlot[] = [
      {
        index: 0,
        key: "1",
        action: { type: "ability", abilityId },
      },
    ];

    const hotbar = new FakeHotbar(slots);
    const combat = new FakeCombat();
    const nowMs = 1000;

    combat.setCooldownState(abilityId, { active: true, ratio: 0.4, remainingMs: 1000 });
    combat.setGcdState({ active: true, ratio: 0.7, remainingMs: 1750 });
    combat.setUsingAbility(abilityId);

    const viewModel = new HotbarViewModel();
    viewModel.bind(hotbar, combat);
    viewModel.tick(nowMs);

    let snapshot = viewModel.getSnapshot();
    expect(snapshot.slots).toHaveLength(1);
    expect(snapshot.slots[0].cooldownActive).toBe(true);
    expect(snapshot.slots[0].gcdActive).toBe(false);
    expect(snapshot.slots[0].isCasting).toBe(true);
    expect(snapshot.slots[0].iconAlpha).toBe(0.55);
    expect(snapshot.slots[0].abilityLabel.length).toBeGreaterThan(0);
    expect(snapshot.slots[0].iconId).toBe(ability.iconId);
    expect(snapshot.slots[0].abilityCooldownText).toMatch(/s$/);
    expect(snapshot.slots[0].cooldownText).toBe("1.0");

    combat.setCooldownState(abilityId, { active: false, ratio: 0, remainingMs: 0 });
    viewModel.tick(nowMs);
    snapshot = viewModel.getSnapshot();
    expect(snapshot.slots[0].cooldownActive).toBe(false);
    expect(snapshot.slots[0].gcdActive).toBe(true);
    expect(snapshot.slots[0].isCasting).toBe(true);
    expect(snapshot.slots[0].iconAlpha).toBe(1);

    combat.setGcdState({ active: false, ratio: 0, remainingMs: 0 });
    viewModel.tick(nowMs);
    snapshot = viewModel.getSnapshot();
    expect(snapshot.slots[0].cooldownActive).toBe(false);
    expect(snapshot.slots[0].gcdActive).toBe(false);
    expect(snapshot.slots[0].isCasting).toBe(true);
    expect(snapshot.slots[0].iconAlpha).toBe(1);

    hotbar.setKeyDown(0, true);
    viewModel.tick(nowMs);
    snapshot = viewModel.getSnapshot();
    expect(snapshot.slots[0].isPressed).toBe(true);
  });

  it("clears snapshot on clear", () => {
    const viewModel = new HotbarViewModel();
    viewModel.clear();
    expect(viewModel.getSnapshot().slots).toHaveLength(0);
  });
});
