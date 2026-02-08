import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { NavmeshObstacle } from "@mmo/shared";
import { Entity } from "./entity";
import type { UiLayer } from "../ui/uiLayer";

export type ObjShape = "box" | "sphere" | "cylinder";

/**
 * Options for creating an ObjEntity.
 * Note: modelMesh is created internally based on shape/size, not passed in.
 */
export interface ObjEntityOptions {
  /** Unique identifier for this entity. */
  id: string;
  /** Initial X position. */
  x: number;
  /** Initial Z position. */
  z: number;
  /** Initial Y position (height). Defaults to 0. */
  y?: number;
  /** Main body color. */
  color: Color3;
  /** Emissive color for the body. */
  emissiveColor?: Color3;
  /** Shape of the object mesh. Defaults to "box". */
  shape?: ObjShape;
  /** Size of the object. Defaults to 1. */
  size?: number;
  /** Whether this object can be picked up. Defaults to false. */
  isPickable?: boolean;
  /** Whether this object blocks movement. Defaults to true. */
  isCollidable?: boolean;
  /** Optional label to display above the object. */
  label?: string;
  /** UI layer for labels. */
  uiLayer: UiLayer;
}

/**
 * Creates a mesh based on the specified shape.
 */
function createShapeMesh(
  id: string,
  shape: ObjShape,
  size: number,
  scene: Scene,
): Mesh {
  switch (shape) {
    case "sphere":
      return MeshBuilder.CreateSphere(
        `${id}_body`,
        { diameter: size, segments: 16 },
        scene,
      );
    case "cylinder":
      return MeshBuilder.CreateCylinder(
        `${id}_body`,
        { diameter: size, height: size, tessellation: 16 },
        scene,
      );
    case "box":
    default:
      return MeshBuilder.CreateBox(`${id}_body`, { size }, scene);
  }
}

/**
 * Static object entity that can be placed in the game world.
 * Supports optional name labels, collision, and pickup state.
 * Does not move or have health/combat capabilities.
 */
export class ObjEntity extends Entity {
  protected nameLabel?: TextBlock;
  private uiLayer: UiLayer;

  public readonly isPickable: boolean;
  public readonly isCollidable: boolean;
  public readonly size: number;

  /**
   * Creates a new object entity.
   *
   * @param scene - Babylon.js scene to attach to.
   * @param options - object entity configuration options.
   */
  constructor(scene: Scene, options: ObjEntityOptions) {
    const {
      id,
      x,
      z,
      y = 0,
      color,
      emissiveColor,
      shape = "box",
      size = 1,
      isPickable = false,
      isCollidable = true,
      label,
      uiLayer,
    } = options;

    // Create model mesh based on shape
    const modelMesh = createShapeMesh(id, shape, size, scene);

    super(`obj_${id}`, scene, {
      id,
      x,
      z,
      y,
      color,
      emissiveColor,
      modelMesh,
      modelMeshOffsetY: size / 2, // Center the mesh at half its height
      hasCollision: isCollidable,
    });

    this.isPickable = isPickable;
    this.isCollidable = isCollidable;
    this.size = size;
    this.uiLayer = uiLayer;

    // Create optional label
    if (label) {
      this.nameLabel = this.createNameLabel(id, label);
    }
  }

  private createNameLabel(id: string, text: string): TextBlock {
    const label = new TextBlock(`nameLabel_${id}`);
    label.text = text;
    label.color = "white";
    label.fontSize = 12;
    label.fontFamily = "Segoe UI, system-ui, sans-serif";
    label.fontWeight = "500";
    label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    label.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;

    // Add outline for readability
    label.outlineWidth = 2;
    label.outlineColor = "black";

    // Add to game UI
    this.uiLayer.addControl(label);

    // Link to mesh with vertical offset
    label.linkWithMesh(this.modelMesh);
    label.linkOffsetY = -40; // Offset in screen pixels (negative = above)

    return label;
  }

  /**
   * Updates the visible label text.
   *
   * @param text - label text to show.
   */
  setLabel(text: string): void {
    if (this.nameLabel) {
      this.nameLabel.text = text;
    }
  }

  /**
   * Returns the current label text, or null if no label exists.
   */
  getLabel(): string | null {
    return this.nameLabel?.text ?? null;
  }

  /**
   * Returns obstacle data for navmesh generation, or null if not collidable.
   */
  getNavmeshObstacle(): NavmeshObstacle | null {
    if (!this.isCollidable) {
      return null;
    }
    return {
      x: this.position.x,
      z: this.position.z,
      radius: this.size / 2,
    };
  }

  /**
   * Disposes meshes, materials, and UI elements owned by this object.
   */
  override dispose(): void {
    if (this.nameLabel) {
      this.uiLayer.removeControl(this.nameLabel);
      this.nameLabel.dispose();
    }

    super.dispose();
  }
}
