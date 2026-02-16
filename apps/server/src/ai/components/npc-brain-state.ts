import type { NavcatQuery } from "@mmo/shared";

export type SmoothPathPoint = ReturnType<NavcatQuery["findSmoothPath"]>["path"][number];

export interface NpcBrainState {
  targetYaw: number;
  nextDecisionAtMs: number;
  movingUntilMs: number;
  elapsedTimeMs: number;
  chaseTargetId?: string;
  chaseTargetX: number;
  chaseTargetZ: number;
  chasePath: SmoothPathPoint[];
  chasePathIndex: number;
  lastRepathAtMs: number;
}
