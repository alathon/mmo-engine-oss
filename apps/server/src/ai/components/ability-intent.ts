export interface AbilityIntent {
  abilityId?: string;
  targetId?: string;
  targetPosition?: { x: number; y: number; z: number };
  requestedAtMs: number;
}
