import type { Observer } from '@babylonjs/core/Misc/observable';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { KeyboardEventTypes, type KeyboardInfo } from '@babylonjs/core/Events/keyboardEvents';
import { PointerEventTypes, type PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import type { InputManager, PointerClick, PointerDrag } from './input-manager';

export class DomInputManager implements InputManager {
  private static readonly CLICK_DRAG_THRESHOLD_PX = 6;
  private static readonly CLICK_DRAG_THRESHOLD_SQ =
    DomInputManager.CLICK_DRAG_THRESHOLD_PX * DomInputManager.CLICK_DRAG_THRESHOLD_PX;

  private isInitialized = false;
  private scene?: Scene;
  private keyboardObserver?: Observer<KeyboardInfo>;
  private pointerObserver?: Observer<PointerInfo>;
  private readonly handleUiFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }

    if (event.target.closest('[data-ui-input]')) {
      this.chatInputFocused = true;
    }
  };

  private readonly handleUiFocusOut = (event: FocusEvent) => {
    const nextTarget =
      (event.relatedTarget instanceof HTMLElement ? event.relatedTarget : document.activeElement) ??
      undefined;
    if (!nextTarget || !(nextTarget instanceof HTMLElement)) {
      this.chatInputFocused = false;
      return;
    }

    if (!nextTarget.closest('[data-ui-input]')) {
      this.chatInputFocused = false;
    }
  };

  public get initialized(): boolean {
    return this.isInitialized;
  }

  private keys = new Map<string, boolean>();
  private mouseButtons = new Map<number, boolean>();
  private pressedKeys = new Set<string>();
  private chatInputFocused = false;
  private pointerClicks: PointerClick[] = [];
  private pointerDrags: PointerDrag[] = [];
  private pointerDowns = new Map<
    number,
    {
      x: number;
      y: number;
      clientX: number;
      clientY: number;
      dragging: boolean;
    }
  >();

  public initialize(scene: Scene): void {
    if (this.isInitialized) {
      return;
    }
    this.scene = scene;

    // Track keyboard input
    this.keyboardObserver = scene.onKeyboardObservable.add((kbInfo) => {
      const key = kbInfo.event.key.toLowerCase();

      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        if (!this.keys.get(key)) {
          this.pressedKeys.add(key);
        }
        this.keys.set(key, true);
      } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
        this.keys.set(key, false);
      }
    });

    // Track mouse button input
    this.pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        this.mouseButtons.set(pointerInfo.event.button, true);
        this.pointerDowns.set(pointerInfo.event.button, {
          x: scene.pointerX,
          y: scene.pointerY,
          clientX: pointerInfo.event.clientX,
          clientY: pointerInfo.event.clientY,
          dragging: false,
        });
        return;
      }

      if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
        if (this.pointerDowns.size === 0) {
          return;
        }

        const currentX = scene.pointerX;
        const currentY = scene.pointerY;
        for (const [button, down] of this.pointerDowns.entries()) {
          const dx = pointerInfo.event.clientX - down.clientX;
          const dy = pointerInfo.event.clientY - down.clientY;
          const distSq = dx * dx + dy * dy;

          if (!down.dragging && distSq > DomInputManager.CLICK_DRAG_THRESHOLD_SQ) {
            down.dragging = true;
            this.pointerDrags.push({
              button,
              phase: 'start',
              x: currentX,
              y: currentY,
              clientX: pointerInfo.event.clientX,
              clientY: pointerInfo.event.clientY,
              startX: down.x,
              startY: down.y,
              startClientX: down.clientX,
              startClientY: down.clientY,
              deltaX: dx,
              deltaY: dy,
              altKey: pointerInfo.event.altKey,
              ctrlKey: pointerInfo.event.ctrlKey,
              shiftKey: pointerInfo.event.shiftKey,
            });
            continue;
          }

          if (down.dragging) {
            this.pointerDrags.push({
              button,
              phase: 'move',
              x: currentX,
              y: currentY,
              clientX: pointerInfo.event.clientX,
              clientY: pointerInfo.event.clientY,
              startX: down.x,
              startY: down.y,
              startClientX: down.clientX,
              startClientY: down.clientY,
              deltaX: dx,
              deltaY: dy,
              altKey: pointerInfo.event.altKey,
              ctrlKey: pointerInfo.event.ctrlKey,
              shiftKey: pointerInfo.event.shiftKey,
            });
          }
        }
        return;
      } else if (pointerInfo.type === PointerEventTypes.POINTERUP) {
        this.mouseButtons.set(pointerInfo.event.button, false);
        const down = this.pointerDowns.get(pointerInfo.event.button);
        this.pointerDowns.delete(pointerInfo.event.button);
        if (!down) {
          return;
        }

        const dx = pointerInfo.event.clientX - down.clientX;
        const dy = pointerInfo.event.clientY - down.clientY;
        if (down.dragging) {
          this.pointerDrags.push({
            button: pointerInfo.event.button,
            phase: 'end',
            x: scene.pointerX,
            y: scene.pointerY,
            clientX: pointerInfo.event.clientX,
            clientY: pointerInfo.event.clientY,
            startX: down.x,
            startY: down.y,
            startClientX: down.clientX,
            startClientY: down.clientY,
            deltaX: dx,
            deltaY: dy,
            altKey: pointerInfo.event.altKey,
            ctrlKey: pointerInfo.event.ctrlKey,
            shiftKey: pointerInfo.event.shiftKey,
          });
          return;
        }
        if (dx * dx + dy * dy > DomInputManager.CLICK_DRAG_THRESHOLD_SQ) {
          return;
        }

        this.pointerClicks.push({
          button: pointerInfo.event.button,
          x: scene.pointerX,
          y: scene.pointerY,
          clientX: pointerInfo.event.clientX,
          clientY: pointerInfo.event.clientY,
          altKey: pointerInfo.event.altKey,
          ctrlKey: pointerInfo.event.ctrlKey,
          shiftKey: pointerInfo.event.shiftKey,
        });
      }
    });

    document.addEventListener('focusin', this.handleUiFocusIn);
    document.addEventListener('focusout', this.handleUiFocusOut);
    this.isInitialized = true;
  }

  public dispose(): void {
    if (!this.isInitialized) {
      return;
    }

    if (this.scene && this.keyboardObserver) {
      this.scene.onKeyboardObservable.remove(this.keyboardObserver);
      this.keyboardObserver = undefined;
    }
    if (this.scene && this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = undefined;
    }
    document.removeEventListener('focusin', this.handleUiFocusIn);
    document.removeEventListener('focusout', this.handleUiFocusOut);

    this.scene = undefined;
    this.keys.clear();
    this.mouseButtons.clear();
    this.pressedKeys.clear();
    this.pointerClicks = [];
    this.pointerDrags = [];
    this.pointerDowns.clear();
    this.chatInputFocused = false;
    this.isInitialized = false;
  }

  public isKeyDown(key: string): boolean {
    return this.keys.get(key.toLowerCase()) ?? false;
  }

  /**
   * Checks whether chat input is currently focused.
   */
  public isChatInputFocused(): boolean {
    return this.chatInputFocused;
  }

  public consumeKeyPress(key: string): boolean {
    if (this.chatInputFocused) {
      return false;
    }

    const normalized = key.toLowerCase();
    if (!this.pressedKeys.has(normalized)) {
      return false;
    }
    this.pressedKeys.delete(normalized);
    return true;
  }

  public consumePointerClick(button?: number): PointerClick | undefined {
    if (this.pointerClicks.length === 0) {
      return undefined;
    }

    if (button === undefined) {
      return this.pointerClicks.shift();
    }

    const index = this.pointerClicks.findIndex((click) => click.button === button);
    if (index === -1) {
      return undefined;
    }

    const [click] = this.pointerClicks.splice(index, 1);
    return click;
  }

  public consumeAllPointerClicks(): PointerClick[] {
    if (this.pointerClicks.length === 0) {
      return [];
    }

    const clicks = [...this.pointerClicks];
    this.pointerClicks = [];
    return clicks;
  }

  public consumePointerDrag(button?: number): PointerDrag | undefined {
    if (this.pointerDrags.length === 0) {
      return undefined;
    }

    if (button === undefined) {
      return this.pointerDrags.shift();
    }

    const index = this.pointerDrags.findIndex((drag) => drag.button === button);
    if (index === -1) {
      return undefined;
    }

    const [drag] = this.pointerDrags.splice(index, 1);
    return drag;
  }

  public consumeAllPointerDrags(): PointerDrag[] {
    if (this.pointerDrags.length === 0) {
      return [];
    }

    const drags = [...this.pointerDrags];
    this.pointerDrags = [];
    return drags;
  }

  /**
   * Checks if a mouse button is currently held down.
   * @param button - 0 = left, 1 = middle, 2 = right
   */
  public isMouseButtonDown(button: number): boolean {
    return this.mouseButtons.get(button) ?? false;
  }

  /**
   * Checks if the right mouse button is held down.
   */
  public isRightMouseDown(): boolean {
    return this.isMouseButtonDown(2);
  }

  /**
   * Checks if the sprint key is currently held down.
   */
  public isSprinting(): boolean {
    return this.isKeyDown('shift');
  }

  public getMovementDirection(): Vector3 {
    // Don't process movement if chat is focused
    if (this.chatInputFocused) {
      return Vector3.Zero();
    }

    let x = 0;
    let z = 0;

    // WASD movement only to avoid camera key conflicts
    if (this.isKeyDown('w')) {
      z += 1;
    }
    if (this.isKeyDown('s')) {
      z -= 1;
    }
    if (this.isKeyDown('d')) {
      x -= 1;
    }
    if (this.isKeyDown('a')) {
      x += 1;
    }

    const direction = new Vector3(x, 0, z);

    // Normalize diagonal movement
    if (direction.length() > 0) {
      direction.normalize();
    }

    return direction;
  }
}
