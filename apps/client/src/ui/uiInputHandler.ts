import type { InputHandler } from "../input/inputHandler";
import type { PointerClick } from "../input/inputManager";

/**
 * Minimal UI input handler that consumes pointer clicks over UI elements.
 */
export class UiInputHandler implements InputHandler {
  priority = 100;

  enabled(): boolean {
    return true;
  }

  handlePointerClick(click: PointerClick): boolean {
    if (typeof document === "undefined") {
      return false;
    }

    const element = document.elementFromPoint(click.clientX, click.clientY);
    if (!element) {
      return false;
    }

    if (element.closest("[data-ui-interactive]")) {
      return true;
    }

    return false;
  }
}
