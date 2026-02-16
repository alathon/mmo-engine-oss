import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { InputHandler } from "../input/input-handler";
import type { InputManager } from "../input/input-manager";

const ANGLE_STEPS = [Math.PI / 6, Math.PI / 4, Math.PI / 3];
const DEFAULT_TOGGLE_KEY = "x";

export class CameraAngleController implements InputHandler {
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
    const nextIndex = (currentIndex + 1) % ANGLE_STEPS.length;
    const nextBeta = ANGLE_STEPS[nextIndex];
    this.camera.beta = nextBeta;
  }

  private resolveCurrentIndex(): number {
    const currentBeta = this.camera.beta;
    let bestIndex = 0;
    let bestDiff = Math.abs(currentBeta - ANGLE_STEPS[0]);
    for (let i = 1; i < ANGLE_STEPS.length; i += 1) {
      const diff = Math.abs(currentBeta - ANGLE_STEPS[i]);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }
    return bestIndex;
  }
}
