import type { NavcatQuery } from "@mmo/shared-sim";
import type { ServerNPC } from "../../world/entities/npc";
import type { ServerZone } from "../../world/zones/zone";
import type { SmoothPathPoint } from "../components/npc-brain-state";

const MELEE_RANGE = 2;
const MELEE_RANGE_SQ = MELEE_RANGE * MELEE_RANGE;
const SMOOTH_PATH_STEP_DISTANCE = 0.4;
const SMOOTH_PATH_SLOP_DISTANCE = 0.2;
const SMOOTH_PATH_MAX_POINTS = 32;
const CHASE_REPATH_DISTANCE = 0.5;
const CHASE_REPATH_DISTANCE_SQ = CHASE_REPATH_DISTANCE * CHASE_REPATH_DISTANCE;
const CHASE_REPATH_COOLDOWN_MS = 100;
const CHASE_WAYPOINT_REACHED = 0.15;
const CHASE_WAYPOINT_REACHED_SQ = CHASE_WAYPOINT_REACHED * CHASE_WAYPOINT_REACHED;

export class AiSteeringSystem {
  update(zone: ServerZone, navmesh: NavcatQuery): void {
    for (const npc of zone.npcs.values()) {
      const behavior = npc.behaviorIntent;
      const steering = npc.steeringIntent;

      if (behavior.mode === "chase") {
        this.updateChase(npc, navmesh);
        continue;
      }

      if (behavior.mode === "wander") {
        const brain = npc.brainState;
        steering.directionX = Math.sin(brain.targetYaw);
        steering.directionZ = Math.cos(brain.targetYaw);
        steering.facingYaw = brain.targetYaw;
        continue;
      }

      steering.directionX = 0;
      steering.directionZ = 0;
      if (npc.targetSelection.targetId) {
        steering.facingYaw = npc.targetSelection.targetYaw;
      }
    }
  }

  private updateChase(npc: ServerNPC, navmesh: NavcatQuery): void {
    const selection = npc.targetSelection;
    const steering = npc.steeringIntent;
    if (!selection.targetId) {
      steering.directionX = 0;
      steering.directionZ = 0;
      return;
    }

    const targetDx = selection.targetX - npc.synced.x;
    const targetDz = selection.targetZ - npc.synced.z;
    const distanceSq = targetDx * targetDx + targetDz * targetDz;
    const targetYaw = Math.atan2(targetDx, targetDz);
    selection.targetYaw = targetYaw;

    if (distanceSq <= MELEE_RANGE_SQ || distanceSq <= 0.0001) {
      steering.directionX = 0;
      steering.directionZ = 0;
      steering.facingYaw = targetYaw;
      return;
    }

    let steerX = selection.targetX;
    let steerZ = selection.targetZ;
    const waypoint = this.getChaseWaypoint(npc, navmesh);
    if (waypoint) {
      steerX = waypoint.position[0];
      steerZ = waypoint.position[2];
    }

    const dx = steerX - npc.synced.x;
    const dz = steerZ - npc.synced.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq <= 0.0001) {
      steering.directionX = 0;
      steering.directionZ = 0;
      steering.facingYaw = targetYaw;
      return;
    }

    const length = Math.sqrt(lengthSq);
    const dirX = dx / length;
    const dirZ = dz / length;
    steering.directionX = dirX;
    steering.directionZ = dirZ;
    steering.facingYaw = Math.atan2(dirX, dirZ);
  }

  private getChaseWaypoint(npc: ServerNPC, navmesh: NavcatQuery): SmoothPathPoint | undefined {
    const selection = npc.targetSelection;
    const brain = npc.brainState;
    if (!selection.targetId) {
      return undefined;
    }

    const targetId = selection.targetId;
    const targetX = selection.targetX;
    const targetZ = selection.targetZ;
    const targetChanged = brain.chaseTargetId !== targetId;
    const hasTarget = brain.chaseTargetId !== undefined;
    const needsPath = brain.chasePath.length === 0;
    const targetMoved =
      hasTarget &&
      (targetX - brain.chaseTargetX) * (targetX - brain.chaseTargetX) +
        (targetZ - brain.chaseTargetZ) * (targetZ - brain.chaseTargetZ) >
        CHASE_REPATH_DISTANCE_SQ;
    const nowMs = brain.elapsedTimeMs;
    const cooldownElapsed = nowMs - brain.lastRepathAtMs >= CHASE_REPATH_COOLDOWN_MS;

    if (!hasTarget || targetChanged || needsPath || (targetMoved && cooldownElapsed)) {
      this.recomputeChasePath(npc, navmesh, {
        targetId,
        targetX,
        targetZ,
        nowMs,
      });
    }

    const path = brain.chasePath;
    while (brain.chasePathIndex < path.length) {
      const point = path[brain.chasePathIndex];
      const dx = point.position[0] - npc.synced.x;
      const dz = point.position[2] - npc.synced.z;
      if (dx * dx + dz * dz <= CHASE_WAYPOINT_REACHED_SQ) {
        brain.chasePathIndex += 1;
        continue;
      }
      return point;
    }

    return undefined;
  }

  private recomputeChasePath(
    npc: ServerNPC,
    navmesh: NavcatQuery,
    info: {
      targetId: string;
      targetX: number;
      targetZ: number;
      nowMs: number;
    },
  ): void {
    const brain = npc.brainState;
    const pathResult = navmesh.findSmoothPath(
      npc.synced.x,
      npc.synced.z,
      info.targetX,
      info.targetZ,
      SMOOTH_PATH_STEP_DISTANCE,
      SMOOTH_PATH_SLOP_DISTANCE,
      SMOOTH_PATH_MAX_POINTS,
    );
    const path = brain.chasePath;
    path.length = 0;
    if (pathResult.success) {
      for (const point of pathResult.path) {
        path.push(point);
      }
    }
    brain.chasePathIndex = path.length > 1 ? 1 : 0;
    brain.chaseTargetId = info.targetId;
    brain.chaseTargetX = info.targetX;
    brain.chaseTargetZ = info.targetZ;
    brain.lastRepathAtMs = info.nowMs;
  }
}
