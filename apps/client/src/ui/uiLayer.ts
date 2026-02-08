import type { Control } from "@babylonjs/gui/2D/controls/control";

export interface UiLayer {
  addControl(control: Control): UiLayer;
  removeControl(control: Control): UiLayer;
}
