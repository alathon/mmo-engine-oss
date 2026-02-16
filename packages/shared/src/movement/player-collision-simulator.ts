import "@babylonjs/core/Collisions/collisionCoordinator.js";
import { Ray } from "@babylonjs/core/Culling/ray.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Scene } from "@babylonjs/core/scene.js";

export const PLAYER_COLLISION_ELLIPSOID = new Vector3(0.35, 0.9, 0.35);
export const PLAYER_COLLISION_ELLIPSOID_OFFSET = new Vector3(0, 0.9, 0);
export const PLAYER_COLLISION_EPSILON = 0.0001;
const GROUND_RAYCAST_LENGTH = 1000;
const GROUND_RAY_ORIGIN_OFFSET = 0.2;
const GROUNDED_EPSILON = 0.08;
const PREDICTION_SUBSTEP_MAX_MS = 16;
const MAX_UPHILL_GROUNDED_SLOPE_DEGREES = 60;
const MAX_DOWNHILL_GROUNDED_SLOPE_DEGREES = 75;
const GROUNDED_UPHILL_MIN_NORMAL_Y = Math.cos((MAX_UPHILL_GROUNDED_SLOPE_DEGREES * Math.PI) / 180);
const GROUNDED_DOWNHILL_MIN_NORMAL_Y = Math.cos(
  (MAX_DOWNHILL_GROUNDED_SLOPE_DEGREES * Math.PI) / 180,
);
const GROUND_STICKING_FACTOR = 25;
const EARTH_GRAVITY_MPS2 = 9.81;
const PLAYER_WORLD_UNITS_PER_METER = 1;
const PLAYER_GRAVITY_SCALE = 1.8;
const PLAYER_MAX_FALL_SPEED_MPS = 1000;
const PLAYER_JUMP_VELOCITY_MPS = 11.5;
const RISING_GRAVITY_SCALE = 2.2;
const FALLING_GRAVITY_SCALE = 1.9;

export const DEFAULT_PLAYER_GRAVITY =
  EARTH_GRAVITY_MPS2 * PLAYER_WORLD_UNITS_PER_METER * PLAYER_GRAVITY_SCALE;
export const DEFAULT_PLAYER_MAX_FALL_SPEED =
  PLAYER_MAX_FALL_SPEED_MPS * PLAYER_WORLD_UNITS_PER_METER;
export const DEFAULT_PLAYER_JUMP_VELOCITY = PLAYER_JUMP_VELOCITY_MPS * PLAYER_WORLD_UNITS_PER_METER;

interface GroundHit {
  normalX: number;
  normalY: number;
  normalZ: number;
}

export interface SimulatePlayerCollisionStepParams {
  currentX: number;
  currentY: number;
  currentZ: number;
  directionX: number;
  directionZ: number;
  deltaTimeMs: number;
  speed: number;
  velocityY: number;
  grounded: boolean;
  jumpPressed: boolean;
  gravity?: number;
  maxFallSpeed?: number;
  jumpVelocity?: number;
  ignoredGroundMesh?: Mesh;
}

export interface SimulatePlayerCollisionStepResult {
  x: number;
  y: number;
  z: number;
  velocityY: number;
  grounded: boolean;
  movementRatio: number;
  collided: boolean;
  requestedHorizontalDistance: number;
  actualHorizontalDistance: number;
  sawGroundHit: boolean;
  sawVerticalCollision: boolean;
}

export class PlayerCollisionSimulator {
  private readonly scene: Scene;
  private readonly collisionProbe: Mesh;
  private readonly collisionDisplacement = new Vector3();
  private readonly downVector = Vector3.Down();
  private readonly groundRay = new Ray(Vector3.Zero(), Vector3.Down(), GROUND_RAYCAST_LENGTH);

  constructor(scene: Scene, probeName: string) {
    this.scene = scene;
    this.scene.collisionsEnabled = true;
    this.collisionProbe = this.createCollisionProbe(probeName);
  }

  dispose(): void {
    if (!this.collisionProbe.isDisposed()) {
      this.collisionProbe.dispose();
    }
  }

  simulateStep(params: SimulatePlayerCollisionStepParams): SimulatePlayerCollisionStepResult {
    const gravity = params.gravity ?? DEFAULT_PLAYER_GRAVITY;
    const maxFallSpeed = params.maxFallSpeed ?? DEFAULT_PLAYER_MAX_FALL_SPEED;
    const jumpVelocity = params.jumpVelocity ?? DEFAULT_PLAYER_JUMP_VELOCITY;

    let velocityY = params.velocityY;
    let grounded = params.grounded;

    if (params.jumpPressed && grounded) {
      velocityY = jumpVelocity;
      grounded = false;
    }

    const deltaSeconds = params.deltaTimeMs / 1000;
    const horizontalVelocityX = params.directionX * params.speed;
    const horizontalVelocityZ = params.directionZ * params.speed;
    const requestedHorizontalDistance = Math.hypot(
      horizontalVelocityX * deltaSeconds,
      horizontalVelocityZ * deltaSeconds,
    );

    this.collisionProbe.position.set(params.currentX, params.currentY, params.currentZ);
    this.collisionProbe.computeWorldMatrix(true);

    const substepCount = Math.max(1, Math.ceil(params.deltaTimeMs / PREDICTION_SUBSTEP_MAX_MS));
    const substepSeconds = deltaSeconds / substepCount;
    let actualHorizontalDistance = 0;
    let sawGroundHit = false;
    let sawVerticalCollision = false;

    for (let stepIndex = 0; stepIndex < substepCount; stepIndex += 1) {
      const horizontalDeltaX = horizontalVelocityX * substepSeconds;
      const horizontalDeltaZ = horizontalVelocityZ * substepSeconds;
      const hasHorizontalMotion =
        Math.hypot(horizontalDeltaX, horizontalDeltaZ) > PLAYER_COLLISION_EPSILON;

      if (hasHorizontalMotion) {
        const beforeHorizontalX = this.collisionProbe.position.x;
        const beforeHorizontalZ = this.collisionProbe.position.z;
        this.collisionDisplacement.set(horizontalDeltaX, 0, horizontalDeltaZ);
        this.collisionProbe.moveWithCollisions(this.collisionDisplacement);
        const actualHorizontalStepX = this.collisionProbe.position.x - beforeHorizontalX;
        const actualHorizontalStepZ = this.collisionProbe.position.z - beforeHorizontalZ;
        actualHorizontalDistance += Math.hypot(actualHorizontalStepX, actualHorizontalStepZ);
      }
      this.collisionProbe.computeWorldMatrix(true);

      const groundHit = this.findGroundBelow(
        this.collisionProbe.position,
        params.ignoredGroundMesh,
      );
      sawGroundHit = sawGroundHit || groundHit !== undefined;
      const overShallowGround = this.isShallowGroundForMotion(
        groundHit,
        horizontalDeltaX,
        horizontalDeltaZ,
      );

      const nextVelocityY = this.computeNextVelocityY(
        velocityY,
        substepSeconds,
        gravity,
        maxFallSpeed,
      );
      const verticalDeltaY = nextVelocityY * substepSeconds;
      const expectedYWithoutCollision = this.collisionProbe.position.y + verticalDeltaY;
      this.collisionDisplacement.set(0, verticalDeltaY, 0);
      this.collisionProbe.moveWithCollisions(this.collisionDisplacement);

      const collidedInVerticalMove =
        Math.abs(this.collisionProbe.position.y - expectedYWithoutCollision) >
        PLAYER_COLLISION_EPSILON;
      sawVerticalCollision = sawVerticalCollision || collidedInVerticalMove;
      if (!collidedInVerticalMove) {
        grounded = false;
        velocityY = nextVelocityY;
        continue;
      }

      if (nextVelocityY <= 0 && overShallowGround) {
        grounded = true;
        velocityY = -Math.min(maxFallSpeed, gravity * substepSeconds * GROUND_STICKING_FACTOR);
        continue;
      }

      grounded = false;
      velocityY = Math.min(nextVelocityY, 0);
    }

    const movementRatio =
      requestedHorizontalDistance > PLAYER_COLLISION_EPSILON
        ? Math.min(1, actualHorizontalDistance / requestedHorizontalDistance)
        : 1;
    const collided =
      requestedHorizontalDistance > PLAYER_COLLISION_EPSILON &&
      actualHorizontalDistance + PLAYER_COLLISION_EPSILON < requestedHorizontalDistance;

    return {
      x: this.collisionProbe.position.x,
      y: this.collisionProbe.position.y,
      z: this.collisionProbe.position.z,
      velocityY,
      grounded,
      movementRatio,
      collided,
      requestedHorizontalDistance,
      actualHorizontalDistance,
      sawGroundHit,
      sawVerticalCollision,
    };
  }

  private findGroundBelow(position: Vector3, ignoredGroundMesh?: Mesh): GroundHit | undefined {
    this.groundRay.origin.set(position.x, position.y + GROUND_RAY_ORIGIN_OFFSET, position.z);
    this.groundRay.direction.copyFrom(this.downVector);
    this.groundRay.length = GROUND_RAYCAST_LENGTH;

    const hit = this.scene.pickWithRay(
      this.groundRay,
      (mesh) =>
        mesh.checkCollisions &&
        mesh !== this.collisionProbe &&
        mesh !== ignoredGroundMesh &&
        mesh.isEnabled(),
      false,
    );
    if (!hit?.hit) {
      return undefined;
    }

    const groundNormal = hit.getNormal(true);
    return {
      normalX: groundNormal?.x ?? 0,
      normalY: groundNormal?.y ?? 1,
      normalZ: groundNormal?.z ?? 0,
    };
  }

  private isShallowGroundForMotion(
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

  private computeSlopeDeltaYFromNormal(
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

  private computeNextVelocityY(
    currentVelocityY: number,
    deltaSeconds: number,
    gravity: number,
    maxFallSpeed: number,
  ): number {
    const gravityScale = currentVelocityY > 0 ? RISING_GRAVITY_SCALE : FALLING_GRAVITY_SCALE;
    return Math.max(currentVelocityY - gravity * gravityScale * deltaSeconds, -maxFallSpeed);
  }

  private createCollisionProbe(probeName: string): Mesh {
    const probe = MeshBuilder.CreateBox(probeName, { size: 1 }, this.scene);
    probe.isVisible = false;
    probe.isPickable = false;
    probe.checkCollisions = true;
    probe.ellipsoid = PLAYER_COLLISION_ELLIPSOID.clone();
    probe.ellipsoidOffset = PLAYER_COLLISION_ELLIPSOID_OFFSET.clone();
    probe.computeWorldMatrix(true);
    return probe;
  }
}
