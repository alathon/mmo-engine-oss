import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import {
  CLIENT_IDLE_SNAP_MS,
  CLIENT_MOVE_BUFFER_SIZE,
  CLIENT_RECONCILE_DISTANCE_EPSILON,
  DEFAULT_PLAYER_GRAVITY,
  DEFAULT_PLAYER_JUMP_VELOCITY,
  DEFAULT_PLAYER_MAX_FALL_SPEED,
  PLAYER_SPEED,
  PLAYER_SPRINT_MULTIPLIER,
  PLAYER_COLLISION_EPSILON,
  PlayerCollisionSimulator as SharedPlayerCollisionSimulator,
  PlayerState,
  TICK_MS,
  toFiniteNumber,
} from "@mmo/shared";
import type { PlayerEntity } from "../entities/player-entity";
import type { InputManager } from "../input/input-manager";
import type { ZoneConnectionManager } from "../network/zone-connection-manager";
import { InputMoveBuffer } from "./input-buffer";
import type { NavmeshMoveDebug, PendingMove, PredictedMoveResult } from "./movement-types";

const CLIENT_RECONCILE_VERTICAL_EPSILON_GROUNDED = 0.12;
const CLIENT_RECONCILE_VERTICAL_EPSILON_AIRBORNE = 1.5;
const GROUNDED_EPSILON = 0.08;
const MAX_UPHILL_GROUNDED_SLOPE_DEGREES = 60;
const MAX_DOWNHILL_GROUNDED_SLOPE_DEGREES = 75;
const GROUNDED_UPHILL_MIN_NORMAL_Y = Math.cos((MAX_UPHILL_GROUNDED_SLOPE_DEGREES * Math.PI) / 180);
const GROUNDED_DOWNHILL_MIN_NORMAL_Y = Math.cos(
  (MAX_DOWNHILL_GROUNDED_SLOPE_DEGREES * Math.PI) / 180,
);
const RISING_GRAVITY_SCALE_FALLBACK = 2.2;
const FALLING_GRAVITY_SCALE_FALLBACK = 1.9;

const SNAP_TESTING_OFFSET = (() => {
  if (import.meta.env.MODE === "production") {
    return 0;
  }
  return toFiniteNumber(import.meta.env.VITE_SNAP_TESTING_VAL, 0);
})();

export interface ReconcileDebugData {
  pendingMoves: number;
  lastAckedSeq: number;
  lastReconcileDelta: number;
  lastReconcileSnapped: boolean;
  lastReconcileSeq: number;
}

interface GroundHit {
  y: number;
  normalX: number;
  normalY: number;
  normalZ: number;
}

/**
 * Handles local-player movement prediction, reconciliation, and networking.
 */
export class LocalPlayerMovementHandler {
  private currentTick = 0;
  private currentInputSeq = 1;
  private idleDriftMs = 0;
  private lastAckedSeq = 0;
  private wasIdle = true;
  private pendingMoves = new InputMoveBuffer<PendingMove>(CLIENT_MOVE_BUFFER_SIZE);
  private readonly replayDirection = new Vector3(0, 0, 0);
  private lastReconcileDelta = 0;
  private lastReconcileSnapped = false;
  private lastReconcileSeq = 0;
  private ignoreServerSnaps = false;
  private camera?: Camera;
  private readonly cameraForwardRay = new Ray(Vector3.Zero(), Vector3.Zero());
  private readonly cameraForward = new Vector3();
  private readonly cameraLeft = new Vector3();
  private readonly cameraUp = Vector3.Up();
  private readonly cameraDirection = new Vector3();
  private readonly idleDirection = Vector3.Zero();
  private collisionSimulator?: SharedPlayerCollisionSimulator;
  private velocityY = 0;
  private grounded = true;
  private gravity = DEFAULT_PLAYER_GRAVITY;
  private maxFallSpeed = DEFAULT_PLAYER_MAX_FALL_SPEED;

  constructor(
    private player: PlayerEntity,
    private input: InputManager,
    private zoneNetwork: ZoneConnectionManager,
    private onMovementStart?: () => void,
  ) {}

  setCamera(camera?: Camera): void {
    this.camera = camera;
  }

  setIgnoreServerSnaps(enabled: boolean): void {
    this.ignoreServerSnaps = enabled;
    if (enabled) {
      this.idleDriftMs = 0;
      this.lastReconcileSnapped = false;
    }
  }

  setGravity(gravity: number): void {
    if (!Number.isFinite(gravity) || gravity <= 0) {
      return;
    }
    this.gravity = gravity;
  }

  setMaxFallSpeed(maxFallSpeed: number): void {
    if (!Number.isFinite(maxFallSpeed) || maxFallSpeed <= 0) {
      return;
    }
    this.maxFallSpeed = maxFallSpeed;
  }

  dispose(): void {
    this.collisionSimulator?.dispose();
    this.collisionSimulator = undefined;
    this.velocityY = 0;
    this.grounded = true;
  }

  fixedTick(tickMs: number): void {
    this.currentTick++;

    const inputDir = this.input.getMovementDirection();
    const jumpKeyPressed = this.input.consumeKeyPress(" ");
    const jumpPressed = jumpKeyPressed && this.grounded;
    const isIdle = inputDir.lengthSquared() === 0;
    if (!isIdle && this.wasIdle) {
      this.onMovementStart?.();
    }
    this.wasIdle = isIdle;
    this.applyIdleSnap(isIdle, tickMs);

    const shouldSimulate =
      jumpPressed || this.hasActiveMovementState(isIdle, this.grounded, this.velocityY);
    if (!shouldSimulate) {
      this.snapCurrentTargetPositionWithoutInterpolation();
      return;
    }

    const currentPosition = this.player.getTargetPosition();
    const moveDir = isIdle ? this.idleDirection : this.resolveMovementDirection(inputDir);
    const predicted = this.predictMovementStep({
      currentPosition,
      direction: moveDir,
      deltaTimeMs: tickMs,
      speed: this.getMoveSpeed(false),
      velocityY: this.velocityY,
      grounded: this.grounded,
      jumpPressed,
    });
    this.velocityY = predicted.velocityY ?? 0;
    this.grounded = predicted.grounded ?? true;
    this.player.setNavmeshMoveDebug(predicted.debug);

    const predictedPos = predicted.position;
    const seq = this.currentInputSeq++;
    this.queueAndSendPredictedMove(moveDir, predictedPos, seq, jumpPressed);
    const shouldInterpolatePosition = this.hasActiveMovementState(
      isIdle,
      this.grounded,
      this.velocityY,
    );
    this.player.setTargetPosition(
      predictedPos.x,
      predictedPos.y,
      predictedPos.z,
      shouldInterpolatePosition,
    );
    if (!isIdle) {
      this.player.setMovementYaw(Math.atan2(moveDir.x, moveDir.z));
    }
  }

  protected resolveMovementDirection(inputDir: Vector3): Vector3 {
    const camera = this.camera;
    if (!camera) {
      return inputDir;
    }

    camera.getForwardRayToRef(this.cameraForwardRay, 1);
    this.cameraForward.copyFrom(this.cameraForwardRay.direction);
    this.cameraForward.y = 0;

    const forwardLenSq = this.cameraForward.lengthSquared();
    if (forwardLenSq < 0.0001) {
      return inputDir;
    }

    this.cameraForward.scaleInPlace(1 / Math.sqrt(forwardLenSq));
    Vector3.CrossToRef(this.cameraUp, this.cameraForward, this.cameraLeft);

    const leftLenSq = this.cameraLeft.lengthSquared();
    if (leftLenSq > 0.0001) {
      this.cameraLeft.scaleInPlace(1 / Math.sqrt(leftLenSq));
    }

    this.cameraDirection.set(
      this.cameraForward.x * inputDir.z + this.cameraLeft.x * inputDir.x,
      0,
      this.cameraForward.z * inputDir.z + this.cameraLeft.z * inputDir.x,
    );

    const directionLenSq = this.cameraDirection.lengthSquared();
    if (directionLenSq > 0.0001) {
      this.cameraDirection.scaleInPlace(1 / Math.sqrt(directionLenSq));
    }

    return this.cameraDirection;
  }

  applyServerSnap(x: number, y: number, z: number, seq: number): void {
    if (this.ignoreServerSnaps) {
      this.player.setServerPosition(x, y, z);
      this.lastAckedSeq = Math.max(this.lastAckedSeq, seq);
      return;
    }

    this.player.position.set(x, y, z);
    this.player.setTargetPosition(x, y, z, false);
    this.player.setServerPosition(x, y, z);
    this.clearPendingMoves();
    this.lastAckedSeq = Math.max(this.lastAckedSeq, seq);
    this.idleDriftMs = 0;
    this.velocityY = 0;
    this.grounded = true;

    const nextSeq = this.currentInputSeq++;
    this.sendMoveMessage({
      directionX: 0,
      directionZ: 0,
      jumpPressed: false,
      seq: nextSeq,
      predictedX: x,
      predictedY: y,
      predictedZ: z,
    });
  }

  reconcileFromServerState(
    player: PlayerState,
    overridePosition?: { x: number; y: number; z: number },
  ): void {
    const serverX = overridePosition?.x ?? player.x;
    const serverY = overridePosition?.y ?? player.y;
    const serverZ = overridePosition?.z ?? player.z;
    this.player.setServerPosition(serverX, serverY, serverZ);
    const ackSeq = player.lastProcessedSeq;
    if (ackSeq < this.lastAckedSeq) {
      return;
    }

    if (this.ignoreServerSnaps) {
      this.lastAckedSeq = ackSeq;
      this.velocityY = player.velocityY;
      this.grounded = player.grounded;
      this.dropPendingMovesUpTo(ackSeq);
      const reconcile = this.computeReconcileDelta(
        this.player.getTargetPosition(),
        new Vector3(serverX, serverY, serverZ),
        CLIENT_RECONCILE_DISTANCE_EPSILON,
        this.grounded,
      );
      this.lastReconcileDelta = reconcile.delta;
      this.lastReconcileSnapped = false;
      this.lastReconcileSeq = ackSeq;
      return;
    }

    this.lastAckedSeq = ackSeq;
    this.velocityY = player.velocityY;
    this.grounded = player.grounded;
    this.dropPendingMovesUpTo(ackSeq);

    const shouldReplay = this.pendingMoves.getCount() > 0;
    let replayPos = new Vector3(serverX, serverY, serverZ);

    if (shouldReplay) {
      const replayResult = this.replayPendingMoves(replayPos);
      replayPos = replayResult.position;
      this.velocityY = replayResult.velocityY;
      this.grounded = replayResult.grounded;
      this.player.setNavmeshMoveDebug(replayResult.lastDebug);
    }

    const reconcile = this.computeReconcileDelta(
      this.player.getTargetPosition(),
      replayPos,
      CLIENT_RECONCILE_DISTANCE_EPSILON,
      this.grounded,
    );

    this.lastReconcileDelta = reconcile.delta;
    this.lastReconcileSnapped = reconcile.shouldSnap;
    this.lastReconcileSeq = ackSeq;

    if (this.lastReconcileSnapped) {
      console.log(`Setting position to ${replayPos.x}, ${replayPos.y}, ${replayPos.z}`);
      this.player.position.copyFrom(replayPos);
      this.player.setTargetPosition(replayPos.x, replayPos.y, replayPos.z, false);
    }
  }

  applyIdleSnap(isIdle: boolean, tickMs: number): void {
    if (this.ignoreServerSnaps) {
      this.idleDriftMs = 0;
      return;
    }

    if (!isIdle || !this.grounded) {
      this.idleDriftMs = 0;
      return;
    }

    const serverPosition = this.player.getServerPositionSnapshot();
    const idleSnap = this.evaluateIdleSnap({
      idleDriftMs: this.idleDriftMs,
      tickMs,
      position: this.player.position,
      serverPosition,
      epsilon: CLIENT_RECONCILE_DISTANCE_EPSILON,
      idleSnapMs: CLIENT_IDLE_SNAP_MS,
    });

    this.idleDriftMs = idleSnap.idleDriftMs;
    if (!idleSnap.shouldSnap) {
      return;
    }

    this.player.position.copyFrom(serverPosition);
    this.player.setTargetPosition(serverPosition.x, serverPosition.y, serverPosition.z, false);
    this.velocityY = 0;
    this.grounded = true;
  }

  queuePendingMove(move: PendingMove): void {
    this.pendingMoves.enqueue(move);
  }

  getMoveSpeed(isSprinting: boolean): number {
    return isSprinting ? PLAYER_SPEED * PLAYER_SPRINT_MULTIPLIER : PLAYER_SPEED;
  }

  getReconcileDebug(): ReconcileDebugData {
    return {
      pendingMoves: this.pendingMoves.getCount(),
      lastAckedSeq: this.lastAckedSeq,
      lastReconcileDelta: this.lastReconcileDelta,
      lastReconcileSnapped: this.lastReconcileSnapped,
      lastReconcileSeq: this.lastReconcileSeq,
    };
  }

  private dropPendingMovesUpTo(ackSeq: number): void {
    this.pendingMoves.dropUpTo(ackSeq);
  }

  private hasActiveMovementState(isIdle: boolean, grounded: boolean, velocityY: number): boolean {
    return !isIdle || !grounded || Math.abs(velocityY) > 0;
  }

  private snapCurrentTargetPositionWithoutInterpolation(): void {
    const currentTargetPosition = this.player.getTargetPosition();
    this.player.setTargetPosition(
      currentTargetPosition.x,
      currentTargetPosition.y,
      currentTargetPosition.z,
      false,
    );
  }

  private queueAndSendPredictedMove(
    direction: Vector3,
    predictedPosition: Vector3,
    seq: number,
    jumpPressed: boolean,
  ): void {
    const predictedX = predictedPosition.x + SNAP_TESTING_OFFSET;
    const predictedZ = predictedPosition.z + SNAP_TESTING_OFFSET;

    this.queuePendingMove({
      seq,
      tick: this.currentTick,
      dirX: direction.x,
      dirZ: direction.z,
      jumpPressed,
      isSprinting: false,
      velocityY: this.velocityY,
      grounded: this.grounded,
      predictedX,
      predictedY: predictedPosition.y,
      predictedZ,
    });

    this.sendMoveMessage({
      directionX: direction.x,
      directionZ: direction.z,
      jumpPressed,
      seq,
      predictedX,
      predictedY: predictedPosition.y,
      predictedZ,
    });
  }

  private sendMoveMessage(params: {
    directionX: number;
    directionZ: number;
    jumpPressed: boolean;
    seq: number;
    predictedX: number;
    predictedY: number;
    predictedZ: number;
  }): void {
    const { directionX, directionZ, jumpPressed, seq, predictedX, predictedY, predictedZ } = params;
    this.zoneNetwork.sendMessage({
      type: "move",
      payload: {
        directionX,
        directionY: 0,
        directionZ,
        jumpPressed,
        seq,
        tick: this.currentTick,
        isSprinting: false,
        predictedX,
        predictedY,
        predictedZ,
      },
    });
  }

  private clearPendingMoves(): void {
    this.pendingMoves.clear();
  }

  protected replayPendingMoves(startPosition: Vector3): {
    position: Vector3;
    lastDebug?: NavmeshMoveDebug;
    velocityY: number;
    grounded: boolean;
  } {
    let position = startPosition.clone();
    let lastDebug: NavmeshMoveDebug | undefined;
    let velocityY = this.velocityY;
    let grounded = this.grounded;

    for (const [, move] of this.pendingMoves.entries()) {
      this.replayDirection.x = move.dirX;
      this.replayDirection.y = 0;
      this.replayDirection.z = move.dirZ;

      const result = this.predictMovementStep({
        currentPosition: position,
        direction: this.replayDirection,
        deltaTimeMs: TICK_MS,
        speed: this.getMoveSpeed(move.isSprinting),
        velocityY,
        grounded,
        jumpPressed: move.jumpPressed,
      });

      position = result.position;
      velocityY = result.velocityY ?? 0;
      grounded = result.grounded ?? true;
      lastDebug = result.debug;
    }

    return {
      position,
      lastDebug,
      velocityY,
      grounded,
    };
  }

  protected predictMovementStep(params: {
    currentPosition: Vector3;
    direction: Vector3;
    deltaTimeMs: number;
    speed: number;
    velocityY: number;
    grounded: boolean;
    jumpPressed: boolean;
  }): PredictedMoveResult {
    const { currentPosition, direction, deltaTimeMs, speed, velocityY, grounded, jumpPressed } =
      params;
    const collisionSimulator = this.getCollisionSimulator();
    if (!collisionSimulator) {
      const deltaSeconds = deltaTimeMs / 1000;
      const horizontalVelocityX = direction.x * speed;
      const horizontalVelocityZ = direction.z * speed;
      let fallbackVelocityY = velocityY;
      let fallbackGrounded = grounded;
      if (jumpPressed && fallbackGrounded) {
        fallbackVelocityY = DEFAULT_PLAYER_JUMP_VELOCITY;
        fallbackGrounded = false;
      }
      const gravityScale =
        fallbackVelocityY > 0 ? RISING_GRAVITY_SCALE_FALLBACK : FALLING_GRAVITY_SCALE_FALLBACK;
      const nextVelocityY = Math.max(
        fallbackVelocityY - this.gravity * gravityScale * deltaSeconds,
        -this.maxFallSpeed,
      );
      return {
        position: new Vector3(
          currentPosition.x + horizontalVelocityX * deltaSeconds,
          currentPosition.y + nextVelocityY * deltaSeconds,
          currentPosition.z + horizontalVelocityZ * deltaSeconds,
        ),
        velocityY: nextVelocityY,
        grounded: fallbackGrounded,
      };
    }

    const localCollisionMesh = this.player.getCollisionMesh();
    const hadLocalCollisionMesh = localCollisionMesh !== undefined;
    const previousCollisionState = localCollisionMesh?.checkCollisions ?? false;
    if (hadLocalCollisionMesh) {
      localCollisionMesh.checkCollisions = false;
    }

    try {
      const simulation = collisionSimulator.simulateStep({
        currentX: currentPosition.x,
        currentY: currentPosition.y,
        currentZ: currentPosition.z,
        directionX: direction.x,
        directionZ: direction.z,
        deltaTimeMs,
        speed,
        velocityY,
        grounded,
        jumpPressed,
        gravity: this.gravity,
        maxFallSpeed: this.maxFallSpeed,
        jumpVelocity: DEFAULT_PLAYER_JUMP_VELOCITY,
        ignoredGroundMesh: localCollisionMesh,
      });

      const debug =
        simulation.requestedHorizontalDistance > PLAYER_COLLISION_EPSILON
          ? {
              requested: simulation.requestedHorizontalDistance,
              actual: simulation.actualHorizontalDistance,
              ratio: simulation.movementRatio,
              collided: simulation.collided,
            }
          : undefined;

      return {
        position: new Vector3(simulation.x, simulation.y, simulation.z),
        debug,
        velocityY: simulation.velocityY,
        grounded: simulation.grounded,
      };
    } finally {
      if (hadLocalCollisionMesh) {
        localCollisionMesh.checkCollisions = previousCollisionState;
      }
    }
  }

  protected isShallowGroundForMotion(
    groundHit: GroundHit | undefined,
    horizontalDeltaX: number,
    horizontalDeltaZ: number,
  ): boolean {
    if (!groundHit) {
      return false;
    }

    const hasHorizontalMotion =
      Math.hypot(horizontalDeltaX, horizontalDeltaZ) > PLAYER_COLLISION_EPSILON;
    const isMovingUphill =
      hasHorizontalMotion && Math.abs(groundHit.normalY) > PLAYER_COLLISION_EPSILON
        ? this.computeSlopeDeltaYFromNormal(
            groundHit.normalX,
            groundHit.normalY,
            groundHit.normalZ,
            horizontalDeltaX,
            horizontalDeltaZ,
          ) > GROUNDED_EPSILON
        : false;
    const minNormalY = isMovingUphill
      ? GROUNDED_UPHILL_MIN_NORMAL_Y
      : GROUNDED_DOWNHILL_MIN_NORMAL_Y;
    return groundHit.normalY >= minNormalY;
  }

  protected computeSlopeDeltaYFromNormal(
    normalX: number,
    normalY: number,
    normalZ: number,
    horizontalDeltaX: number,
    horizontalDeltaZ: number,
  ): number {
    if (Math.abs(normalY) <= PLAYER_COLLISION_EPSILON) {
      return 0;
    }

    return -(normalX * horizontalDeltaX + normalZ * horizontalDeltaZ) / normalY;
  }

  private getCollisionSimulator(): SharedPlayerCollisionSimulator | undefined {
    if (this.collisionSimulator) {
      return this.collisionSimulator;
    }

    const scene = this.player.getScene();
    if (!scene || scene.isDisposed) {
      return undefined;
    }

    this.collisionSimulator = new SharedPlayerCollisionSimulator(
      scene,
      `${this.player.getId()}_prediction_collision_probe`,
    );
    return this.collisionSimulator;
  }

  private computeReconcileDelta(
    targetPosition: Vector3,
    replayPosition: Vector3,
    epsilon: number,
    grounded: boolean,
  ): { delta: number; shouldSnap: boolean } {
    const dx = replayPosition.x - targetPosition.x;
    const dy = replayPosition.y - targetPosition.y;
    const dz = replayPosition.z - targetPosition.z;
    const horizontalDistanceSq = dx * dx + dz * dz;
    const epsilonSq = epsilon * epsilon;
    const verticalEpsilon = grounded
      ? CLIENT_RECONCILE_VERTICAL_EPSILON_GROUNDED
      : CLIENT_RECONCILE_VERTICAL_EPSILON_AIRBORNE;
    const shouldSnap = horizontalDistanceSq > epsilonSq || Math.abs(dy) > verticalEpsilon;
    const distanceSq = dx * dx + dy * dy + dz * dz;

    return {
      delta: Math.sqrt(distanceSq),
      shouldSnap,
    };
  }

  private evaluateIdleSnap(params: {
    idleDriftMs: number;
    tickMs: number;
    position: Vector3;
    serverPosition: Vector3;
    epsilon: number;
    idleSnapMs: number;
  }): { idleDriftMs: number; shouldSnap: boolean } {
    const { idleDriftMs, tickMs, position, serverPosition, epsilon, idleSnapMs } = params;

    const dx = serverPosition.x - position.x;
    const dy = serverPosition.y - position.y;
    const dz = serverPosition.z - position.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    const epsilonSq = epsilon * epsilon;

    if (distanceSq <= epsilonSq) {
      return { idleDriftMs: 0, shouldSnap: false };
    }

    const nextIdleDriftMs = idleDriftMs + tickMs;
    if (nextIdleDriftMs < idleSnapMs) {
      return { idleDriftMs: nextIdleDriftMs, shouldSnap: false };
    }

    return { idleDriftMs: 0, shouldSnap: true };
  }
}
