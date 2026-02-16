import type { InputManager, PointerClick, PointerDrag } from "./input-manager";

export interface InputHandler {
  /**
   * Higher numbers run first.
   */
  priority: number;
  /**
   * Whether this handler should receive input right now.
   */
  enabled(): boolean;
  /**
   * Optional per-tick handler for key presses or continuous input.
   */
  handleTick?(input: InputManager): void;
  /**
   * Optional per-frame handler for visual updates and cursor-driven previews.
   */
  handleFrame?(input: InputManager): void;
  /**
   * Handle a single pointer click. Return true to consume it.
   */
  handlePointerClick?(click: PointerClick): boolean;
  /**
   * Handle a pointer drag event. Return true to consume it.
   */
  handlePointerDrag?(drag: PointerDrag): boolean;
}
