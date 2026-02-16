import type { NpcAiConfig } from "../../world/constants/ai";
import type { ServerZone } from "../../world/zones/zone";
import type { NpcBrainState } from "../components/npc-brain-state";

const MELEE_RANGE = 2;
const MELEE_RANGE_SQ = MELEE_RANGE * MELEE_RANGE;

export class AiDecisionSystem {
  update(zone: ServerZone): void {
    for (const npc of zone.npcs.values()) {
      const brain = npc.brainState;
      const selection = npc.targetSelection;
      const behavior = npc.behaviorIntent;
      const nowMs = brain.elapsedTimeMs;

      if (selection.targetId) {
        const dx = selection.targetX - npc.synced.x;
        const dz = selection.targetZ - npc.synced.z;
        const distanceSq = dx * dx + dz * dz;
        selection.targetYaw = Math.atan2(dx, dz);
        behavior.desiredRange = MELEE_RANGE;
        behavior.moveUntilMs = nowMs;

        if (distanceSq <= MELEE_RANGE_SQ || distanceSq <= 0.0001) {
          behavior.mode = "idle";
          brain.movingUntilMs = nowMs;
          continue;
        }

        behavior.mode = "chase";
        continue;
      }

      this.resetChasePath(brain);

      if (nowMs >= brain.nextDecisionAtMs) {
        this.chooseNextMove(brain, npc.aiConfig, nowMs);
      }

      if (nowMs > brain.movingUntilMs) {
        behavior.mode = "idle";
        behavior.desiredRange = 0;
        behavior.moveUntilMs = brain.movingUntilMs;
        continue;
      }

      behavior.mode = "wander";
      behavior.desiredRange = 0;
      behavior.moveUntilMs = brain.movingUntilMs;
    }
  }

  private resetChasePath(brain: NpcBrainState): void {
    if (brain.chaseTargetId === undefined && brain.chasePath.length === 0) {
      return;
    }
    brain.chaseTargetId = undefined;
    brain.chasePath.length = 0;
    brain.chasePathIndex = 0;
  }

  private chooseNextMove(brain: NpcBrainState, config: NpcAiConfig, nowMs: number): void {
    const idleRange = config.maxIdleMs - config.minIdleMs;
    const idleMs = config.minIdleMs + Math.random() * idleRange;
    brain.targetYaw = Math.random() * Math.PI * 2;
    brain.movingUntilMs = nowMs + config.moveDurationMs;
    brain.nextDecisionAtMs = brain.movingUntilMs + idleMs;
  }
}
