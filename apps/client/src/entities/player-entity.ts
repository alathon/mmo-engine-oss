import { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { MobEntity } from "./mob-entity";
import { PlayerState } from "@mmo/shared";
import type { UiLayer } from "../ui/ui-layer";
import type { NavmeshMoveDebug } from "../movement/movement-types";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * Player character entity.
 * Extends MobEntity with player-specific behavior (local player detection, color generation).
 */
export class PlayerEntity extends MobEntity {
  public sync: PlayerState;
  public readonly isLocal: boolean;
  private disconnectedLabel: TextBlock;
  /**
   * Creates a new player entity.
   *
   * @param scene - Babylon.js scene to attach meshes to.
   * @param playerId - unique player identifier.
   * @param x - initial X position from server.
   * @param z - initial Z position from server.
   * @param isLocal - whether this entity is the local player.
   * @param currentHp - current hit points from server.
   * @param maxHp - maximum hit points from server.
   * @param facingYaw - initial facing direction in radians.
   */
  constructor(scene: Scene, sync: PlayerState, isLocal: boolean, uiLayer: UiLayer) {
    super(`player_${sync.playerId}`, scene, sync, uiLayer);

    const color = PlayerEntity.generateColorFromId(sync.playerId);
    this.material.diffuseColor = color;
    this.material.emissiveColor = color.scale(0.3);

    this.sync = sync;
    this.isLocal = isLocal;
    this.setInterpolationEnabled(!isLocal);
    this.disconnectedLabel = this.createDisconnectedLabel(this.sync.isDisconnected);
    if (isLocal) {
      console.debug("Local player entity created", {
        playerId: sync.playerId,
        x: sync.x,
        z: sync.z,
      });
    }
  }

  /**
   * Updates the visible disconnected indicator.
   *
   * @param isDisconnected - whether to show the disconnected indicator.
   */
  setDisconnected(isDisconnected: boolean): void {
    this.disconnectedLabel.isVisible = isDisconnected;
  }

  /**
   * Disposes player-only UI elements.
   */
  override dispose(): void {
    this.uiLayer.removeControl(this.disconnectedLabel);
    this.disconnectedLabel.dispose();
    super.dispose();
  }

  getServerPositionSnapshot(): Vector3 {
    return this.getServerPosition();
  }

  getNavmeshNodeRef(): number | undefined {
    return super.getNavmeshNodeRef();
  }

  setNavmeshNodeRef(nodeRef?: number): void {
    super.setNavmeshNodeRef(nodeRef);
  }

  setNavmeshMoveDebug(debug?: NavmeshMoveDebug): void {
    super.setNavmeshMoveDebug(debug);
  }

  /**
   * Generates a stable color based on an id string.
   *
   * @param id - identifier used to derive the color.
   * @return color derived from the id.
   */
  private static generateColorFromId(id: string): Color3 {
    // Generate a consistent color from session ID
    let hash = 0;
    for (const char of id) {
      const code = char.codePointAt(0);
      if (code !== undefined) {
        hash = code + ((hash << 5) - hash);
      }
    }

    // Generate HSL color with fixed saturation and lightness
    const hue = Math.abs(hash % 360) / 360;

    // Convert HSL to RGB (simplified)
    const h = hue * 6;
    const x = 1 - Math.abs((h % 2) - 1);

    let r = 0,
      g = 0,
      b = 0;
    if (h < 1) {
      r = 1;
      g = x;
    } else if (h < 2) {
      r = x;
      g = 1;
    } else if (h < 3) {
      g = 1;
      b = x;
    } else if (h < 4) {
      g = x;
      b = 1;
    } else if (h < 5) {
      r = x;
      b = 1;
    } else {
      r = 1;
      b = x;
    }

    // Adjust for saturation/lightness
    const sat = 0.7;
    const light = 0.6;

    r = light + sat * (r - 0.5);
    g = light + sat * (g - 0.5);
    b = light + sat * (b - 0.5);

    return new Color3(
      Math.max(0, Math.min(1, r)),
      Math.max(0, Math.min(1, g)),
      Math.max(0, Math.min(1, b)),
    );
  }

  private createDisconnectedLabel(isDisconnected = false): TextBlock {
    const label = new TextBlock(`disconnect_${this.sync.playerId}`);
    label.text = "X";
    label.color = "#ff3b30";
    label.fontSize = 16;
    label.fontFamily = "Segoe UI, system-ui, sans-serif";
    label.fontWeight = "700";
    label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    label.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    label.outlineWidth = 4;
    label.outlineColor = "black";
    label.isVisible = isDisconnected;

    this.uiLayer.addControl(label);
    label.linkWithMesh(this.getModelMesh());
    label.linkOffsetY = -85;

    return label;
  }
}
