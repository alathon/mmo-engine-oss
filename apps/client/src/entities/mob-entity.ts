import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { REMOTE_INTERPOLATION_DELAY_MS, REMOTE_SAMPLE_RETENTION_MS } from "@mmo/shared-sim";
import { MobState } from "@mmo/shared-sim";
import { Entity } from "./entity";
import { HealthBar } from "../ui/entity/health-bar";
import { SpeechBubble } from "../ui/entity/speech-bubble";
import { CastBar } from "../ui/entity/cast-bar";
import { applyMovementSmoothing } from "../movement/smoothing";
import { RemoteInterpolationController } from "../movement/remote-interpolation";
import type { MovementState, NavmeshMoveDebug } from "../movement/movement-types";
import type { UiLayer } from "../ui/ui-layer";

export interface MobEntityOptions {
  /** Unique identifier for this entity. */
  id: string;
  /** Initial X position. */
  x: number;
  /** Initial Z position. */
  z: number;
  /** Main body color. */
  color: Color3;
  /** Emissive color for the body. */
  emissiveColor?: Color3;
  /** Initial facing direction in radians. */
  facingYaw?: number;
  /** Initial current HP. */
  currentHp: number;
  /** Initial max HP. */
  maxHp: number;
}

/**
 * Creates the capsule mesh used for mob characters.
 */
function createCapsuleMesh(id: string, scene: Scene): Mesh {
  return MeshBuilder.CreateCapsule(
    `${id}_body`,
    {
      radius: 0.4,
      height: 1.8,
      tessellation: 16,
      subdivisions: 1,
    },
    scene,
  );
}

/**
 * Mobile entity class for characters that can move, have health, and display UI.
 * Used for both player characters and NPCs.
 */
export class MobEntity extends Entity {
  private static serverPositionMaterial?: StandardMaterial;
  public sync: MobState;
  protected directionIndicator: Mesh;
  protected directionMaterial: StandardMaterial;
  protected nameLabel: TextBlock;
  protected healthBar: HealthBar;
  protected speechBubble: SpeechBubble;
  protected castBar: CastBar;
  public serverPositionVisual: Mesh;

  /**
   * Movement state shared by movement helpers.
   */
  protected readonly movementState: MovementState;

  /**
   * Cached navmesh movement debug info from the last step.
   */
  private lastNavmeshMoveDebug?: NavmeshMoveDebug;

  private readonly remoteInterpolation: RemoteInterpolationController;
  protected readonly uiLayer: UiLayer;

  /** Y offset for the model mesh position (center of billboard). */
  private static readonly MODEL_MESH_OFFSET_Y = 1;

  /**
   * Creates a new mobile entity.
   *
   * @param name - name for the TransformNode.
   * @param scene - Babylon.js scene to attach to.
   * @param options - mob entity configuration options.
   */
  constructor(name: string, scene: Scene, sync: MobState, uiLayer: UiLayer) {
    const modelMesh = createCapsuleMesh(sync.id, scene);

    super(name, scene, {
      id: sync.id,
      x: sync.x,
      z: sync.z,
      color: new Color3(0.6, 0.25, 0.25),
      emissiveColor: new Color3(0.2, 0.08, 0.08),
      modelMesh,
      modelMeshOffsetY: MobEntity.MODEL_MESH_OFFSET_Y,
      hasCollision: true,
      collisionChecksEnabled: false,
    });

    this.sync = sync;
    this.uiLayer = uiLayer;
    // Initialize position tracking
    this.movementState = {
      targetPosition: new Vector3(sync.x, sync.y, sync.z),
      previousTargetPosition: new Vector3(sync.x, sync.y, sync.z),
      serverPosition: new Vector3(sync.x, sync.y, sync.z),
      facingYaw: sync.facingYaw,
      movementYaw: sync.facingYaw,
    };
    this.remoteInterpolation = new RemoteInterpolationController(
      REMOTE_INTERPOLATION_DELAY_MS,
      REMOTE_SAMPLE_RETENTION_MS,
    );

    // Add a directional indicator so facing is visible
    this.directionIndicator = MeshBuilder.CreateCylinder(
      `${sync.id}_dir`,
      {
        diameterTop: 0,
        diameterBottom: 0.25,
        height: 0.45,
        tessellation: 8,
      },
      scene,
    );
    this.directionIndicator.parent = this;
    this.directionIndicator.position = new Vector3(0, MobEntity.MODEL_MESH_OFFSET_Y + 0.6, 0.75);
    this.directionIndicator.rotation.x = Math.PI / 2;

    this.directionMaterial = new StandardMaterial(`${sync.id}_dirMat`, scene);
    this.directionMaterial.diffuseColor = new Color3(0.95, 0.75, 0.2);
    this.directionMaterial.emissiveColor = new Color3(0.35, 0.25, 0.05);
    this.directionIndicator.material = this.directionMaterial;

    if (!MobEntity.serverPositionMaterial) {
      const material = new StandardMaterial("server_position_mat", scene);
      material.diffuseColor = new Color3(0.95, 0.1, 0.1);
      material.emissiveColor = new Color3(0.6, 0.05, 0.05);
      MobEntity.serverPositionMaterial = material;
    }

    this.serverPositionVisual = MeshBuilder.CreateSphere(
      `${sync.id}_server_position`,
      {
        diameter: 0.25,
        segments: 8,
      },
      scene,
    );
    this.serverPositionVisual.isPickable = false;
    this.serverPositionVisual.material = MobEntity.serverPositionMaterial;
    this.serverPositionVisual.position.set(sync.x, sync.y, sync.z);
    this.serverPositionVisual.setEnabled(false);

    // Create name label
    this.nameLabel = this.createNameLabel(sync.name);

    // Create health bar
    this.healthBar = new HealthBar(
      this.getModelMesh(),
      sync.currentHp,
      sync.maxHp,
      {
        id: sync.id,
        linkOffsetY: -40,
      },
      this.uiLayer,
    );

    // Create cast bar (hidden until casting)
    this.castBar = new CastBar(
      this.getModelMesh(),
      {
        id: sync.id,
      },
      this.uiLayer,
    );

    // Create speech bubble (hidden by default)
    this.speechBubble = new SpeechBubble(
      this.getModelMesh(),
      {
        id: sync.id,
        linkOffsetY: -90,
      },
      this.uiLayer,
    );
  }

  /**
   * Builds the on-screen name label for this entity.
   *
   * @param name - display name to show.
   * @return Babylon.js TextBlock used for the label.
   */
  protected createNameLabel(name: string): TextBlock {
    const label = new TextBlock(`nameLabel_${this.sync.id}`);
    label.text = name;
    label.color = "white";
    label.fontSize = 14;
    label.fontFamily = "Segoe UI, system-ui, sans-serif";
    label.fontWeight = "600";
    label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    label.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;

    // Add outline for readability
    label.outlineWidth = 3;
    label.outlineColor = "black";

    // Add to game UI
    this.uiLayer.addControl(label);

    // Link to mesh with vertical offset
    label.linkWithMesh(this.getModelMesh());
    label.linkOffsetY = -60; // Offset in screen pixels (negative = above)

    return label;
  }

  /**
   * Updates the visible name label.
   *
   * @param name - display name to show.
   */
  setName(name: string): void {
    this.nameLabel.text = name;
  }

  /**
   * Returns the current display name.
   *
   * @return display name.
   */
  getName(): string {
    return this.nameLabel.text;
  }

  getCurrentHp(): number {
    return this.healthBar.currentHp;
  }

  setCurrentHp(value: number): void {
    this.healthBar.currentHp = value;
  }

  getMaxHp(): number {
    return this.healthBar.maxHp;
  }

  setMaxHp(value: number): void {
    this.healthBar.maxHp = value;
  }

  /**
   * Shows a speech bubble with the given message.
   * The bubble will fade out after 5-6 seconds.
   *
   * @param message - the message to display in the speech bubble.
   */
  showSpeechBubble(message: string): void {
    this.speechBubble.show(message);
  }

  /**
   * Updates the target position the entity will interpolate toward.
   *
   * @param x - target X position.
   * @param z - target Z position.
   * @param y - optional target Y (height) position.
   */
  setTargetPosition(x: number, y: number, z: number, updateYaw = true): void {
    if (updateYaw) {
      const deltaX = x - this.movementState.targetPosition.x;
      const deltaZ = z - this.movementState.targetPosition.z;
      if (Math.abs(deltaX) > 0.0001 || Math.abs(deltaZ) > 0.0001) {
        this.movementState.movementYaw = Math.atan2(deltaX, deltaZ);
      }

      this.movementState.previousTargetPosition.copyFrom(this.movementState.targetPosition);
    } else {
      this.movementState.previousTargetPosition.set(x, y, z);
    }

    this.movementState.targetPosition.x = x;
    this.movementState.targetPosition.y = y;
    this.movementState.targetPosition.z = z;
  }

  /**
   * Returns the current target position.
   *
   * @returns target position.
   */
  getTargetPosition(): Vector3 {
    return this.movementState.targetPosition;
  }

  getPreviousTargetPosition(): Vector3 {
    return this.movementState.previousTargetPosition;
  }

  setFacingYaw(value: number): void {
    this.movementState.facingYaw = value;
  }

  getFacingYaw(): number {
    return this.movementState.facingYaw;
  }

  /**
   * Updates the authoritative server position for this entity.
   */
  setServerPosition(x: number, y: number, z: number): void {
    this.movementState.serverPosition.x = x;
    this.movementState.serverPosition.y = y;
    this.movementState.serverPosition.z = z;

    if (this.serverPositionVisual.isEnabled()) {
      this.serverPositionVisual.position.set(x, y, z);
    }
  }

  protected getServerPosition(): Vector3 {
    return this.movementState.serverPosition;
  }

  /**
   * Enables/disables interpolation using buffered server snapshots.
   */
  setInterpolationEnabled(enabled: boolean): void {
    this.remoteInterpolation.setEnabled(enabled);
  }

  /**
   * Buffers a server snapshot for interpolation.
   */
  addRemoteMoveSample(state: MobState): void {
    this.remoteInterpolation.addSample({
      timeMs: state.serverTimeMs || Date.now(),
      x: state.x,
      y: state.y,
      z: state.z,
      facingYaw: state.facingYaw,
    });
  }

  /**
   * Clears the cached navmesh node reference.
   */
  resetNavmeshNodeRef(): void {
    this.movementState.navmeshNodeRef = undefined;
  }

  protected getNavmeshNodeRef(): number | undefined {
    return this.movementState.navmeshNodeRef;
  }

  protected setNavmeshNodeRef(nodeRef?: number): void {
    this.movementState.navmeshNodeRef = nodeRef;
  }

  protected setNavmeshMoveDebug(debug?: NavmeshMoveDebug): void {
    this.lastNavmeshMoveDebug = debug;
  }

  getMovementYaw(): number {
    return this.movementState.movementYaw;
  }

  setMovementYaw(value: number): void {
    this.movementState.movementYaw = value;
  }

  getLastNavmeshMoveDebug(): NavmeshMoveDebug | undefined {
    return this.lastNavmeshMoveDebug;
  }

  /**
   * Per-frame updates. This should be used for things that don't affect the game world simulation,
   * i.e., pretty much exclusively 'visual updates' like interpolated movement towards a known position.
   *
   * @param deltaTimeMs - elapsed time since last update, in milliseconds.
   */
  override update(deltaTimeMs: number, fixedTickAlpha = 1): void {
    // Interpolate towards targetPosition
    applyMovementSmoothing(this, deltaTimeMs, fixedTickAlpha);

    const abilityState = this.sync.abilityState;
    const castStart = abilityState.castStartTimeMs;
    const castEnd = abilityState.castEndTimeMs;
    const hasCastWindow = castEnd > castStart;
    const nowMs = Date.now();
    const isCasting = hasCastWindow && abilityState.isCasting(nowMs);
    const progress = isCasting && hasCastWindow ? (nowMs - castStart) / (castEnd - castStart) : 0;
    this.castBar.update(progress, isCasting && hasCastWindow);
  }

  override fixedTick(tickMs: number): void {
    super.fixedTick(tickMs);
    if (this.remoteInterpolation.isEnabled()) {
      const sample = this.remoteInterpolation.getRenderSample(Date.now());
      if (!sample) {
        return;
      }

      this.setTargetPosition(sample.x, sample.y, sample.z);
    }
  }

  /**
   * Disposes meshes, materials, and UI elements owned by this entity.
   */
  override dispose(): void {
    // Remove name label from UI
    this.uiLayer.removeControl(this.nameLabel);
    this.nameLabel.dispose();
    // Dispose UI components
    this.healthBar.dispose();
    this.speechBubble.dispose();
    this.castBar.dispose();

    super.dispose();
  }
}
