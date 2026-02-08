/**
 * Targeting types shared between client and server.
 */
export type TargetType = "enemy" | "ally" | "self" | "ground";
export type DirectionMode = "facing" | "cursor" | "target";

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface TargetSpec {
  /** Target entity for single-target abilities. */
  targetEntityId?: string;
  /** Target point for ground-targeted abilities. */
  targetPoint?: Vector3;
  /** Optional direction for source-emitted shapes (cones/lines). */
  direction?: Vector3;
}

export interface CircleShape {
  type: "circle";
  radius: number;
}

export interface ConeShape {
  type: "cone";
  angleDeg: number;
  length: number;
}

export interface LineShape {
  type: "line";
  length: number;
  width: number;
}

export type AbilityAoeShape = "single" | CircleShape | ConeShape | LineShape;
