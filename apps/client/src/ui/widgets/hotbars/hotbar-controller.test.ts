import { describe, expect, it } from 'vitest';
import type { InputManager } from '../../../input/input-manager';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HotbarController } from './hotbar-controller';

class StubInputManager implements InputManager {
  private pressed = new Set<string>();
  private held = new Set<string>();
  private chatFocused = false;

  initialize(_scene: unknown): void {}
  getMovementDirection(): Vector3 {
    return Vector3.Zero();
  }
  isSprinting(): boolean {
    return false;
  }
  isRightMouseDown(): boolean {
    return false;
  }
  isChatInputFocused(): boolean {
    return this.chatFocused;
  }
  isKeyDown(key: string): boolean {
    return this.held.has(key.toLowerCase());
  }
  consumeKeyPress(key: string): boolean {
    const normalized = key.toLowerCase();
    if (!this.pressed.has(normalized)) {
      return false;
    }
    this.pressed.delete(normalized);
    return true;
  }
  consumePointerClick(_button?: number): ReturnType<InputManager['consumePointerClick']> {
    return;
  }
  consumeAllPointerClicks() {
    return [];
  }
  consumePointerDrag(_button?: number): ReturnType<InputManager['consumePointerDrag']> {
    return;
  }
  consumeAllPointerDrags() {
    return [];
  }
  dispose(): void {}

  press(key: string): void {
    this.pressed.add(key.toLowerCase());
  }

  setKeyDown(key: string, isDown: boolean): void {
    const normalized = key.toLowerCase();
    if (isDown) {
      this.held.add(normalized);
    } else {
      this.held.delete(normalized);
    }
  }

  setChatFocused(focused: boolean): void {
    this.chatFocused = focused;
  }
}

describe('HotbarController', () => {
  it('fires activation callbacks for pressed keys', () => {
    const input = new StubInputManager();
    const controller = new HotbarController(input, 2);
    controller.setSlotAction(0, { type: 'ability', abilityId: 'quick_dart' });

    let activated: string | undefined;
    controller.onSlotActivated((_slot, action) => {
      if (action.type === 'ability') {
        activated = action.abilityId;
      }
    });

    input.press('1');
    controller.update();

    expect(activated).toBe('quick_dart');
  });

  it('ignores activations while chat is focused', () => {
    const input = new StubInputManager();
    const controller = new HotbarController(input, 1);
    controller.setSlotAction(0, { type: 'ability', abilityId: 'quick_dart' });

    let activated = false;
    controller.onSlotActivated(() => {
      activated = true;
    });

    input.setChatFocused(true);
    input.press('1');
    controller.update();

    expect(activated).toBe(false);
  });
});
