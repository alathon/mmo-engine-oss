import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Control } from "@babylonjs/gui/2D/controls/control";

/**
 * Controls full-screen Babylon GUI screens (login, character select, etc.).
 */
export class FullscreenUiController {
  public readonly texture: AdvancedDynamicTexture;
  private activeRoot?: Control;

  /**
   * Creates a new fullscreen UI controller.
   *
   * @param scene - Babylon.js scene to attach the UI to.
   */
  constructor(scene: Scene) {
    this.texture = AdvancedDynamicTexture.CreateFullscreenUI("fullscreenUI", true, scene);
  }

  /**
   * Replaces the currently active screen root.
   *
   * @param control - root control to show.
   */
  setRoot(control?: Control): void {
    if (this.activeRoot) {
      this.texture.removeControl(this.activeRoot);
    }

    this.activeRoot = control;
    if (control) {
      this.texture.addControl(control);
    }
  }

  /**
   * Removes the active screen root.
   */
  clear(): void {
    this.setRoot(undefined);
  }

  /**
   * Disposes the full-screen UI texture.
   */
  dispose(): void {
    this.clear();
    this.texture.dispose();
  }
}
