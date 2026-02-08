import type { MobState, NavcatQuery } from "@mmo/shared";
import type { NpcAiState, ServerNPC } from "./npc";
import { DEFAULT_NPC_AI_CONFIG, NpcAiConfig } from "../constants/ai";
import type { ServerMob } from "./serverMob";

const MELEE_RANGE = 2;
const MELEE_RANGE_SQ = MELEE_RANGE * MELEE_RANGE;
const SMOOTH_PATH_STEP_DISTANCE = 0.4;
const SMOOTH_PATH_SLOP_DISTANCE = 0.2;
const SMOOTH_PATH_MAX_POINTS = 32;
const CHASE_REPATH_DISTANCE = 0.5;
const CHASE_REPATH_DISTANCE_SQ = CHASE_REPATH_DISTANCE * CHASE_REPATH_DISTANCE;
const CHASE_REPATH_COOLDOWN_MS = 100;
const CHASE_WAYPOINT_REACHED = 0.15;
const CHASE_WAYPOINT_REACHED_SQ =
  CHASE_WAYPOINT_REACHED * CHASE_WAYPOINT_REACHED;

type SmoothPathPoint = ReturnType<
  NavcatQuery["findSmoothPath"]
>["path"][number];

/**
 * Simple wanderer AI that chooses random directions at intervals.
 */
export class NpcAi {
  private readonly config: NpcAiConfig;
  private readonly npc: ServerNPC;
  private readonly aiState: NpcAiState;
  private elapsedTimeMs = 0;
  private chaseTargetId: string | null = null;
  private chaseTargetX = 0;
  private chaseTargetZ = 0;
  private chasePath: SmoothPathPoint[] = [];
  private chasePathIndex = 0;
  private lastRepathAtMs = -Infinity;

  /**
   * Creates a new NPC AI controller.
   *
   * @param npc - server-side NPC wrapper.
   * @param config - optional AI config overrides.
   */
  constructor(npc: ServerNPC, config?: Partial<NpcAiConfig>) {
    this.config = { ...DEFAULT_NPC_AI_CONFIG, ...config };
    this.npc = npc;
    this.aiState = {
      targetYaw: 0,
      nextDecisionAtMs: 0,
      movingUntilMs: 0,
    };
  }

  /**
   * Updates the NPC position and facing based on AI state.
   *
   * @param npc - server-side NPC wrapper.
   * @param navmesh - navmesh query for movement validation.
   * @param deltaTimeMs - elapsed time since last update in milliseconds.
   * @param resolveCombatant - resolver for combat target positions.
   */
  updateMob(
    navmesh: NavcatQuery | null,
    deltaTimeMs: number,
    combatants?: Iterable<ServerMob<MobState>>,
  ): void {
    const state = this.aiState;
    this.elapsedTimeMs += deltaTimeMs;
    const nowMs = this.elapsedTimeMs;

    if (this.npc.synced.inCombat && combatants) {
      const targetId = this.npc.aggro.getTopTargetId();
      if (targetId) {
        const target = this.resolveCombatant(targetId, combatants);
        if (target) {
          this.updateChase(target, navmesh, deltaTimeMs, nowMs);
          return;
        }
      }
    }
    this.resetChasePath();

    if (nowMs >= state.nextDecisionAtMs) {
      this.chooseNextMove(nowMs);
    }

    if (nowMs > state.movingUntilMs) {
      this.npc.dirX = 0;
      this.npc.dirZ = 0;
      return;
    }

    const dx = Math.sin(state.targetYaw);
    const dz = Math.cos(state.targetYaw);
    this.npc.dirX = dx;
    this.npc.dirZ = dz;
    this.npc.synced.facingYaw = state.targetYaw;

    const deltaSeconds = deltaTimeMs / 1000;
    const moveX = dx * this.config.moveSpeed * deltaSeconds;
    const moveZ = dz * this.config.moveSpeed * deltaSeconds;

    if (!navmesh) {
      this.npc.synced.x += moveX;
      this.npc.synced.z += moveZ;
      return;
    }

    const result = navmesh.validateMovement(
      this.npc.synced.x,
      this.npc.synced.z,
      moveX,
      moveZ,
      this.npc.navmeshNodeRef ?? undefined,
    );
    this.npc.synced.x = result.x;
    this.npc.synced.y = result.y;
    this.npc.synced.z = result.z;
    this.npc.navmeshNodeRef = result.nodeRef ?? null;

    if (result.collided && result.movementRatio < 0.01) {
      this.aiState.movingUntilMs = nowMs;
    }
  }

  private resolveCombatant(
    targetId: string,
    combatants: Iterable<ServerMob<MobState>>,
  ): ServerMob<MobState> | undefined {
    for (const combatant of combatants) {
      if (combatant.id === targetId) {
        return combatant;
      }
    }
    return undefined;
  }

  private updateChase(
    target: ServerMob<MobState>,
    navmesh: NavcatQuery | null,
    deltaTimeMs: number,
    nowMs: number,
  ): void {
    const targetDx = target.synced.x - this.npc.synced.x;
    const targetDz = target.synced.z - this.npc.synced.z;
    const distanceSq = targetDx * targetDx + targetDz * targetDz;
    const targetYaw = Math.atan2(targetDx, targetDz);

    if (distanceSq <= MELEE_RANGE_SQ || distanceSq <= 0.0001) {
      this.npc.dirX = 0;
      this.npc.dirZ = 0;
      this.npc.synced.facingYaw = targetYaw;
      this.aiState.movingUntilMs = nowMs;
      return;
    }

    const deltaSeconds = deltaTimeMs / 1000;
    const moveDistance = this.config.moveSpeed * deltaSeconds;

    let steerX = target.synced.x;
    let steerZ = target.synced.z;

    if (navmesh) {
      const waypoint = this.getChaseWaypoint(navmesh, target, nowMs);
      if (waypoint) {
        steerX = waypoint.position[0];
        steerZ = waypoint.position[2];
      }
    }

    const dx = steerX - this.npc.synced.x;
    const dz = steerZ - this.npc.synced.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq <= 0.0001) {
      this.npc.dirX = 0;
      this.npc.dirZ = 0;
      this.npc.synced.facingYaw = targetYaw;
      this.aiState.movingUntilMs = nowMs;
      return;
    }

    const length = Math.sqrt(lengthSq);
    const dirX = dx / length;
    const dirZ = dz / length;
    this.npc.dirX = dirX;
    this.npc.dirZ = dirZ;
    this.npc.synced.facingYaw = Math.atan2(dirX, dirZ);

    const stepDistance = Math.min(moveDistance, length);
    const moveX = dirX * stepDistance;
    const moveZ = dirZ * stepDistance;

    if (!navmesh) {
      this.npc.synced.x += moveX;
      this.npc.synced.z += moveZ;
      return;
    }

    const result = navmesh.validateMovement(
      this.npc.synced.x,
      this.npc.synced.z,
      moveX,
      moveZ,
      this.npc.navmeshNodeRef ?? undefined,
    );
    this.npc.synced.x = result.x;
    this.npc.synced.y = result.y;
    this.npc.synced.z = result.z;
    this.npc.navmeshNodeRef = result.nodeRef ?? null;

    if (result.collided && result.movementRatio < 0.01) {
      this.aiState.movingUntilMs = nowMs;
    }
  }

  private getChaseWaypoint(
    navmesh: NavcatQuery,
    target: ServerMob<MobState>,
    nowMs: number,
  ): SmoothPathPoint | null {
    const targetId = target.id;
    const targetX = target.synced.x;
    const targetZ = target.synced.z;
    const targetChanged = this.chaseTargetId !== targetId;
    const hasTarget = this.chaseTargetId !== null;
    const needsPath = this.chasePath.length === 0;
    const targetMoved =
      hasTarget &&
      (targetX - this.chaseTargetX) * (targetX - this.chaseTargetX) +
        (targetZ - this.chaseTargetZ) * (targetZ - this.chaseTargetZ) >
        CHASE_REPATH_DISTANCE_SQ;
    const cooldownElapsed =
      nowMs - this.lastRepathAtMs >= CHASE_REPATH_COOLDOWN_MS;

    if (
      !hasTarget ||
      targetChanged ||
      needsPath ||
      (targetMoved && cooldownElapsed)
    ) {
      this.recomputeChasePath(navmesh, targetId, targetX, targetZ, nowMs);
    }

    const path = this.chasePath;
    while (this.chasePathIndex < path.length) {
      const point = path[this.chasePathIndex];
      const dx = point.position[0] - this.npc.synced.x;
      const dz = point.position[2] - this.npc.synced.z;
      if (dx * dx + dz * dz <= CHASE_WAYPOINT_REACHED_SQ) {
        this.chasePathIndex += 1;
        continue;
      }
      return point;
    }

    return null;
  }

  private recomputeChasePath(
    navmesh: NavcatQuery,
    targetId: string,
    targetX: number,
    targetZ: number,
    nowMs: number,
  ): void {
    const pathResult = navmesh.findSmoothPath(
      this.npc.synced.x,
      this.npc.synced.z,
      targetX,
      targetZ,
      SMOOTH_PATH_STEP_DISTANCE,
      SMOOTH_PATH_SLOP_DISTANCE,
      SMOOTH_PATH_MAX_POINTS,
    );
    this.chasePath = pathResult.success ? pathResult.path : [];
    this.chasePathIndex = this.chasePath.length > 1 ? 1 : 0;
    this.chaseTargetId = targetId;
    this.chaseTargetX = targetX;
    this.chaseTargetZ = targetZ;
    this.lastRepathAtMs = nowMs;
  }

  private resetChasePath(): void {
    if (this.chaseTargetId === null && this.chasePath.length === 0) {
      return;
    }
    this.chaseTargetId = null;
    this.chasePath.length = 0;
    this.chasePathIndex = 0;
  }

  private chooseNextMove(nowMs: number): void {
    const idleRange = this.config.maxIdleMs - this.config.minIdleMs;
    const idleMs = this.config.minIdleMs + Math.random() * idleRange;
    this.aiState.targetYaw = Math.random() * Math.PI * 2;
    this.aiState.movingUntilMs = nowMs + this.config.moveDurationMs;
    this.aiState.nextDecisionAtMs = this.aiState.movingUntilMs + idleMs;
  }
}
