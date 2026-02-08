/**
 * Server AI tuning constants.
 */
import { PLAYER_SPEED } from "@mmo/shared";

export interface NpcAiConfig {
  minIdleMs: number;
  maxIdleMs: number;
  moveDurationMs: number;
  moveSpeed: number;
}

/**
 * Default wandering NPC movement parameters.
 */
export const DEFAULT_NPC_AI_CONFIG: NpcAiConfig = {
  minIdleMs: 500,
  maxIdleMs: 1500,
  moveDurationMs: 900,
  moveSpeed: PLAYER_SPEED,
};
