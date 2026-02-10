import type { Scene } from '@babylonjs/core/scene';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

export interface PointerClick {
  button: number;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export type PointerDragPhase = 'start' | 'move' | 'end';

export interface PointerDrag {
  button: number;
  phase: PointerDragPhase;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
  startClientX: number;
  startClientY: number;
  deltaX: number;
  deltaY: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export interface InputManager {
  initialize(scene: Scene): void;
  getMovementDirection(): Vector3;
  isSprinting(): boolean;
  isRightMouseDown(): boolean;
  isChatInputFocused(): boolean;
  isKeyDown(key: string): boolean;
  consumeKeyPress(key: string): boolean;
  consumePointerClick(button?: number): PointerClick | undefined;
  consumeAllPointerClicks(): PointerClick[];
  consumePointerDrag(button?: number): PointerDrag | undefined;
  consumeAllPointerDrags(): PointerDrag[];
  dispose(): void;
}
