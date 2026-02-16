import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export interface MovementState {
  targetPosition: Vector3;
  previousTargetPosition: Vector3;
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
  velocityY?: number;
  grounded?: boolean;
}

export interface PendingMove {
  seq: number;
  tick: number;
  dirX: number;
  dirZ: number;
  jumpPressed: boolean;
  isSprinting: boolean;
  velocityY: number;
  grounded: boolean;
  navmeshNodeRef?: number;
  predictedX: number;
  predictedY: number;
  predictedZ: number;
}
