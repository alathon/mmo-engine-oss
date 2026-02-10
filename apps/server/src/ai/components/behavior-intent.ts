export type BehaviorMode = "idle" | "wander" | "chase";

export interface BehaviorIntent {
  mode: BehaviorMode;
  desiredRange: number;
  moveUntilMs: number;
}
