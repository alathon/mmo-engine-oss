import type { InputManager } from "./inputManager";
import type { InputHandler } from "./inputHandler";

/**
 * Dispatches input to registered handlers in priority order.
 */
export class InputRouter {
  private handlers: InputHandler[] = [];
  private needsSort = false;

  constructor(private readonly input: InputManager) {}

  registerHandler(handler: InputHandler): void {
    this.handlers.push(handler);
    this.needsSort = true;
  }

  unregisterHandler(handler: InputHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index >= 0) {
      this.handlers.splice(index, 1);
    }
  }

  clearHandlers(): void {
    this.handlers = [];
    this.needsSort = false;
  }

  update(): void {
    const activeHandlers = this.getActiveHandlers();

    for (const handler of activeHandlers) {
      handler.handleTick?.(this.input);
    }

    const drags = this.input.consumeAllPointerDrags();
    if (drags.length > 0) {
      for (const drag of drags) {
        for (const handler of activeHandlers) {
          const consumed = handler.handlePointerDrag?.(drag);
          if (consumed) {
            break;
          }
        }
      }
    }

    const clicks = this.input.consumeAllPointerClicks();
    if (clicks.length === 0) {
      return;
    }

    for (const click of clicks) {
      for (const handler of activeHandlers) {
        const consumed = handler.handlePointerClick?.(click);
        if (consumed) {
          break;
        }
      }
    }
  }

  updateFrame(): void {
    const activeHandlers = this.getActiveHandlers();

    for (const handler of activeHandlers) {
      handler.handleFrame?.(this.input);
    }
  }

  private getActiveHandlers(): InputHandler[] {
    if (this.needsSort) {
      this.handlers.sort((a, b) => b.priority - a.priority);
      this.needsSort = false;
    }

    return this.handlers.filter((handler) => handler.enabled());
  }
}
