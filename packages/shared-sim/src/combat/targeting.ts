import type { AbilityDefinition } from "./abilities";
import type { DirectionMode, TargetSpec, Vector3 } from "./targeting-types";

export interface TargetCandidate {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface ResolveTargetsParams {
  ability: AbilityDefinition;
  actor: {
    id: string;
    x: number;
    y: number;
    z: number;
    facingYaw: number;
  };
  target: TargetSpec;
  candidates: TargetCandidate[];
}

export interface ResolveTargetsResult {
  possibleTargetIds: string[];
  targetPosition?: Vector3;
}

export function resolveTargetsForAbility(
  params: ResolveTargetsParams,
): ResolveTargetsResult | null {
  const { ability, actor, target, candidates } = params;

  let targetPosition: Vector3 | undefined;
  let primaryTargetId: string | undefined;

  switch (ability.targetType) {
    case "self": {
      targetPosition = { x: actor.x, y: actor.y, z: actor.z };
      primaryTargetId = actor.id;
      break;
    }
    case "enemy":
    case "ally": {
      const targetId = target.targetEntityId;
      if (!targetId) {
        return null;
      }
      const targetCandidate = candidates.find((candidate) => candidate.id === targetId);
      if (!targetCandidate) {
        return null;
      }
      targetPosition = {
        x: targetCandidate.x,
        y: targetCandidate.y,
        z: targetCandidate.z,
      };
      primaryTargetId = targetId;
      break;
    }
    case "ground": {
      if (!target.targetPoint) {
        return null;
      }
      targetPosition = target.targetPoint;
      break;
    }
    default: {
      return null;
    }
  }

  const shape = ability.aoeShape;
  if (shape === "single") {
    if (ability.targetType === "self" && primaryTargetId) {
      return { possibleTargetIds: [primaryTargetId], targetPosition };
    }
    if ((ability.targetType === "enemy" || ability.targetType === "ally") && primaryTargetId) {
      return { possibleTargetIds: [primaryTargetId], targetPosition };
    }
    return { possibleTargetIds: [], targetPosition };
  }

  if (!targetPosition) {
    return null;
  }

  if (shape.type === "circle") {
    const center =
      ability.targetType === "self" ? { x: actor.x, y: actor.y, z: actor.z } : targetPosition;
    const targetIds = collectTargetsInCircle(candidates, center, shape.radius);
    if (ability.targetType === "self" && !targetIds.includes(actor.id)) {
      targetIds.push(actor.id);
      targetIds.sort();
    }
    return { possibleTargetIds: targetIds, targetPosition };
  }

  if (shape.type === "cone") {
    const origin =
      ability.targetType === "ground" ? targetPosition : { x: actor.x, y: actor.y, z: actor.z };
    const directionYaw = resolveDirectionYaw(ability, actor, target, targetPosition);
    if (directionYaw === null) {
      return null;
    }
    const targetIds = collectTargetsInCone(
      candidates,
      origin,
      directionYaw,
      shape.angleDeg,
      shape.length,
    );
    return { possibleTargetIds: targetIds, targetPosition };
  }

  if (shape.type === "line") {
    const origin =
      ability.targetType === "ground" ? targetPosition : { x: actor.x, y: actor.y, z: actor.z };
    const directionYaw = resolveDirectionYaw(ability, actor, target, targetPosition);
    if (directionYaw === null) {
      return null;
    }
    const targetIds = collectTargetsInRectangle(
      candidates,
      origin,
      directionYaw,
      shape.length,
      shape.width,
    );
    return { possibleTargetIds: targetIds, targetPosition };
  }

  return null;
}

function resolveDirectionYaw(
  ability: AbilityDefinition,
  actor: ResolveTargetsParams["actor"],
  target: TargetSpec,
  targetPosition?: Vector3,
): number | null {
  const directionMode = resolveDirectionMode(ability);
  switch (directionMode) {
    case "facing": {
      return actor.facingYaw;
    }
    case "target": {
      if (!targetPosition) {
        return null;
      }
      const dx = targetPosition.x - actor.x;
      const dz = targetPosition.z - actor.z;
      return yawFromVector(dx, dz, actor.facingYaw);
    }
    case "cursor": {
      if (target.direction) {
        return yawFromVector(target.direction.x, target.direction.z, actor.facingYaw);
      }
      if (target.targetPoint) {
        const dx = target.targetPoint.x - actor.x;
        const dz = target.targetPoint.z - actor.z;
        return yawFromVector(dx, dz, actor.facingYaw);
      }
      return null;
    }
    default: {
      return actor.facingYaw;
    }
  }
}

function resolveDirectionMode(ability: AbilityDefinition): DirectionMode {
  if (ability.directionMode) {
    return ability.directionMode;
  }
  if (ability.targetType === "enemy" || ability.targetType === "ally") {
    return "target";
  }
  return "facing";
}

function yawFromVector(dx: number, dz: number, fallbackYaw: number): number {
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= 0.000001) {
    return fallbackYaw;
  }
  return Math.atan2(dx, dz);
}

export function collectTargetsInCircle(
  candidates: TargetCandidate[],
  center: Vector3,
  radius: number,
): string[] {
  const radiusSq = radius * radius;
  const targets: string[] = [];

  for (const candidate of candidates) {
    const dx = candidate.x - center.x;
    const dz = candidate.z - center.z;
    const distSq = dx * dx + dz * dz;
    if (distSq <= radiusSq) {
      targets.push(candidate.id);
    }
  }

  targets.sort();
  return targets;
}

export function collectTargetsInCone(
  candidates: TargetCandidate[],
  origin: Vector3,
  facingYaw: number,
  angleDeg: number,
  length: number,
): string[] {
  const targets: string[] = [];
  const halfAngleRad = (angleDeg * Math.PI) / 360;
  const cosHalfAngle = Math.cos(halfAngleRad);
  const lengthSq = length * length;
  const forwardX = Math.sin(facingYaw);
  const forwardZ = Math.cos(facingYaw);

  for (const candidate of candidates) {
    const dx = candidate.x - origin.x;
    const dz = candidate.z - origin.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > lengthSq) {
      continue;
    }
    if (distSq === 0) {
      targets.push(candidate.id);
      continue;
    }
    const dist = Math.sqrt(distSq);
    const dot = (dx * forwardX + dz * forwardZ) / dist;
    if (dot >= cosHalfAngle) {
      targets.push(candidate.id);
    }
  }

  targets.sort();
  return targets;
}

export function collectTargetsInRectangle(
  candidates: TargetCandidate[],
  origin: Vector3,
  facingYaw: number,
  length: number,
  width: number,
): string[] {
  const targets: string[] = [];
  const halfWidth = width / 2;
  const forwardX = Math.sin(facingYaw);
  const forwardZ = Math.cos(facingYaw);
  const rightX = Math.cos(facingYaw);
  const rightZ = -Math.sin(facingYaw);

  for (const candidate of candidates) {
    const dx = candidate.x - origin.x;
    const dz = candidate.z - origin.z;
    const forwardDist = dx * forwardX + dz * forwardZ;
    if (forwardDist < 0 || forwardDist > length) {
      continue;
    }
    const rightDist = dx * rightX + dz * rightZ;
    if (Math.abs(rightDist) <= halfWidth) {
      targets.push(candidate.id);
    }
  }

  targets.sort();
  return targets;
}
