import type { MobState, ResourceCost } from "@mmo/shared-sim";

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const applyDamage = (target: MobState, amount: number): void => {
  if (amount <= 0) {
    return;
  }
  target.currentHp = clamp(target.currentHp - amount, 0, target.maxHp);
};

export const applyHealing = (target: MobState, amount: number): void => {
  if (amount <= 0) {
    return;
  }
  target.currentHp = clamp(target.currentHp + amount, 0, target.maxHp);
};

export const applyStatus = (): void => {
  // Status effects are not implemented yet.
};

export const applyDisplacement = (): void => {
  // Displacement effects are not implemented yet.
};

export const applyResourceCost = (target: MobState, costs?: ResourceCost[]): void => {
  if (!costs || costs.length === 0) {
    return;
  }

  for (const cost of costs) {
    if (cost.amount <= 0) {
      continue;
    }
    if (cost.type === "mana") {
      target.mana = Math.max(0, target.mana - cost.amount);
    } else if (cost.type === "stamina") {
      target.stamina = Math.max(0, target.stamina - cost.amount);
    }
  }
};
