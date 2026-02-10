import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export interface MovementState {
  targetPosition: Vector3;
  serverPosition: Vector3;
  facingYaw: number;
  movementYaw: number;
  navmeshNodeRef?: number;
}

export interface NavmeshMoveDebug {
  requested: number;
  actual: number;
  ratio: number;
  collided: boolean;
  nodeRef?: number;
}

export interface RemotePoseSample {
  timeMs: number;
  x: number;
  y: number;
  z: number;
  facingYaw: number;
}

export interface PredictedMoveResult {
  position: Vector3;
  navmeshNodeRef?: number;
  debug?: NavmeshMoveDebug;
}

export interface PendingMove {
  seq: number;
  tick: number;
  dirX: number;
  dirZ: number;
  isSprinting: boolean;
  navmeshNodeRef?: number;
  predictedX: number;
  predictedY: number;
  predictedZ: number;
}
