import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import {
  applyNavmeshMovementStep,
  CLIENT_IDLE_SNAP_MS,
  CLIENT_MOVE_BUFFER_SIZE,
  CLIENT_RECONCILE_DISTANCE_EPSILON,
  NAVMESH_RECOVERY_DISTANCE,
  PLAYER_SPEED,
  PLAYER_SPRINT_MULTIPLIER,
  PlayerState,
  TICK_MS,
  toFiniteNumber,
} from "@mmo/shared";
import type { NavcatQuery } from "@mmo/shared";
import type { PlayerEntity } from "../entities/playerEntity";
import type { InputManager } from "../input/inputManager";
import type { ZoneConnectionManager } from "../network/zoneConnectionManager";
import { InputMoveBuffer } from "./inputBuffer";
import type {
  NavmeshMoveDebug,
  PendingMove,
  PredictedMoveResult,
} from "./movementTypes";

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

/**
 * Handles local-player movement prediction, reconciliation, and networking.
 */
export class LocalPlayerMovementHandler {
  private currentTick = 0;
  private currentInputSeq = 1;
  private idleDriftMs = 0;
  private lastAckedSeq = 0;
  private wasIdle = true;
  private pendingMoves = new InputMoveBuffer<PendingMove>(
    CLIENT_MOVE_BUFFER_SIZE,
  );
  private readonly replayDirection = new Vector3(0, 0, 0);
  private lastReconcileDelta = 0;
  private lastReconcileSnapped = false;
  private lastReconcileSeq = 0;
  private navmesh?: NavcatQuery;
  private camera?: Camera;
  private readonly cameraForwardRay = new Ray(Vector3.Zero(), Vector3.Zero());
  private readonly cameraForward = new Vector3();
  private readonly cameraLeft = new Vector3();
  private readonly cameraUp = Vector3.Up();
  private readonly cameraDirection = new Vector3();

  constructor(
    private player: PlayerEntity,
    private input: InputManager,
    private zoneNetwork: ZoneConnectionManager,
    navmesh?: NavcatQuery,
    private onMovementStart?: () => void,
  ) {
    this.navmesh = navmesh;
  }

  setNavmesh(navmesh?: NavcatQuery): void {
    this.navmesh = navmesh;
  }

  setCamera(camera?: Camera): void {
    this.camera = camera;
  }

  fixedTick(tickMs: number): void {
    this.currentTick++;

    const inputDir = this.input.getMovementDirection();
    const isIdle = inputDir.lengthSquared() === 0;
    if (!isIdle && this.wasIdle) {
      this.onMovementStart?.();
    }
    this.wasIdle = isIdle;
    this.applyIdleSnap(isIdle, tickMs);

    if (isIdle) {
      return;
    }

    const moveDir = this.resolveMovementDirection(inputDir);
    const navmeshNodeRef = this.player.getNavmeshNodeRef();
    const predicted = this.predictMovementStep({
      currentPosition: this.player.getTargetPosition(),
      direction: moveDir,
      deltaTimeMs: tickMs,
      speed: this.getMoveSpeed(false),
      navmesh: this.navmesh,
      navmeshNodeRef,
    });
    if (typeof predicted.navmeshNodeRef === "number") {
      this.player.setNavmeshNodeRef(predicted.navmeshNodeRef);
    }
    this.player.setNavmeshMoveDebug(predicted.debug);

    const predictedPos = predicted.position;
    const predictedX = predictedPos.x + SNAP_TESTING_OFFSET;
    const predictedZ = predictedPos.z + SNAP_TESTING_OFFSET;
    const seq = this.currentInputSeq++;

    this.queuePendingMove({
      seq,
      tick: this.currentTick,
      dirX: moveDir.x,
      dirZ: moveDir.z,
      isSprinting: false,
      navmeshNodeRef,
      predictedX,
      predictedY: predictedPos.y,
      predictedZ,
    });

    this.zoneNetwork.sendMessage({
      type: "move",
      payload: {
        directionX: moveDir.x,
        directionY: 0,
        directionZ: moveDir.z,
        seq,
        tick: this.currentTick,
        isSprinting: false,
        predictedX,
        predictedY: predictedPos.y,
        predictedZ,
      },
    });

    this.player.setTargetPosition(
      predictedPos.x,
      predictedPos.y,
      predictedPos.z,
    );
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
    this.player.position.set(x, y, z);
    this.player.setTargetPosition(x, y, z, false);
    this.player.setServerPosition(x, y, z);
    this.clearPendingMoves();
    this.lastAckedSeq = Math.max(this.lastAckedSeq, seq);
    this.player.resetNavmeshNodeRef();
    this.idleDriftMs = 0;

    const nextSeq = this.currentInputSeq++;
    this.zoneNetwork.sendMessage({
      type: "move",
      payload: {
        directionX: 0,
        directionY: 0,
        directionZ: 0,
        seq: nextSeq,
        tick: this.currentTick,
        isSprinting: false,
        predictedX: x,
        predictedY: y,
        predictedZ: z,
      },
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

    this.lastAckedSeq = ackSeq;
    this.dropPendingMovesUpTo(ackSeq);

    const shouldReplay = this.pendingMoves.getCount() > 0;
    const replayNodeRef = this.player.getNavmeshNodeRef();
    let replayPos = new Vector3(serverX, serverY, serverZ);
    let replayNavmeshNodeRef: number | undefined;

    if (shouldReplay) {
      const replayResult = this.replayPendingMoves(replayPos);
      replayPos = replayResult.position;
      replayNavmeshNodeRef = replayResult.navmeshNodeRef;
      this.player.setNavmeshMoveDebug(replayResult.lastDebug);
    }

    const reconcile = this.computeReconcileDelta(
      this.player.getTargetPosition(),
      replayPos,
      CLIENT_RECONCILE_DISTANCE_EPSILON,
    );

    this.lastReconcileDelta = reconcile.delta;
    this.lastReconcileSnapped = reconcile.shouldSnap;
    this.lastReconcileSeq = ackSeq;

    if (this.lastReconcileSnapped) {
      console.log(
        `Setting position to ${replayPos.x}, ${replayPos.y}, ${replayPos.z}`,
      );
      this.player.position.copyFrom(replayPos);
      this.player.setTargetPosition(
        replayPos.x,
        replayPos.y,
        replayPos.z,
        false,
      );
      if (!shouldReplay) {
        this.player.resetNavmeshNodeRef();
      } else {
        this.player.setNavmeshNodeRef(replayNavmeshNodeRef);
      }
    } else {
      if (shouldReplay) {
        this.player.setNavmeshNodeRef(replayNodeRef);
      }
    }
  }

  applyIdleSnap(isIdle: boolean, tickMs: number): void {
    if (!isIdle) {
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
    this.player.setTargetPosition(
      serverPosition.x,
      serverPosition.y,
      serverPosition.z,
      false,
    );
    this.player.resetNavmeshNodeRef();
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

  private clearPendingMoves(): void {
    this.pendingMoves.clear();
  }

  protected replayPendingMoves(startPosition: Vector3): {
    position: Vector3;
    navmeshNodeRef?: number;
    lastDebug?: NavmeshMoveDebug;
  } {
    let position = startPosition.clone();
    let navmeshNodeRef: number | undefined;
    let lastDebug: NavmeshMoveDebug | undefined;

    this.pendingMoves.forEach((move, index) => {
      if (index === 0) {
        navmeshNodeRef = move.navmeshNodeRef;
      }

      this.replayDirection.x = move.dirX;
      this.replayDirection.y = 0;
      this.replayDirection.z = move.dirZ;

      const result = this.predictMovementStep({
        currentPosition: position,
        direction: this.replayDirection,
        deltaTimeMs: TICK_MS,
        speed: this.getMoveSpeed(move.isSprinting),
        navmesh: this.navmesh,
        navmeshNodeRef,
      });

      position = result.position;
      if (typeof result.navmeshNodeRef === "number") {
        navmeshNodeRef = result.navmeshNodeRef;
      }
      lastDebug = result.debug;
    });

    return {
      position,
      navmeshNodeRef,
      lastDebug,
    };
  }

  protected predictMovementStep(params: {
    currentPosition: Vector3;
    direction: Vector3;
    deltaTimeMs: number;
    speed: number;
    navmesh?: NavcatQuery;
    navmeshNodeRef?: number;
    recoveryDistance?: number;
  }): PredictedMoveResult {
    const {
      currentPosition,
      direction,
      deltaTimeMs,
      speed,
      navmesh,
      navmeshNodeRef,
      recoveryDistance = NAVMESH_RECOVERY_DISTANCE,
    } = params;

    if (direction.length() === 0) {
      return { position: currentPosition.clone() };
    }

    if (navmesh) {
      const deltaSeconds = deltaTimeMs / 1000;
      const deltaX = direction.x * speed * deltaSeconds;
      const deltaZ = direction.z * speed * deltaSeconds;
      const result = applyNavmeshMovementStep({
        currentX: currentPosition.x,
        currentZ: currentPosition.z,
        directionX: direction.x,
        directionZ: direction.z,
        deltaTime: deltaSeconds,
        speed,
        navmesh,
        startNodeRef: navmeshNodeRef ?? undefined,
        recoveryDistance,
      });

      const movedX = result.x - currentPosition.x;
      const movedZ = result.z - currentPosition.z;
      const requested = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
      const actual = Math.sqrt(movedX * movedX + movedZ * movedZ);

      return {
        position: new Vector3(result.x, result.y, result.z),
        navmeshNodeRef: result.nodeRef,
        debug: {
          requested,
          actual,
          ratio: result.movementRatio,
          collided: result.collided,
          nodeRef: result.nodeRef,
        },
      };
    }

    return {
      position: new Vector3(
        currentPosition.x + direction.x * speed * (deltaTimeMs / 1000),
        currentPosition.y,
        currentPosition.z + direction.z * speed * (deltaTimeMs / 1000),
      ),
    };
  }

  private computeReconcileDelta(
    targetPosition: Vector3,
    replayPosition: Vector3,
    epsilon: number,
  ): { delta: number; shouldSnap: boolean } {
    const dx = replayPosition.x - targetPosition.x;
    const dy = replayPosition.y - targetPosition.y;
    const dz = replayPosition.z - targetPosition.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    const epsilonSq = epsilon * epsilon;

    return {
      delta: Math.sqrt(distanceSq),
      shouldSnap: distanceSq > epsilonSq,
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
    const {
      idleDriftMs,
      tickMs,
      position,
      serverPosition,
      epsilon,
      idleSnapMs,
    } = params;

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
