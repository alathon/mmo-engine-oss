import {
  ABILITY_DEFINITIONS,
  hasLineOfSight,
  type NavcatQuery,
} from "@mmo/shared";
import type { ServerNPC } from "../entities/npc";
import type { ServerPlayer } from "../entities/player";
import type { ServerZone } from "./zone";

interface TargetCandidate {
  id: string;
  x: number;
  y: number;
  z: number;
}

const LOS_CELL_SIZE = 8;
const LOS_MOVE_THRESHOLD = 0.5;
const LOS_MAX_STALE_TICKS = 6;
const LOS_UPDATE_STRIDE = 3;
const LOS_MAX_RANGE = Math.max(
  0,
  ...Object.values(ABILITY_DEFINITIONS).map((ability) => ability.range),
);

export class LineOfSightTracker {
  private readonly cellSize = LOS_CELL_SIZE;
  private readonly maxRangeSq = LOS_MAX_RANGE * LOS_MAX_RANGE;
  private readonly cellRadius = Math.ceil(LOS_MAX_RANGE / LOS_CELL_SIZE);
  private readonly moveThresholdSq = LOS_MOVE_THRESHOLD * LOS_MOVE_THRESHOLD;
  private readonly maxStaleTicks = LOS_MAX_STALE_TICKS;
  private readonly updateStride = LOS_UPDATE_STRIDE;

  private readonly lastPositions = new Map<string, { x: number; z: number }>();
  private readonly lastUpdateTick = new Map<string, number>();

  update(zone: ServerZone, serverTick: number): void {
    if (zone.players.size === 0) {
      return;
    }

    const candidates = this.collectCandidates(zone);
    const grid = this.buildSpatialGrid(candidates);
    const navmesh = zone.zoneData.navmeshQuery;
    const strideOffset = serverTick % this.updateStride;
    let index = 0;

    for (const player of zone.players.values()) {
      if (index % this.updateStride !== strideOffset) {
        index += 1;
        continue;
      }

      this.updatePlayer(player, navmesh, grid, serverTick);
      index += 1;
    }

    this.prunePlayerCache(zone);
  }

  private updatePlayer(
    player: ServerPlayer,
    navmesh: NavcatQuery | undefined,
    grid: Map<string, TargetCandidate[]>,
    serverTick: number,
  ): void {
    const prevPos = this.lastPositions.get(player.id);
    const lastTick = this.lastUpdateTick.get(player.id) ?? -Infinity;
    const dx = prevPos ? player.synced.x - prevPos.x : Infinity;
    const dz = prevPos ? player.synced.z - prevPos.z : Infinity;
    const movedSq = dx * dx + dz * dz;
    const ticksSince = serverTick - lastTick;

    if (movedSq < this.moveThresholdSq && ticksSince < this.maxStaleTicks) {
      return;
    }

    this.lastPositions.set(player.id, {
      x: player.synced.x,
      z: player.synced.z,
    });
    this.lastUpdateTick.set(player.id, serverTick);

    const nearby = this.collectNearbyCandidates(
      grid,
      player.synced.x,
      player.synced.z,
    );
    const visibleTargets: string[] = [];

    for (const candidate of nearby) {
      if (candidate.id === player.id) {
        continue;
      }
      const dx = candidate.x - player.synced.x;
      const dy = candidate.y - player.synced.y;
      const dz = candidate.z - player.synced.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > this.maxRangeSq) {
        continue;
      }

      if (
        navmesh &&
        !hasLineOfSight(
          navmesh,
          { x: player.synced.x, y: player.synced.y, z: player.synced.z },
          { x: candidate.x, y: candidate.y, z: candidate.z },
        )
      ) {
        continue;
      }

      visibleTargets.push(candidate.id);
    }

    visibleTargets.sort();
    this.applyVisibleTargets(player, visibleTargets);
  }

  private applyVisibleTargets(
    player: ServerPlayer,
    visibleTargets: string[],
  ): void {
    const existing = player.synced.visibleTargets;
    if (existing.length === visibleTargets.length) {
      let same = true;
      for (let i = 0; i < existing.length; i += 1) {
        if (existing[i] !== visibleTargets[i]) {
          same = false;
          break;
        }
      }
      if (same) {
        return;
      }
    }

    if (existing.length > 0) {
      existing.splice(0, existing.length);
    }
    for (const targetId of visibleTargets) {
      existing.push(targetId);
    }
  }

  private collectCandidates(zone: ServerZone): TargetCandidate[] {
    const candidates: TargetCandidate[] = [];
    for (const player of zone.players.values()) {
      candidates.push({
        id: player.id,
        x: player.synced.x,
        y: player.synced.y,
        z: player.synced.z,
      });
    }
    for (const npc of zone.npcs.values()) {
      candidates.push(this.toCandidate(npc));
    }
    return candidates;
  }

  private toCandidate(npc: ServerNPC): TargetCandidate {
    return {
      id: npc.id,
      x: npc.synced.x,
      y: npc.synced.y,
      z: npc.synced.z,
    };
  }

  private buildSpatialGrid(
    candidates: TargetCandidate[],
  ): Map<string, TargetCandidate[]> {
    const grid = new Map<string, TargetCandidate[]>();
    for (const candidate of candidates) {
      const key = this.cellKey(candidate.x, candidate.z);
      const bucket = grid.get(key);
      if (bucket) {
        bucket.push(candidate);
      } else {
        grid.set(key, [candidate]);
      }
    }
    return grid;
  }

  private collectNearbyCandidates(
    grid: Map<string, TargetCandidate[]>,
    x: number,
    z: number,
  ): TargetCandidate[] {
    const centerX = Math.floor(x / this.cellSize);
    const centerZ = Math.floor(z / this.cellSize);
    const results: TargetCandidate[] = [];

    for (let dx = -this.cellRadius; dx <= this.cellRadius; dx += 1) {
      for (let dz = -this.cellRadius; dz <= this.cellRadius; dz += 1) {
        const key = `${centerX + dx},${centerZ + dz}`;
        const bucket = grid.get(key);
        if (bucket) {
          results.push(...bucket);
        }
      }
    }
    return results;
  }

  private cellKey(x: number, z: number): string {
    const cellX = Math.floor(x / this.cellSize);
    const cellZ = Math.floor(z / this.cellSize);
    return `${cellX},${cellZ}`;
  }

  private prunePlayerCache(zone: ServerZone): void {
    if (this.lastPositions.size === 0) {
      return;
    }
    const activeIds = new Set(zone.players.keys());
    for (const id of this.lastPositions.keys()) {
      if (!activeIds.has(id)) {
        this.lastPositions.delete(id);
        this.lastUpdateTick.delete(id);
      }
    }
  }
}
