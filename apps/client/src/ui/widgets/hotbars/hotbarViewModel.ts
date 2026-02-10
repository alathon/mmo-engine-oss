import {
  ABILITY_DEFINITIONS,
  type AbilityDefinition,
  type ResourceCost,
} from "@mmo/shared";
import type { CombatPredictionState } from "../../../combat/combatPredictionState";
import type { HotbarSlot } from "./hotbarController";

type Listener = () => void;

export interface HotbarSlotSnapshot {
  index: number;
  keyLabel: string;
  abilityId?: string;
  iconId?: string;
  abilityName: string;
  abilityCooldownText: string;
  abilityCastText: string;
  abilityResourceText: string;
  abilityLabel: string;
  iconAlpha: number;
  isPressed: boolean;
  isCasting: boolean;
  gcdActive: boolean;
  gcdRatio: number;
  cooldownActive: boolean;
  cooldownRatio: number;
  cooldownText: string;
}

export interface HotbarViewSnapshot {
  slots: readonly HotbarSlotSnapshot[];
}

export interface HotbarDataSource {
  getSlotsRef(): readonly HotbarSlot[];
  isSlotKeyDown(index: number): boolean;
  activateSlot(index: number): void;
}

export interface CombatDataSource {
  getPredictionState(): CombatPredictionState;
  getCastingAbilityId(nowMs: number): string | undefined;
}

export class HotbarViewModel {
  private listeners = new Set<Listener>();
  private slots: HotbarSlotSnapshot[] = [];
  private snapshot: HotbarViewSnapshot = { slots: this.slots };
  private hotbar?: HotbarDataSource;
  private combat?: CombatDataSource;
  private disposed = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): HotbarViewSnapshot {
    return this.snapshot;
  }

  bind(hotbar: HotbarDataSource, combat: CombatDataSource): void {
    this.hotbar = hotbar;
    this.combat = combat;
    this.tick(Date.now());
  }

  clear(): void {
    this.hotbar = undefined;
    this.combat = undefined;
    if (this.slots.length === 0) {
      return;
    }
    this.slots = [];
    this.snapshot = { slots: this.slots };
    if (!this.disposed) {
      this.emit();
    }
  }

  activateSlot(index: number): void {
    if (this.disposed) {
      return;
    }
    this.hotbar?.activateSlot(index);
  }

  tick(nowMs: number): void {
    if (this.disposed || !this.hotbar || !this.combat) {
      return;
    }

    const slotData = this.hotbar.getSlotsRef();
    let changed = false;

    if (slotData.length !== this.slots.length) {
      this.rebuildSlots(slotData.length);
      changed = true;
    }

    const prediction = this.combat.getPredictionState();
    const castingAbilityId = this.combat.getCastingAbilityId(nowMs);
    const cooldowns = prediction.getAbilitiesOnCooldown();
    const gcdDisplay = getGcdDisplay(
      prediction.getPredictedGcdStartTimeMs(),
      prediction.getPredictedGcdEndTimeMs(),
      nowMs,
    );

    for (let i = 0; i < slotData.length; i += 1) {
      const slot = slotData[i];
      const slotSnapshot = this.slots[i];
      if (!slotSnapshot) {
        continue;
      }

      if (slotSnapshot.index !== slot.index) {
        slotSnapshot.index = slot.index;
        changed = true;
      }

      const keyLabel = slot.key ? slot.key.toUpperCase() : "";
      if (slotSnapshot.keyLabel !== keyLabel) {
        slotSnapshot.keyLabel = keyLabel;
        changed = true;
      }

      const abilityId =
        slot.action.type === "ability" ? slot.action.abilityId : undefined;
      if (slotSnapshot.abilityId !== abilityId) {
        slotSnapshot.abilityId = abilityId;
        changed = true;
      }

      const isPressed = this.hotbar.isSlotKeyDown(slot.index);
      if (slotSnapshot.isPressed !== isPressed) {
        slotSnapshot.isPressed = isPressed;
        changed = true;
      }

      let abilityLabel = "";
      let abilityName = "";
      let iconId: string | undefined = undefined;
      let abilityCooldownText = "";
      let abilityCastText = "";
      let abilityResourceText = "";
      let iconAlpha = 0.35;
      let isCasting = false;
      let gcdActive = false;
      let gcdRatio = 0;
      let cooldownActive = false;
      let cooldownRatio = 0;
      let cooldownText = "";

      if (abilityId) {
        const ability = ABILITY_DEFINITIONS[
          abilityId as keyof typeof ABILITY_DEFINITIONS
        ] as AbilityDefinition | undefined;
        if (ability) {
          abilityLabel = getAbilityLabel(ability);
          abilityName = ability.name;
          iconId = ability.iconId;
          abilityCooldownText = formatAbilityCooldown(ability.cooldownMs);
          abilityCastText = formatAbilityCastTime(ability.castTimeMs);
          abilityResourceText = formatAbilityResourceCosts(
            ability.resourceCosts,
          );
          isCasting = castingAbilityId === ability.id;

          const cooldownEnd = cooldowns.get(abilityId);
          const cooldownDisplay = getCooldownDisplay(
            ability,
            cooldownEnd,
            nowMs,
          );

          cooldownActive = cooldownDisplay.active;
          cooldownRatio = cooldownDisplay.ratio;
          cooldownText = cooldownActive
            ? formatCooldownText(cooldownDisplay.remainingMs)
            : "";

          gcdActive = gcdDisplay.active && ability.isOnGcd;
          gcdRatio = gcdActive ? gcdDisplay.ratio : 0;

          iconAlpha = cooldownActive ? 0.55 : 1;
        }
      }

      if (slotSnapshot.abilityLabel !== abilityLabel) {
        slotSnapshot.abilityLabel = abilityLabel;
        changed = true;
      }

      if (slotSnapshot.iconId !== iconId) {
        slotSnapshot.iconId = iconId;
        changed = true;
      }

      if (slotSnapshot.abilityName !== abilityName) {
        slotSnapshot.abilityName = abilityName;
        changed = true;
      }

      if (slotSnapshot.abilityCooldownText !== abilityCooldownText) {
        slotSnapshot.abilityCooldownText = abilityCooldownText;
        changed = true;
      }

      if (slotSnapshot.abilityCastText !== abilityCastText) {
        slotSnapshot.abilityCastText = abilityCastText;
        changed = true;
      }

      if (slotSnapshot.abilityResourceText !== abilityResourceText) {
        slotSnapshot.abilityResourceText = abilityResourceText;
        changed = true;
      }

      if (slotSnapshot.iconAlpha !== iconAlpha) {
        slotSnapshot.iconAlpha = iconAlpha;
        changed = true;
      }

      if (slotSnapshot.isCasting !== isCasting) {
        slotSnapshot.isCasting = isCasting;
        changed = true;
      }

      if (slotSnapshot.gcdActive !== gcdActive) {
        slotSnapshot.gcdActive = gcdActive;
        changed = true;
      }

      if (slotSnapshot.gcdRatio !== gcdRatio) {
        slotSnapshot.gcdRatio = gcdRatio;
        changed = true;
      }

      if (slotSnapshot.cooldownActive !== cooldownActive) {
        slotSnapshot.cooldownActive = cooldownActive;
        changed = true;
      }

      if (slotSnapshot.cooldownRatio !== cooldownRatio) {
        slotSnapshot.cooldownRatio = cooldownRatio;
        changed = true;
      }

      if (slotSnapshot.cooldownText !== cooldownText) {
        slotSnapshot.cooldownText = cooldownText;
        changed = true;
      }
    }

    if (changed) {
      this.emit();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.hotbar = undefined;
    this.combat = undefined;
    this.slots = [];
    this.snapshot = { slots: this.slots };
  }

  private emit(): void {
    this.snapshot = { slots: this.slots };
    this.listeners.forEach((listener) => {
      listener();
    });
  }

  private rebuildSlots(count: number): void {
    this.slots = [];
    for (let i = 0; i < count; i += 1) {
      this.slots.push(createSlotSnapshot(i));
    }
  }
}

const createSlotSnapshot = (index: number): HotbarSlotSnapshot => ({
  index,
  keyLabel: "",
  abilityId: undefined,
  iconId: undefined,
  abilityName: "",
  abilityCooldownText: "",
  abilityCastText: "",
  abilityResourceText: "",
  abilityLabel: "",
  iconAlpha: 0.35,
  isPressed: false,
  isCasting: false,
  gcdActive: false,
  gcdRatio: 0,
  cooldownActive: false,
  cooldownRatio: 0,
  cooldownText: "",
});

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const getAbilityLabel = (ability: AbilityDefinition): string => {
  const words = ability.name.split(" ").filter(Boolean);
  if (words.length === 0) {
    return ability.id.slice(0, 3).toUpperCase();
  }
  const initials = words.map((word) => word[0]).join("");
  return initials.slice(0, 3).toUpperCase();
};

const getCooldownDisplay = (
  ability: AbilityDefinition,
  cooldownEnd: number | undefined,
  nowMs: number,
): { active: boolean; ratio: number; remainingMs: number } => {
  if (!cooldownEnd || ability.cooldownMs <= 0) {
    return { active: false, ratio: 0, remainingMs: 0 };
  }

  const cooldownStart = cooldownEnd - ability.cooldownMs;
  if (nowMs < cooldownStart) {
    return { active: false, ratio: 0, remainingMs: 0 };
  }

  const remainingMs = Math.max(0, cooldownEnd - nowMs);
  const ratio = clamp(remainingMs / ability.cooldownMs, 0, 1);
  return { active: remainingMs > 0, ratio, remainingMs };
};

const formatCooldownText = (remainingMs: number): string => {
  if (remainingMs <= 0) {
    return "";
  }

  return (remainingMs / 1000).toFixed(1);
};

const formatAbilityCooldown = (cooldownMs: number): string => {
  if (cooldownMs <= 0) {
    return "";
  }
  const seconds = Math.max(0, cooldownMs) / 1000;
  return `${seconds.toFixed(1)}s`;
};

const formatAbilityCastTime = (castTimeMs: number): string => {
  if (castTimeMs <= 0) {
    return "Instant";
  }
  const seconds = Math.max(0, castTimeMs) / 1000;
  return `${seconds.toFixed(1)}s`;
};

const formatAbilityResourceCosts = (costs?: ResourceCost[]): string => {
  if (!costs || costs.length === 0) {
    return "None";
  }

  const entries = costs
    .filter((cost) => cost.amount > 0)
    .map((cost) => `${cost.amount} ${capitalize(cost.type)}`);

  if (entries.length === 0) {
    return "None";
  }

  return entries.join(", ");
};

const capitalize = (value: string): string => {
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
};

const getGcdDisplay = (
  gcdStart: number,
  gcdEnd: number,
  nowMs: number,
): { active: boolean; ratio: number; remainingMs: number } => {
  if (gcdEnd <= nowMs || gcdEnd <= gcdStart) {
    return { active: false, ratio: 0, remainingMs: 0 };
  }

  if (nowMs < gcdStart) {
    return { active: false, ratio: 0, remainingMs: 0 };
  }

  const remainingMs = Math.max(0, gcdEnd - nowMs);
  const durationMs = Math.max(1, gcdEnd - gcdStart);
  const ratio = clamp(remainingMs / durationMs, 0, 1);
  return { active: remainingMs > 0, ratio, remainingMs };
};
