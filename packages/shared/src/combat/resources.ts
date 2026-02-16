export type ResourceType = "mana" | "stamina";

export interface ResourceCost {
  type: ResourceType;
  amount: number;
}

export interface ResourceState {
  mana: number;
  stamina: number;
}

export const canPayResourceCost = (state: ResourceState, costs?: ResourceCost[]): boolean => {
  if (!costs || costs.length === 0) {
    return true;
  }

  for (const cost of costs) {
    if (cost.amount <= 0) {
      continue;
    }
    if (cost.type === "mana") {
      if (state.mana < cost.amount) {
        return false;
      }
    } else if (cost.type === "stamina" && state.stamina < cost.amount) {
      return false;
    }
  }

  return true;
};
