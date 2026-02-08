import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { Control } from "@babylonjs/gui/2D/controls/control";
import type { UiLayer } from "../uiLayer";

const DEFAULT_WIDTH = 70;
const DEFAULT_HEIGHT = 6;

export interface CastBarOptions {
  /** Unique identifier for naming UI elements. */
  id: string;
  /** Width in pixels. Defaults to 70. */
  width?: number;
  /** Height in pixels. Defaults to 6. */
  height?: number;
  /** Vertical offset in screen pixels (negative = above mesh). Defaults to -28. */
  linkOffsetY?: number;
}

/**
 * A minimal cast bar UI component for displaying cast progress.
 * Links to a mesh and follows it in screen space.
 */
export class CastBar {
  private background: Rectangle;
  private fill: Rectangle;
  private uiLayer: UiLayer;
  private isVisible = false;
  private lastProgress = -1;

  constructor(mesh: AbstractMesh, options: CastBarOptions, uiLayer: UiLayer) {
    const width = options.width ?? DEFAULT_WIDTH;
    const height = options.height ?? DEFAULT_HEIGHT;
    const linkOffsetY = options.linkOffsetY ?? -28;

    this.uiLayer = uiLayer;

    this.background = new Rectangle(`castBarBg_${options.id}`);
    this.background.width = `${width}px`;
    this.background.height = `${height}px`;
    this.background.cornerRadius = 2;
    this.background.color = "black";
    this.background.thickness = 1;
    this.background.background = "#1f1f1f";
    this.background.isVisible = false;

    this.uiLayer.addControl(this.background);
    this.background.linkWithMesh(mesh);
    this.background.linkOffsetY = linkOffsetY;

    this.fill = new Rectangle(`castBarFill_${options.id}`);
    this.fill.height = "100%";
    this.fill.cornerRadius = 1;
    this.fill.color = "transparent";
    this.fill.thickness = 0;
    this.fill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.fill.background = "#48a0ff";

    this.background.addControl(this.fill);
  }

  update(progress: number, visible: boolean): void {
    if (visible !== this.isVisible) {
      this.isVisible = visible;
      this.background.isVisible = visible;
    }

    if (!visible) {
      this.lastProgress = -1;
      return;
    }

    const clamped = Math.max(0, Math.min(1, progress));
    if (Math.abs(clamped - this.lastProgress) < 0.001) {
      return;
    }

    this.lastProgress = clamped;
    this.fill.width = `${clamped * 100}%`;
  }

  dispose(): void {
    this.uiLayer.removeControl(this.background);
    this.fill.dispose();
    this.background.dispose();
  }
}
