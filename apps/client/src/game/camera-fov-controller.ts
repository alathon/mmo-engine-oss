import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { InputHandler } from "../input/input-handler";
import type { InputManager } from "../input/input-manager";

const FOV_STEPS = [Math.PI / 6, Math.PI / 4, Math.PI / 3];
const DEFAULT_TOGGLE_KEY = "v";

export class CameraFovController implements InputHandler {
  public priority = 10;

  constructor(
    private readonly camera: ArcRotateCamera,
    private readonly toggleKey: string = DEFAULT_TOGGLE_KEY,
  ) {}

  enabled(): boolean {
    return true;
  }

  handleTick(input: InputManager): void {
    if (!input.consumeKeyPress(this.toggleKey)) {
      return;
    }

    const currentIndex = this.resolveCurrentIndex();
    const nextIndex = (currentIndex + 1) % FOV_STEPS.length;
    this.camera.fov = FOV_STEPS[nextIndex];
  }

  private resolveCurrentIndex(): number {
    const currentFov = this.camera.fov;
    let bestIndex = 0;
    let bestDiff = Math.abs(currentFov - FOV_STEPS[0]);
    for (let i = 1; i < FOV_STEPS.length; i += 1) {
      const diff = Math.abs(currentFov - FOV_STEPS[i]);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }
    return bestIndex;
  }
}
