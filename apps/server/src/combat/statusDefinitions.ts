import type { StatusDefinitionMap } from "./statusController";

export const STATUS_DEFINITIONS: StatusDefinitionMap = {
  stunned: {
    id: "stunned",
    name: "Concussed",
    category: "debuff",
    durationMs: 1000,
    stacking: "replace",
    stateFlags: ["stunned"],
  },
  silenced: {
    id: "silenced",
    name: "Gag Order",
    category: "debuff",
    durationMs: 1000,
    stacking: "replace",
    stateFlags: ["silenced"],
    blockedAbilityTags: ["spell"],
  },
  disarmed: {
    id: "disarmed",
    name: "Weapon Lock",
    category: "debuff",
    durationMs: 1000,
    stacking: "replace",
    stateFlags: ["disarmed"],
    blockedAbilityTags: ["melee", "ranged"],
  },
  rooted: {
    id: "rooted",
    name: "Ironbind",
    category: "debuff",
    durationMs: 1000,
    stacking: "replace",
    stateFlags: ["rooted"],
    blockedAbilityTags: ["movement"],
  },
};
