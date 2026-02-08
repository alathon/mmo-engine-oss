import type { InputManager } from "../../input/inputManager";

export type HotbarAction =
  | { type: "none" }
  | { type: "ability"; abilityId: string };

export interface HotbarSlot {
  index: number;
  key: string;
  action: HotbarAction;
}

const DEFAULT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

export class HotbarController {
  private slots: HotbarSlot[] = [];
  private slotActivatedHandlers: ((
    slot: HotbarSlot,
    action: HotbarAction,
  ) => void)[] = [];

  constructor(
    private readonly input: InputManager,
    slotCount = 4,
  ) {
    for (let i = 0; i < slotCount; i += 1) {
      const key = DEFAULT_KEYS[i] ?? "";
      this.slots.push({ index: i, key, action: { type: "none" } });
    }
  }

  setSlotAction(index: number, action: HotbarAction): void {
    const slot = this.slots[index];
    if (!slot) {
      return;
    }
    slot.action = action;
  }

  setSlotKey(index: number, key: string): void {
    const slot = this.slots[index];
    if (!slot) {
      return;
    }
    slot.key = key.toLowerCase();
  }

  getSlots(): HotbarSlot[] {
    return this.slots.slice();
  }

  getSlotsRef(): readonly HotbarSlot[] {
    return this.slots;
  }

  onSlotActivated(
    handler: (slot: HotbarSlot, action: HotbarAction) => void,
  ): void {
    this.slotActivatedHandlers.push(handler);
  }

  activateSlot(index: number): void {
    if (this.input.isChatInputFocused()) {
      return;
    }

    const slot = this.slots[index];
    if (!slot) {
      return;
    }

    const action = slot.action;
    this.slotActivatedHandlers.forEach((handler) => {
      handler(slot, action);
    });
  }

  isSlotKeyDown(index: number): boolean {
    const slot = this.slots[index];
    if (!slot?.key) {
      return false;
    }
    if (this.input.isChatInputFocused()) {
      return false;
    }
    return this.input.isKeyDown(slot.key);
  }

  update(): void {
    if (this.input.isChatInputFocused()) {
      return;
    }

    for (const slot of this.slots) {
      if (!slot.key) {
        continue;
      }
      if (this.input.consumeKeyPress(slot.key)) {
        const action = slot.action;
        this.slotActivatedHandlers.forEach((handler) => {
          handler(slot, action);
        });
      }
    }
  }

  dispose(): void {
    this.slotActivatedHandlers = [];
    this.slots = [];
  }
}
