import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { Control } from "@babylonjs/gui/2D/controls/control";
import type { UiLayer } from "../ui-layer";

// Health bar dimensions (in pixels)
const DEFAULT_WIDTH = 60;
const DEFAULT_HEIGHT = 8;

export interface HealthBarOptions {
  /** Unique identifier for naming UI elements. */
  id: string;
  /** Width in pixels. Defaults to 60. */
  width?: number;
  /** Height in pixels. Defaults to 8. */
  height?: number;
  /** Vertical offset in screen pixels (negative = above mesh). Defaults to -40. */
  linkOffsetY?: number;
}

/**
 * A health bar UI component that displays current/max HP as a colored bar.
 * Links to a mesh and follows it in screen space.
 */
export class HealthBar {
  private background: Rectangle;
  private fill: Rectangle;
  private _currentHp: number;
  private _maxHp: number;
  private uiLayer: UiLayer;

  constructor(
    mesh: AbstractMesh,
    initialHp: number,
    maxHp: number,
    options: HealthBarOptions,
    uiLayer: UiLayer,
  ) {
    const width = options.width ?? DEFAULT_WIDTH;
    const height = options.height ?? DEFAULT_HEIGHT;
    const linkOffsetY = options.linkOffsetY ?? -40;

    this._maxHp = Math.max(1, maxHp);
    this._currentHp = Math.max(0, Math.min(initialHp, this._maxHp));
    this.uiLayer = uiLayer;

    // Background (dark container)
    this.background = new Rectangle(`healthBarBg_${options.id}`);
    this.background.width = `${width}px`;
    this.background.height = `${height}px`;
    this.background.cornerRadius = 2;
    this.background.color = "black";
    this.background.thickness = 1;
    this.background.background = "#333333";

    this.uiLayer.addControl(this.background);
    this.background.linkWithMesh(mesh);
    this.background.linkOffsetY = linkOffsetY;

    // Fill bar (colored portion)
    this.fill = new Rectangle(`healthBarFill_${options.id}`);
    this.fill.height = "100%";
    this.fill.cornerRadius = 1;
    this.fill.color = "transparent";
    this.fill.thickness = 0;
    this.fill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;

    this.background.addControl(this.fill);

    // Initial update
    this.updateDisplay();
  }

  get currentHp(): number {
    return this._currentHp;
  }

  set currentHp(value: number) {
    this._currentHp = Math.max(0, Math.min(value, this._maxHp));
    this.updateDisplay();
  }

  get maxHp(): number {
    return this._maxHp;
  }

  set maxHp(value: number) {
    this._maxHp = Math.max(1, value);
    this._currentHp = Math.min(this._currentHp, this._maxHp);
    this.updateDisplay();
  }

  private getPercentage(): number {
    return this._currentHp / this._maxHp;
  }

  private getColor(): string {
    const percentage = this.getPercentage();
    if (percentage > 0.6) {
      return "#44cc44"; // Green
    } else if (percentage > 0.3) {
      return "#cccc44"; // Yellow
    } else {
      return "#cc4444"; // Red
    }
  }

  private updateDisplay(): void {
    const percentage = this.getPercentage();
    this.fill.width = `${percentage * 100}%`;
    this.fill.background = this.getColor();
  }

  dispose(): void {
    this.uiLayer.removeControl(this.background);
    this.fill.dispose();
    this.background.dispose();
  }
}
