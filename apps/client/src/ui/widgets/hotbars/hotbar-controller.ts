import type { InputManager } from "../../../input/input-manager";

export type HotbarAction = { type: "none" } | { type: "ability"; abilityId: string };

export interface HotbarSlot {
  index: number;
  key: string;
  action: HotbarAction;
}

const DEFAULT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
export const DEFAULT_HOTBAR_SLOT_COUNT = 4;
const HOTBAR_GAP_RATIO = 0.06;
const HOTBAR_BOTTOM_OFFSET_RATIO = 0.62;
const HOTBAR_DRAG_PADDING_X = 8;
const HOTBAR_DRAG_PADDING_Y = 6;

export interface HotbarLayoutMetrics {
  slotSize: number;
  gapSize: number;
  width: number;
  height: number;
  bottomOffset: number;
  dragPaddingX: number;
  dragPaddingY: number;
}

/**
 * Computes sizing metrics used by the hotbar layout and default UI layout.
 */
export const computeHotbarLayoutMetrics = (
  viewportWidth: number,
  viewportHeight: number,
  slotCount: number = DEFAULT_HOTBAR_SLOT_COUNT,
): HotbarLayoutMetrics => {
  const vmin = Math.max(0, Math.min(viewportWidth, viewportHeight));
  const slotSize = clamp(vmin * 0.08, 44, 64);
  const gapSize = slotSize * HOTBAR_GAP_RATIO;
  const width = slotSize * slotCount + gapSize * (slotCount - 1) + HOTBAR_DRAG_PADDING_X * 2;
  const height = slotSize + HOTBAR_DRAG_PADDING_Y * 2;
  const bottomOffset = Math.max(0, slotSize * HOTBAR_BOTTOM_OFFSET_RATIO - HOTBAR_DRAG_PADDING_Y);

  return {
    slotSize,
    gapSize,
    width,
    height,
    bottomOffset,
    dragPaddingX: HOTBAR_DRAG_PADDING_X,
    dragPaddingY: HOTBAR_DRAG_PADDING_Y,
  };
};

export class HotbarController {
  private slots: HotbarSlot[] = [];
  private slotActivatedHandlers: ((slot: HotbarSlot, action: HotbarAction) => void)[] = [];

  constructor(
    private readonly input: InputManager,
    slotCount = DEFAULT_HOTBAR_SLOT_COUNT,
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
    return [...this.slots];
  }

  getSlotsRef(): readonly HotbarSlot[] {
    return this.slots;
  }

  onSlotActivated(handler: (slot: HotbarSlot, action: HotbarAction) => void): void {
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
    for (const handler of this.slotActivatedHandlers) {
      handler(slot, action);
    }
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
        for (const handler of this.slotActivatedHandlers) {
          handler(slot, action);
        }
      }
    }
  }

  dispose(): void {
    this.slotActivatedHandlers = [];
    this.slots = [];
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
