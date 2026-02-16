import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { GroundMesh } from "@babylonjs/core/Meshes/groundMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { ABILITY_DEFINITIONS, type AbilityDefinition } from "@mmo/shared";
import type { InputHandler } from "../input/input-handler";
import type { InputManager, PointerClick } from "../input/input-manager";
import type { CombatController } from "./combat-controller";
import type { PlayerEntity } from "../entities/player-entity";
import type { MobEntity } from "../entities/mob-entity";
import type { UiLayer } from "../ui/ui-layer";

/**
 * Ground-targeting reticle projection tuning.
 *
 * - `PREVIEW_SAMPLE_STEP`: Base spacing (in world units) between reticle samples.
 *   Lower values create smoother reticles but increase raycasts.
 * - `PREVIEW_MIN_SAMPLE_STEP`: Hard floor for adaptive refinement.
 * - `PREVIEW_REFINE_MULTIPLIER`: Per-refine scale applied to sample step.
 * - `PREVIEW_MAX_REFINE_STEPS`: Maximum adaptive refinement passes per targeting session.
 * - `PREVIEW_REFINE_STEEP_EDGE_RATIO`: Edge steepness threshold (`dy / horizontalDistance`) that
 *   counts as difficult geometry.
 * - `PREVIEW_REFINE_EDGE_FRACTION`: Required fraction of difficult edges before refinement triggers.
 * - `PREVIEW_SURFACE_OFFSET`: Offset along surface normal to keep reticle above geometry.
 * - `PREVIEW_DEPTH_BIAS`: Material depth bias to reduce z-fighting.
 */
const PREVIEW_SURFACE_OFFSET = 0.08;
const PREVIEW_DEPTH_BIAS = -2;
const PREVIEW_SAMPLE_STEP = 0.8;
const PREVIEW_MIN_SAMPLE_STEP = 0.35;
const PREVIEW_REFINE_MULTIPLIER = 0.65;
const PREVIEW_MAX_REFINE_STEPS = 2;
const PREVIEW_REFINE_STEEP_EDGE_RATIO = 1.25;
const PREVIEW_REFINE_EDGE_FRACTION = 0.2;
const PREVIEW_RAYCAST_HALF_HEIGHT = 120;
const PREVIEW_RAYCAST_LENGTH = PREVIEW_RAYCAST_HALF_HEIGHT * 2;

interface PreviewGeometry {
  positions: Float32Array;
  localSamples: Float32Array;
  indices: Uint32Array;
  neighbors: number[][];
  edges: Uint32Array;
}

interface ProjectionResult {
  shouldIncreaseDensity: boolean;
  steepEdgeRatio: number;
  rawMisses: number;
  unresolvedMisses: number;
  totalVertices: number;
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export interface GroundTargetingWorld {
  getScene(): Scene | undefined;
  getGroundMesh(): GroundMesh | undefined;
  getGroundTargetMeshIds(): ReadonlySet<number>;
  getLocalPlayer(): PlayerEntity | undefined;
  getUiLayer(): UiLayer | undefined;
  getCurrentTargetId(): string | undefined;
  getMobById(id: string): MobEntity | undefined;
}

export class GroundTargetingController implements InputHandler {
  priority = 80;
  private activeAbilityId?: string;
  private combatController?: CombatController;
  private targetPoint?: { x: number; y: number; z: number };
  private targetNormal = { x: 0, y: 1, z: 0 };
  private previewMesh?: Mesh;
  private previewLocalSamples = new Float32Array();
  private previewProjectedPositions = new Float32Array();
  private previewNeighbors: number[][] = [];
  private previewEdges = new Uint32Array();
  private previewAbilityId?: string;
  private previewSampleStep = PREVIEW_SAMPLE_STEP;
  private previewRefineSteps = 0;
  private previewMaterial?: StandardMaterial;
  private previewInRange?: boolean;
  private rangeHint?: TextBlock;
  private aimModeHint?: TextBlock;
  private projectionDebugHint?: TextBlock;
  private projectionWorldX = new Float32Array();
  private projectionWorldZ = new Float32Array();
  private projectionNormals = new Float32Array();
  private projectionHitMask = new Uint8Array();
  private readonly downRay = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), PREVIEW_RAYCAST_LENGTH);
  private readonly upRay = new Ray(Vector3.Zero(), new Vector3(0, 1, 0), PREVIEW_RAYCAST_LENGTH);

  constructor(private readonly world: GroundTargetingWorld) {}

  setCombatController(controller?: CombatController): void {
    this.combatController = controller;
    if (!controller) {
      this.cancelTargeting();
    }
  }

  enabled(): boolean {
    return (
      !!this.world.getScene() &&
      (!!this.world.getGroundMesh() || this.world.getGroundTargetMeshIds().size > 0)
    );
  }

  isActive(): boolean {
    return !!this.activeAbilityId;
  }

  getActiveAbilityId(): string | undefined {
    return this.activeAbilityId;
  }

  beginTargeting(abilityId: string): void {
    const ability = ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS] as
      | AbilityDefinition
      | undefined;
    if (!ability || (ability.targetType !== "ground" && ability.directionMode !== "cursor")) {
      return;
    }

    this.activeAbilityId = abilityId;
    this.previewInRange = undefined;
    this.previewSampleStep = PREVIEW_SAMPLE_STEP;
    this.previewRefineSteps = 0;
    this.ensurePreviewMesh(ability, true);
    this.updateTargetPointFromPointer();
  }

  cancelTargeting(): void {
    this.activeAbilityId = undefined;
    this.targetPoint = undefined;
    this.targetNormal = { x: 0, y: 1, z: 0 };
    this.previewInRange = undefined;
    this.setPreviewVisible(false);
    this.setRangeHintVisible(false);
    this.setAimModeHintVisible(false);
    this.setProjectionDebugHintVisible(false);
  }

  confirmTargeting(): boolean {
    if (!this.activeAbilityId || !this.targetPoint) {
      return false;
    }
    if (!this.combatController) {
      return false;
    }

    const ability = ABILITY_DEFINITIONS[
      this.activeAbilityId as keyof typeof ABILITY_DEFINITIONS
    ] as AbilityDefinition | undefined;
    if (!ability) {
      return false;
    }
    if (!this.isAbilityInRange(ability, this.targetPoint)) {
      return false;
    }

    const targetEntityId = this.resolveTargetEntityId(ability);
    if ((ability.targetType === "enemy" || ability.targetType === "ally") && !targetEntityId) {
      return false;
    }

    this.combatController.tryUseAbility(this.activeAbilityId, {
      targetPoint: this.targetPoint,
      targetEntityId,
    });
    this.cancelTargeting();
    return true;
  }

  handleTick(input: InputManager): void {
    if (!this.isActive()) {
      return;
    }
    if (input.isChatInputFocused()) {
      return;
    }
    if (input.consumeKeyPress("escape")) {
      this.cancelTargeting();
      return;
    }
  }

  handleFrame(input: InputManager): void {
    if (!this.isActive()) {
      return;
    }
    if (input.isChatInputFocused()) {
      return;
    }
    this.updateTargetPointFromPointer();
  }

  handlePointerClick(click: PointerClick): boolean {
    if (!this.isActive()) {
      return false;
    }
    if (click.button !== 0) {
      return false;
    }

    this.updateTargetPointFromScreen(click.x, click.y);
    this.confirmTargeting();
    return true;
  }

  private updateTargetPointFromPointer(): void {
    const scene = this.world.getScene();
    if (!scene) {
      return;
    }

    this.updateTargetPointFromScreen(scene.pointerX, scene.pointerY);
  }

  private updateTargetPointFromScreen(x: number, y: number): void {
    const scene = this.world.getScene();
    if (!scene) {
      return;
    }

    const ground = this.world.getGroundMesh();
    const groundTargetMeshIds = this.world.getGroundTargetMeshIds();
    const pick = scene.pick(
      x,
      y,
      ground
        ? (mesh) => mesh === ground
        : (mesh) => mesh instanceof Mesh && groundTargetMeshIds.has(mesh.uniqueId),
    );

    if (!pick?.hit || !pick.pickedPoint) {
      this.targetPoint = undefined;
      this.targetNormal = { x: 0, y: 1, z: 0 };
      this.setPreviewVisible(false);
      return;
    }

    const normal = pick.getNormal(true, true);
    this.targetPoint = {
      x: pick.pickedPoint.x,
      y: pick.pickedPoint.y,
      z: pick.pickedPoint.z,
    };
    this.targetNormal =
      normal && Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z)
        ? { x: normal.x, y: normal.y, z: normal.z }
        : { x: 0, y: 1, z: 0 };
    this.updatePreviewTransform();
  }

  private ensurePreviewMesh(ability: AbilityDefinition, forceRebuild = false): void {
    if (!forceRebuild && this.previewAbilityId === ability.id && this.previewMesh) {
      return;
    }

    this.disposePreviewMesh();

    const scene = this.world.getScene();
    if (!scene) {
      return;
    }

    const shape = ability.aoeShape;
    const geometry = this.buildPreviewGeometry(shape, this.previewSampleStep);
    const mesh = new Mesh("aoe_preview_mesh", scene);
    mesh.setVerticesData(VertexBuffer.PositionKind, geometry.positions, true);
    mesh.setIndices(geometry.indices);

    this.previewLocalSamples = new Float32Array(geometry.localSamples.length);
    this.previewLocalSamples.set(geometry.localSamples);
    this.previewProjectedPositions = new Float32Array(geometry.positions.length);
    this.previewProjectedPositions.set(geometry.positions);
    this.previewNeighbors = geometry.neighbors;
    this.previewEdges = new Uint32Array(geometry.edges.length);
    this.previewEdges.set(geometry.edges);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.material = this.ensurePreviewMaterial(scene);
    mesh.setEnabled(false);
    this.previewMesh = mesh;
    this.previewAbilityId = ability.id;
  }

  private ensurePreviewMaterial(scene: Scene): StandardMaterial {
    if (this.previewMaterial) {
      return this.previewMaterial;
    }

    const material = new StandardMaterial("aoe_preview_mat", scene);
    material.diffuseColor = new Color3(0.9, 0.1, 0.1);
    material.emissiveColor = new Color3(0.4, 0.05, 0.05);
    material.alpha = 0.6;
    material.backFaceCulling = false;
    material.zOffset = PREVIEW_DEPTH_BIAS;
    material.disableLighting = true;
    this.previewMaterial = material;
    this.previewInRange = true;
    return material;
  }

  private updatePreviewTransform(): void {
    const mesh = this.previewMesh;
    const targetPoint = this.targetPoint;
    const abilityId = this.activeAbilityId;
    if (!mesh || !targetPoint || !abilityId) {
      this.setPreviewVisible(false);
      return;
    }

    const ability = ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS];
    const resolvedAbility = ability as AbilityDefinition | undefined;
    if (!resolvedAbility) {
      this.setPreviewVisible(false);
      return;
    }

    const localPlayer = this.world.getLocalPlayer();
    if (!localPlayer) {
      this.setPreviewVisible(false);
      return;
    }

    const sourcePosition = localPlayer.getPosition();
    const facingYaw = localPlayer.getFacingYaw();
    const directionMode = this.resolveDirectionMode(resolvedAbility);
    const directionYaw = this.resolveDirectionYaw(resolvedAbility, targetPoint, facingYaw);
    const shape = resolvedAbility.aoeShape;
    const origin = resolvedAbility.targetType === "ground" ? targetPoint : sourcePosition;
    let projection = this.projectPreviewMesh(origin, directionYaw);
    if (projection.shouldIncreaseDensity) {
      this.previewSampleStep = Math.max(
        PREVIEW_MIN_SAMPLE_STEP,
        this.previewSampleStep * PREVIEW_REFINE_MULTIPLIER,
      );
      this.previewRefineSteps += 1;
      this.ensurePreviewMesh(resolvedAbility, true);
      projection = this.projectPreviewMesh(origin, directionYaw);
    }
    this.updateProjectionDebugHint(projection);

    this.updatePreviewRangeIndicator(this.isAbilityInRange(resolvedAbility, targetPoint));
    if (shape !== "single" && shape.type !== "circle") {
      this.setAimModeHint(directionMode);
    } else {
      this.setAimModeHintVisible(false);
    }

    mesh.setEnabled(true);
  }

  private updatePreviewRangeIndicator(inRange: boolean): void {
    const changed = this.previewInRange !== inRange;
    if (changed && this.previewMaterial) {
      if (inRange) {
        this.previewMaterial.diffuseColor = new Color3(0.9, 0.1, 0.1);
        this.previewMaterial.emissiveColor = new Color3(0.4, 0.05, 0.05);
      } else {
        this.previewMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
        this.previewMaterial.emissiveColor = new Color3(0.05, 0.05, 0.05);
      }
    }

    this.previewInRange = inRange;
    this.setRangeHintVisible(!inRange);
  }

  private isAbilityInRange(
    ability: AbilityDefinition,
    targetPoint: { x: number; y: number; z: number },
  ): boolean {
    if (ability.targetType === "self") {
      return true;
    }
    if (ability.targetType === "enemy" || ability.targetType === "ally") {
      const target = this.getCurrentTargetEntity();
      if (!target) {
        return false;
      }
      return this.isPointInRange(ability, target.getPosition());
    }

    if (ability.targetType === "ground") {
      return this.isPointInRange(ability, targetPoint);
    }

    if (ability.directionMode === "cursor") {
      return this.isPointInRange(ability, targetPoint);
    }

    return true;
  }

  private isPointInRange(
    ability: AbilityDefinition,
    point: { x: number; y: number; z: number },
  ): boolean {
    const localPlayer = this.world.getLocalPlayer();
    if (!localPlayer) {
      return false;
    }

    const sourcePosition = localPlayer.getPosition();
    const dx = point.x - sourcePosition.x;
    const dz = point.z - sourcePosition.z;
    const distSq = dx * dx + dz * dz;
    const rangeSq = ability.range * ability.range;
    return distSq <= rangeSq;
  }

  private resolveDirectionYaw(
    ability: AbilityDefinition,
    targetPoint: { x: number; y: number; z: number },
    fallbackYaw: number,
  ): number {
    const directionMode = this.resolveDirectionMode(ability);
    if (directionMode === "facing") {
      return fallbackYaw;
    }

    if (directionMode === "target") {
      const target = this.getCurrentTargetEntity();
      if (!target) {
        return fallbackYaw;
      }
      const localPlayer = this.world.getLocalPlayer();
      if (!localPlayer) {
        return fallbackYaw;
      }
      const sourcePosition = localPlayer.getPosition();
      const targetPosition = target.getPosition();
      const dx = targetPosition.x - sourcePosition.x;
      const dz = targetPosition.z - sourcePosition.z;
      return this.yawFromVector(dx, dz, fallbackYaw);
    }

    const localPlayer = this.world.getLocalPlayer();
    if (!localPlayer) {
      return fallbackYaw;
    }
    const sourcePosition = localPlayer.getPosition();
    const dx = targetPoint.x - sourcePosition.x;
    const dz = targetPoint.z - sourcePosition.z;
    return this.yawFromVector(dx, dz, fallbackYaw);
  }

  private resolveDirectionMode(ability: AbilityDefinition): "facing" | "cursor" | "target" {
    if (ability.directionMode) {
      return ability.directionMode;
    }
    if (ability.targetType === "enemy" || ability.targetType === "ally") {
      return "target";
    }
    return "facing";
  }

  private yawFromVector(dx: number, dz: number, fallbackYaw: number): number {
    const lenSq = dx * dx + dz * dz;
    if (lenSq <= 0.000_001) {
      return fallbackYaw;
    }
    return Math.atan2(dx, dz);
  }

  private resolveTargetEntityId(ability: AbilityDefinition): string | undefined {
    if (ability.targetType !== "enemy" && ability.targetType !== "ally") {
      return undefined;
    }
    return this.world.getCurrentTargetId() ?? undefined;
  }

  private getCurrentTargetEntity(): MobEntity | undefined {
    const targetId = this.world.getCurrentTargetId();
    if (!targetId) {
      return undefined;
    }
    return this.world.getMobById(targetId);
  }

  private ensureRangeHint(): TextBlock | undefined {
    if (this.rangeHint) {
      return this.rangeHint;
    }

    const uiLayer = this.world.getUiLayer();
    if (!uiLayer) {
      return undefined;
    }

    const hint = new TextBlock("groundTargetingOutOfRange");
    hint.text = "Out of range";
    hint.color = "#6e6e6e";
    hint.alpha = 0.85;
    hint.fontSize = 14;
    hint.fontFamily = "Segoe UI, system-ui, sans-serif";
    hint.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    hint.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    hint.paddingBottom = "140px";
    hint.shadowColor = "#000000";
    hint.shadowBlur = 2;
    hint.shadowOffsetX = 1;
    hint.shadowOffsetY = 1;
    hint.isVisible = false;

    uiLayer.addControl(hint);
    this.rangeHint = hint;
    return hint;
  }

  private setRangeHintVisible(visible: boolean): void {
    const hint = this.ensureRangeHint();
    if (!hint) {
      return;
    }
    hint.isVisible = visible;
  }

  private ensureAimModeHint(): TextBlock | undefined {
    if (this.aimModeHint) {
      return this.aimModeHint;
    }

    const uiLayer = this.world.getUiLayer();
    if (!uiLayer) {
      return undefined;
    }

    const hint = new TextBlock("groundTargetingAimMode");
    hint.text = "Aim: Facing";
    hint.color = "#b5b5b5";
    hint.alpha = 0.85;
    hint.fontSize = 12;
    hint.fontFamily = "Segoe UI, system-ui, sans-serif";
    hint.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    hint.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    hint.paddingBottom = "165px";
    hint.shadowColor = "#000000";
    hint.shadowBlur = 2;
    hint.shadowOffsetX = 1;
    hint.shadowOffsetY = 1;
    hint.isVisible = false;

    uiLayer.addControl(hint);
    this.aimModeHint = hint;
    return hint;
  }

  private setAimModeHint(mode: "facing" | "cursor" | "target"): void {
    const hint = this.ensureAimModeHint();
    if (!hint) {
      return;
    }

    const label = mode === "cursor" ? "Cursor" : mode === "target" ? "Target" : "Facing";
    hint.text = `Aim: ${label}`;
    hint.isVisible = true;
  }

  private setAimModeHintVisible(visible: boolean): void {
    const hint = this.ensureAimModeHint();
    if (!hint) {
      return;
    }
    hint.isVisible = visible;
  }

  private ensureProjectionDebugHint(): TextBlock | undefined {
    if (this.projectionDebugHint) {
      return this.projectionDebugHint;
    }

    const uiLayer = this.world.getUiLayer();
    if (!uiLayer) {
      return undefined;
    }

    const hint = new TextBlock("groundTargetingProjectionDebug");
    hint.text = "";
    hint.color = "#9ec7ff";
    hint.alpha = 0.9;
    hint.fontSize = 11;
    hint.fontFamily = "Menlo, Consolas, monospace";
    hint.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    hint.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    hint.paddingBottom = "188px";
    hint.shadowColor = "#000000";
    hint.shadowBlur = 2;
    hint.shadowOffsetX = 1;
    hint.shadowOffsetY = 1;
    hint.isVisible = false;

    uiLayer.addControl(hint);
    this.projectionDebugHint = hint;
    return hint;
  }

  private updateProjectionDebugHint(projection: ProjectionResult): void {
    const hint = this.ensureProjectionDebugHint();
    if (!hint) {
      return;
    }

    const unresolvedFraction =
      projection.totalVertices > 0
        ? (projection.unresolvedMisses / projection.totalVertices) * 100
        : 0;
    const rawFraction =
      projection.totalVertices > 0 ? (projection.rawMisses / projection.totalVertices) * 100 : 0;
    hint.text =
      `Reticle step=${this.previewSampleStep.toFixed(2)} refine=${this.previewRefineSteps} ` +
      `miss=${projection.rawMisses}/${projection.totalVertices} (${rawFraction.toFixed(1)}%) ` +
      `unresolved=${projection.unresolvedMisses} (${unresolvedFraction.toFixed(1)}%) ` +
      `steep=${(projection.steepEdgeRatio * 100).toFixed(1)}%`;
    hint.isVisible = true;
  }

  private setProjectionDebugHintVisible(visible: boolean): void {
    const hint = this.ensureProjectionDebugHint();
    if (!hint) {
      return;
    }
    hint.isVisible = visible;
  }

  private setPreviewVisible(visible: boolean): void {
    if (!this.previewMesh) {
      return;
    }
    this.previewMesh.setEnabled(visible);
    if (!visible) {
      this.setRangeHintVisible(false);
      this.setAimModeHintVisible(false);
      this.setProjectionDebugHintVisible(false);
    }
  }

  private disposePreviewMesh(): void {
    if (this.previewMesh) {
      this.previewMesh.dispose();
      this.previewMesh = undefined;
    }
    this.previewLocalSamples = new Float32Array();
    this.previewProjectedPositions = new Float32Array();
    this.previewNeighbors = [];
    this.previewEdges = new Uint32Array();
    this.projectionWorldX = new Float32Array();
    this.projectionWorldZ = new Float32Array();
    this.projectionNormals = new Float32Array();
    this.projectionHitMask = new Uint8Array();
    this.previewAbilityId = undefined;
    this.previewSampleStep = PREVIEW_SAMPLE_STEP;
    this.previewRefineSteps = 0;
  }

  private projectPreviewMesh(
    origin: { x: number; y: number; z: number },
    directionYaw: number,
  ): ProjectionResult {
    const mesh = this.previewMesh;
    const scene = this.world.getScene();
    if (!mesh || !scene) {
      return {
        shouldIncreaseDensity: false,
        steepEdgeRatio: 0,
        rawMisses: 0,
        unresolvedMisses: 0,
        totalVertices: 0,
      };
    }

    const localSamples = this.previewLocalSamples;
    const projectedPositions = this.previewProjectedPositions;
    if (localSamples.length === 0 || projectedPositions.length === 0) {
      return {
        shouldIncreaseDensity: false,
        steepEdgeRatio: 0,
        rawMisses: 0,
        unresolvedMisses: 0,
        totalVertices: 0,
      };
    }

    const ground = this.world.getGroundMesh();
    const groundTargetMeshIds = this.world.getGroundTargetMeshIds();
    const canPickMesh = ground
      ? (meshToPick: Mesh) => meshToPick === ground
      : (meshToPick: Mesh) => groundTargetMeshIds.has(meshToPick.uniqueId);
    const sinYaw = Math.sin(directionYaw);
    const cosYaw = Math.cos(directionYaw);
    const vertexCount = localSamples.length / 2;
    this.ensureProjectionBuffers(vertexCount);
    const worldXByVertex = this.projectionWorldX;
    const worldZByVertex = this.projectionWorldZ;
    const normalByVertex = this.projectionNormals;
    const hitMask = this.projectionHitMask;

    let vertexIndex = 0;
    for (let sampleIndex = 0; sampleIndex < localSamples.length; sampleIndex += 2) {
      const localX = localSamples[sampleIndex];
      const localZ = localSamples[sampleIndex + 1];
      const worldX = origin.x + cosYaw * localX + sinYaw * localZ;
      const worldZ = origin.z - sinYaw * localX + cosYaw * localZ;
      worldXByVertex[vertexIndex] = worldX;
      worldZByVertex[vertexIndex] = worldZ;
      const surface = this.pickSurface(scene, worldX, origin.y, worldZ, canPickMesh);
      const normal = surface?.normal ?? this.targetNormal;
      const surfaceY = surface?.y ?? origin.y;
      hitMask[vertexIndex] = surface ? 1 : 0;

      this.writeProjectedVertex(
        vertexIndex,
        worldX,
        surfaceY,
        worldZ,
        normal.x,
        normal.y,
        normal.z,
        projectedPositions,
        normalByVertex,
      );
      vertexIndex += 1;
    }
    const rawMisses = hitMask.reduce((count, hit) => count + (hit === 0 ? 1 : 0), 0);

    this.repairMissedVerticesFromNeighbors(
      scene,
      canPickMesh,
      worldXByVertex,
      worldZByVertex,
      projectedPositions,
      normalByVertex,
      hitMask,
    );
    this.repairMissedVerticesFromEdgeMidpoints(
      scene,
      canPickMesh,
      worldXByVertex,
      worldZByVertex,
      projectedPositions,
      normalByVertex,
      hitMask,
    );

    mesh.updateVerticesData(VertexBuffer.PositionKind, projectedPositions, false, false);
    mesh.refreshBoundingInfo(true);
    const unresolvedMisses = hitMask.reduce((count, hit) => count + (hit === 0 ? 1 : 0), 0);
    const densityDecision = this.shouldIncreasePreviewDensity(
      worldXByVertex,
      worldZByVertex,
      projectedPositions,
      hitMask,
    );
    return {
      shouldIncreaseDensity: densityDecision.shouldIncreaseDensity,
      steepEdgeRatio: densityDecision.steepEdgeRatio,
      rawMisses,
      unresolvedMisses,
      totalVertices: vertexCount,
    };
  }

  private ensureProjectionBuffers(vertexCount: number): void {
    if (this.projectionWorldX.length === vertexCount) {
      return;
    }

    this.projectionWorldX = new Float32Array(vertexCount);
    this.projectionWorldZ = new Float32Array(vertexCount);
    this.projectionNormals = new Float32Array(vertexCount * 3);
    this.projectionHitMask = new Uint8Array(vertexCount);
  }

  private writeProjectedVertex(
    vertexIndex: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    normalX: number,
    normalY: number,
    normalZ: number,
    projectedPositions: Float32Array,
    normalByVertex: Float32Array,
  ): void {
    const normalOffset = vertexIndex * 3;
    const normalLength = Math.hypot(normalX, normalY, normalZ);
    const nx = normalLength > 0.0001 ? normalX / normalLength : 0;
    const ny = normalLength > 0.0001 ? normalY / normalLength : 1;
    const nz = normalLength > 0.0001 ? normalZ / normalLength : 0;

    normalByVertex[normalOffset] = nx;
    normalByVertex[normalOffset + 1] = ny;
    normalByVertex[normalOffset + 2] = nz;

    projectedPositions[normalOffset] = worldX + nx * PREVIEW_SURFACE_OFFSET;
    projectedPositions[normalOffset + 1] = worldY + ny * PREVIEW_SURFACE_OFFSET;
    projectedPositions[normalOffset + 2] = worldZ + nz * PREVIEW_SURFACE_OFFSET;
  }

  private repairMissedVerticesFromNeighbors(
    scene: Scene,
    canPickMesh: (mesh: Mesh) => boolean,
    worldXByVertex: Float32Array,
    worldZByVertex: Float32Array,
    projectedPositions: Float32Array,
    normalByVertex: Float32Array,
    hitMask: Uint8Array,
  ): void {
    for (let vertexIndex = 0; vertexIndex < hitMask.length; vertexIndex += 1) {
      if (hitMask[vertexIndex] !== 0) {
        continue;
      }

      const neighbors = this.previewNeighbors[vertexIndex];
      if (!neighbors || neighbors.length === 0) {
        continue;
      }

      let hitNeighborCount = 0;
      let sumY = 0;
      let sumNx = 0;
      let sumNy = 0;
      let sumNz = 0;
      for (const neighborIndex of neighbors) {
        if (hitMask[neighborIndex] === 0) {
          continue;
        }
        const neighborOffset = neighborIndex * 3;
        hitNeighborCount += 1;
        sumY += projectedPositions[neighborOffset + 1];
        sumNx += normalByVertex[neighborOffset];
        sumNy += normalByVertex[neighborOffset + 1];
        sumNz += normalByVertex[neighborOffset + 2];
      }

      if (hitNeighborCount < 2) {
        continue;
      }

      const fallbackY = sumY / hitNeighborCount;
      const retry = this.pickSurface(
        scene,
        worldXByVertex[vertexIndex],
        fallbackY,
        worldZByVertex[vertexIndex],
        canPickMesh,
      );
      const normalLength = Math.hypot(sumNx, sumNy, sumNz);
      const nx = normalLength > 0.0001 ? sumNx / normalLength : 0;
      const ny = normalLength > 0.0001 ? sumNy / normalLength : 1;
      const nz = normalLength > 0.0001 ? sumNz / normalLength : 0;

      this.writeProjectedVertex(
        vertexIndex,
        worldXByVertex[vertexIndex],
        retry?.y ?? fallbackY,
        worldZByVertex[vertexIndex],
        retry?.normal.x ?? nx,
        retry?.normal.y ?? ny,
        retry?.normal.z ?? nz,
        projectedPositions,
        normalByVertex,
      );
      hitMask[vertexIndex] = retry ? 1 : 2;
    }
  }

  private repairMissedVerticesFromEdgeMidpoints(
    scene: Scene,
    canPickMesh: (mesh: Mesh) => boolean,
    worldXByVertex: Float32Array,
    worldZByVertex: Float32Array,
    projectedPositions: Float32Array,
    normalByVertex: Float32Array,
    hitMask: Uint8Array,
  ): void {
    const edges = this.previewEdges;
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 2) {
      const a = edges[edgeIndex];
      const b = edges[edgeIndex + 1];
      if (hitMask[a] !== 0 && hitMask[b] !== 0) {
        continue;
      }

      const midpointX = (worldXByVertex[a] + worldXByVertex[b]) * 0.5;
      const midpointZ = (worldZByVertex[a] + worldZByVertex[b]) * 0.5;
      const midpointY = (projectedPositions[a * 3 + 1] + projectedPositions[b * 3 + 1]) * 0.5;
      const midpoint = this.pickSurface(scene, midpointX, midpointY, midpointZ, canPickMesh);
      if (!midpoint) {
        continue;
      }

      if (hitMask[a] === 0) {
        this.writeProjectedVertex(
          a,
          worldXByVertex[a],
          midpoint.y,
          worldZByVertex[a],
          midpoint.normal.x,
          midpoint.normal.y,
          midpoint.normal.z,
          projectedPositions,
          normalByVertex,
        );
        hitMask[a] = 2;
      }
      if (hitMask[b] === 0) {
        this.writeProjectedVertex(
          b,
          worldXByVertex[b],
          midpoint.y,
          worldZByVertex[b],
          midpoint.normal.x,
          midpoint.normal.y,
          midpoint.normal.z,
          projectedPositions,
          normalByVertex,
        );
        hitMask[b] = 2;
      }
    }
  }

  private shouldIncreasePreviewDensity(
    worldXByVertex: Float32Array,
    worldZByVertex: Float32Array,
    projectedPositions: Float32Array,
    hitMask: Uint8Array,
  ): { shouldIncreaseDensity: boolean; steepEdgeRatio: number } {
    if (
      this.previewRefineSteps >= PREVIEW_MAX_REFINE_STEPS ||
      this.previewSampleStep <= PREVIEW_MIN_SAMPLE_STEP
    ) {
      return { shouldIncreaseDensity: false, steepEdgeRatio: 0 };
    }

    const edges = this.previewEdges;
    if (edges.length === 0) {
      return { shouldIncreaseDensity: false, steepEdgeRatio: 0 };
    }

    let steepEdgeCount = 0;
    let consideredEdgeCount = 0;
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 2) {
      const a = edges[edgeIndex];
      const b = edges[edgeIndex + 1];
      if (hitMask[a] === 0 || hitMask[b] === 0) {
        steepEdgeCount += 1;
        consideredEdgeCount += 1;
        continue;
      }

      const horizontalDistance = Math.hypot(
        worldXByVertex[b] - worldXByVertex[a],
        worldZByVertex[b] - worldZByVertex[a],
      );
      if (horizontalDistance <= 0.0001) {
        continue;
      }

      const verticalDelta = Math.abs(projectedPositions[b * 3 + 1] - projectedPositions[a * 3 + 1]);
      consideredEdgeCount += 1;
      if (verticalDelta / horizontalDistance >= PREVIEW_REFINE_STEEP_EDGE_RATIO) {
        steepEdgeCount += 1;
      }
    }

    if (consideredEdgeCount === 0) {
      return { shouldIncreaseDensity: false, steepEdgeRatio: 0 };
    }
    const steepEdgeRatio = steepEdgeCount / consideredEdgeCount;
    return {
      shouldIncreaseDensity: steepEdgeRatio >= PREVIEW_REFINE_EDGE_FRACTION,
      steepEdgeRatio,
    };
  }

  private pickSurface(
    scene: Scene,
    x: number,
    y: number,
    z: number,
    canPickMesh: (mesh: Mesh) => boolean,
  ): { y: number; normal: { x: number; y: number; z: number } } | undefined {
    this.downRay.origin.set(x, y + PREVIEW_RAYCAST_HALF_HEIGHT, z);
    const downPick = scene.pickWithRay(
      this.downRay,
      (mesh) => mesh instanceof Mesh && canPickMesh(mesh),
      false,
    );
    const downNormal = downPick?.getNormal(true, true);
    if (downPick?.hit && downPick.pickedPoint) {
      return {
        y: downPick.pickedPoint.y,
        normal:
          downNormal &&
          Number.isFinite(downNormal.x) &&
          Number.isFinite(downNormal.y) &&
          Number.isFinite(downNormal.z)
            ? { x: downNormal.x, y: downNormal.y, z: downNormal.z }
            : { x: 0, y: 1, z: 0 },
      };
    }

    this.upRay.origin.set(x, y - PREVIEW_RAYCAST_HALF_HEIGHT, z);
    const upPick = scene.pickWithRay(
      this.upRay,
      (mesh) => mesh instanceof Mesh && canPickMesh(mesh),
      false,
    );
    const upNormal = upPick?.getNormal(true, true);
    if (!upPick?.hit || !upPick.pickedPoint) {
      return undefined;
    }

    return {
      y: upPick.pickedPoint.y,
      normal:
        upNormal &&
        Number.isFinite(upNormal.x) &&
        Number.isFinite(upNormal.y) &&
        Number.isFinite(upNormal.z)
          ? { x: upNormal.x, y: upNormal.y, z: upNormal.z }
          : { x: 0, y: 1, z: 0 },
    };
  }

  private buildPreviewGeometry(
    shape: AbilityDefinition["aoeShape"],
    sampleStep: number,
  ): PreviewGeometry {
    if (shape === "single") {
      return this.buildCircleGeometry(0.6, sampleStep);
    }

    switch (shape.type) {
      case "circle": {
        return this.buildCircleGeometry(shape.radius, sampleStep);
      }
      case "cone": {
        return this.buildConeGeometry(shape.length, shape.angleDeg, sampleStep);
      }
      case "line": {
        return this.buildLineGeometry(shape.width, shape.length, sampleStep);
      }
      default: {
        return this.buildCircleGeometry(0.6, sampleStep);
      }
    }
  }

  private buildCircleGeometry(radius: number, sampleStep: number): PreviewGeometry {
    const ringCount = clamp(Math.ceil(radius / sampleStep), 1, 10);
    const segmentCount = clamp(Math.ceil((Math.PI * 2 * radius) / sampleStep), 24, 96);
    const vertexCount = 1 + ringCount * segmentCount;
    const localSamples = new Float32Array(vertexCount * 2);
    const positions = new Float32Array(vertexCount * 3);

    localSamples[0] = 0;
    localSamples[1] = 0;
    positions[0] = 0;
    positions[1] = 0;
    positions[2] = 0;

    for (let ring = 1; ring <= ringCount; ring += 1) {
      const ringRadius = (radius * ring) / ringCount;
      for (let segment = 0; segment < segmentCount; segment += 1) {
        const angle = (segment / segmentCount) * Math.PI * 2;
        const x = Math.sin(angle) * ringRadius;
        const z = Math.cos(angle) * ringRadius;
        const index = 1 + (ring - 1) * segmentCount + segment;
        const sampleOffset = index * 2;
        const positionOffset = index * 3;
        localSamples[sampleOffset] = x;
        localSamples[sampleOffset + 1] = z;
        positions[positionOffset] = x;
        positions[positionOffset + 1] = 0;
        positions[positionOffset + 2] = z;
      }
    }

    const indexCount = (segmentCount + (ringCount - 1) * segmentCount * 2) * 3;
    const indices = new Uint32Array(indexCount);
    let writeIndex = 0;

    for (let segment = 0; segment < segmentCount; segment += 1) {
      const current = 1 + segment;
      const next = 1 + ((segment + 1) % segmentCount);
      indices[writeIndex] = 0;
      indices[writeIndex + 1] = current;
      indices[writeIndex + 2] = next;
      writeIndex += 3;
    }

    for (let ring = 1; ring < ringCount; ring += 1) {
      const currentStart = 1 + (ring - 1) * segmentCount;
      const nextStart = 1 + ring * segmentCount;
      for (let segment = 0; segment < segmentCount; segment += 1) {
        const current = currentStart + segment;
        const currentNext = currentStart + ((segment + 1) % segmentCount);
        const next = nextStart + segment;
        const nextNext = nextStart + ((segment + 1) % segmentCount);
        indices[writeIndex] = current;
        indices[writeIndex + 1] = next;
        indices[writeIndex + 2] = currentNext;
        indices[writeIndex + 3] = currentNext;
        indices[writeIndex + 4] = next;
        indices[writeIndex + 5] = nextNext;
        writeIndex += 6;
      }
    }

    return this.finalizePreviewGeometry(positions, localSamples, indices);
  }

  private buildConeGeometry(length: number, angleDeg: number, sampleStep: number): PreviewGeometry {
    const ringCount = clamp(Math.ceil(length / sampleStep), 1, 10);
    const angleRad = (angleDeg * Math.PI) / 180;
    const arcLength = Math.max(length * angleRad, sampleStep);
    const segmentCount = clamp(Math.ceil(arcLength / sampleStep), 12, 72);
    const pointsPerRing = segmentCount + 1;
    const vertexCount = 1 + ringCount * pointsPerRing;
    const localSamples = new Float32Array(vertexCount * 2);
    const positions = new Float32Array(vertexCount * 3);

    localSamples[0] = 0;
    localSamples[1] = 0;
    positions[0] = 0;
    positions[1] = 0;
    positions[2] = 0;

    const halfAngle = angleRad / 2;
    for (let ring = 1; ring <= ringCount; ring += 1) {
      const ringRadius = (length * ring) / ringCount;
      for (let segment = 0; segment <= segmentCount; segment += 1) {
        const t = segment / segmentCount;
        const angle = -halfAngle + t * angleRad;
        const x = Math.sin(angle) * ringRadius;
        const z = Math.cos(angle) * ringRadius;
        const index = 1 + (ring - 1) * pointsPerRing + segment;
        const sampleOffset = index * 2;
        const positionOffset = index * 3;
        localSamples[sampleOffset] = x;
        localSamples[sampleOffset + 1] = z;
        positions[positionOffset] = x;
        positions[positionOffset + 1] = 0;
        positions[positionOffset + 2] = z;
      }
    }

    const indexCount = (segmentCount + (ringCount - 1) * segmentCount * 2) * 3;
    const indices = new Uint32Array(indexCount);
    let writeIndex = 0;
    const getRingIndex = (ring: number, segment: number): number => {
      return 1 + (ring - 1) * pointsPerRing + segment;
    };

    for (let segment = 0; segment < segmentCount; segment += 1) {
      indices[writeIndex] = 0;
      indices[writeIndex + 1] = getRingIndex(1, segment);
      indices[writeIndex + 2] = getRingIndex(1, segment + 1);
      writeIndex += 3;
    }

    for (let ring = 1; ring < ringCount; ring += 1) {
      for (let segment = 0; segment < segmentCount; segment += 1) {
        const current = getRingIndex(ring, segment);
        const currentNext = getRingIndex(ring, segment + 1);
        const next = getRingIndex(ring + 1, segment);
        const nextNext = getRingIndex(ring + 1, segment + 1);
        indices[writeIndex] = current;
        indices[writeIndex + 1] = next;
        indices[writeIndex + 2] = currentNext;
        indices[writeIndex + 3] = currentNext;
        indices[writeIndex + 4] = next;
        indices[writeIndex + 5] = nextNext;
        writeIndex += 6;
      }
    }

    return this.finalizePreviewGeometry(positions, localSamples, indices);
  }

  private buildLineGeometry(width: number, length: number, sampleStep: number): PreviewGeometry {
    const widthSegments = clamp(Math.ceil(width / sampleStep), 1, 24);
    const lengthSegments = clamp(Math.ceil(length / sampleStep), 1, 48);
    const columns = widthSegments + 1;
    const rows = lengthSegments + 1;
    const vertexCount = columns * rows;
    const localSamples = new Float32Array(vertexCount * 2);
    const positions = new Float32Array(vertexCount * 3);

    for (let row = 0; row < rows; row += 1) {
      const z = (length * row) / lengthSegments;
      for (let column = 0; column < columns; column += 1) {
        const x = -width / 2 + (width * column) / widthSegments;
        const index = row * columns + column;
        const sampleOffset = index * 2;
        const positionOffset = index * 3;
        localSamples[sampleOffset] = x;
        localSamples[sampleOffset + 1] = z;
        positions[positionOffset] = x;
        positions[positionOffset + 1] = 0;
        positions[positionOffset + 2] = z;
      }
    }

    const indexCount = widthSegments * lengthSegments * 6;
    const indices = new Uint32Array(indexCount);
    let writeIndex = 0;

    for (let row = 0; row < lengthSegments; row += 1) {
      for (let column = 0; column < widthSegments; column += 1) {
        const topLeft = row * columns + column;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + columns;
        const bottomRight = bottomLeft + 1;
        indices[writeIndex] = topLeft;
        indices[writeIndex + 1] = bottomLeft;
        indices[writeIndex + 2] = topRight;
        indices[writeIndex + 3] = topRight;
        indices[writeIndex + 4] = bottomLeft;
        indices[writeIndex + 5] = bottomRight;
        writeIndex += 6;
      }
    }

    return this.finalizePreviewGeometry(positions, localSamples, indices);
  }

  private finalizePreviewGeometry(
    positions: Float32Array,
    localSamples: Float32Array,
    indices: Uint32Array,
  ): PreviewGeometry {
    const vertexCount = localSamples.length / 2;
    const { neighbors, edges } = this.buildConnectivity(vertexCount, indices);
    return { positions, localSamples, indices, neighbors, edges };
  }

  private buildConnectivity(
    vertexCount: number,
    indices: Uint32Array,
  ): { neighbors: number[][]; edges: Uint32Array } {
    const neighborSets = Array.from({ length: vertexCount }, () => new Set<number>());
    const edgeKeys = new Set<string>();

    const addEdge = (a: number, b: number): void => {
      if (a === b) {
        return;
      }
      neighborSets[a].add(b);
      neighborSets[b].add(a);
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      edgeKeys.add(`${min}:${max}`);
    };

    for (let index = 0; index < indices.length; index += 3) {
      const a = indices[index];
      const b = indices[index + 1];
      const c = indices[index + 2];
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
    }

    const neighbors = neighborSets.map((set) => [...set]);
    const edges = new Uint32Array(edgeKeys.size * 2);
    let writeIndex = 0;
    for (const edgeKey of edgeKeys) {
      const [aString, bString] = edgeKey.split(":");
      edges[writeIndex] = Number.parseInt(aString, 10);
      edges[writeIndex + 1] = Number.parseInt(bString, 10);
      writeIndex += 2;
    }

    return { neighbors, edges };
  }

  dispose(): void {
    this.disposePreviewMesh();
    if (this.previewMaterial) {
      this.previewMaterial.dispose();
      this.previewMaterial = undefined;
    }
    if (this.rangeHint) {
      this.world.getUiLayer()?.removeControl(this.rangeHint);
      this.rangeHint = undefined;
    }
    if (this.aimModeHint) {
      this.world.getUiLayer()?.removeControl(this.aimModeHint);
      this.aimModeHint = undefined;
    }
    if (this.projectionDebugHint) {
      this.world.getUiLayer()?.removeControl(this.projectionDebugHint);
      this.projectionDebugHint = undefined;
    }
  }
}
