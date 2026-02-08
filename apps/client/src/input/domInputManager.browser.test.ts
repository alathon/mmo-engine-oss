import { describe, expect, it } from "vitest";
import { Scene } from "@babylonjs/core/scene";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import {
  KeyboardEventTypes,
  type KeyboardInfo,
} from "@babylonjs/core/Events/keyboardEvents";
import {
  PointerEventTypes,
  type PointerInfo,
} from "@babylonjs/core/Events/pointerEvents";
import { DomInputManager } from "./domInputManager";

const notifyKey = (scene: Scene, type: KeyboardEventTypes, key: string) => {
  const eventType = type === KeyboardEventTypes.KEYUP ? "keyup" : "keydown";
  const event = new KeyboardEvent(eventType, { key });
  const info = { type: type as number, event } as KeyboardInfo;
  scene.onKeyboardObservable.notifyObservers(info);
};

const notifyPointer = (
  scene: Scene,
  type: PointerEventTypes,
  button: number,
  options?: {
    clientX?: number;
    clientY?: number;
    x?: number;
    y?: number;
  },
) => {
  let eventType = "pointerdown";
  if (type === PointerEventTypes.POINTERUP) {
    eventType = "pointerup";
  } else if (type === PointerEventTypes.POINTERMOVE) {
    eventType = "pointermove";
  }
  const event = new PointerEvent(eventType, {
    button,
    clientX: options?.clientX ?? 0,
    clientY: options?.clientY ?? 0,
  });
  (scene as unknown as { pointerX: number }).pointerX =
    options?.x ?? options?.clientX ?? 0;
  (scene as unknown as { pointerY: number }).pointerY =
    options?.y ?? options?.clientY ?? 0;
  const info = { type, event } as unknown as PointerInfo;
  scene.onPointerObservable.notifyObservers(info);
};

describe("DomInputManager", () => {
  it("tracks keyboard and mouse input", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const inputEl = document.createElement("input");
    inputEl.id = "chat-input";
    document.body.appendChild(inputEl);

    const manager = new DomInputManager();
    manager.initialize(scene);

    notifyKey(scene, KeyboardEventTypes.KEYDOWN, "w");
    let direction = manager.getMovementDirection();
    expect(direction.z).toBe(1);
    expect(direction.x).toBe(0);

    notifyKey(scene, KeyboardEventTypes.KEYUP, "w");
    direction = manager.getMovementDirection();
    expect(direction.length()).toBe(0);

    notifyPointer(scene, PointerEventTypes.POINTERDOWN, 2);
    expect(manager.isRightMouseDown()).toBe(true);

    notifyPointer(scene, PointerEventTypes.POINTERUP, 2);
    expect(manager.isRightMouseDown()).toBe(false);

    manager.dispose();
    scene.dispose();
    engine.dispose();
    inputEl.remove();
  });

  it("queues click on pointer up when within drag threshold", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const inputEl = document.createElement("input");
    inputEl.id = "chat-input";
    document.body.appendChild(inputEl);

    const manager = new DomInputManager();
    manager.initialize(scene);

    notifyPointer(scene, PointerEventTypes.POINTERDOWN, 0, {
      clientX: 10,
      clientY: 10,
    });
    notifyPointer(scene, PointerEventTypes.POINTERUP, 0, {
      clientX: 12,
      clientY: 12,
    });

    const click = manager.consumePointerClick(0);
    expect(click).toBeDefined();
    expect(click?.button).toBe(0);

    manager.dispose();
    scene.dispose();
    engine.dispose();
    inputEl.remove();
  });

  it("skips click on pointer up when drag exceeds threshold", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const inputEl = document.createElement("input");
    inputEl.id = "chat-input";
    document.body.appendChild(inputEl);

    const manager = new DomInputManager();
    manager.initialize(scene);

    notifyPointer(scene, PointerEventTypes.POINTERDOWN, 0, {
      clientX: 10,
      clientY: 10,
    });
    notifyPointer(scene, PointerEventTypes.POINTERUP, 0, {
      clientX: 40,
      clientY: 10,
    });

    const click = manager.consumePointerClick(0);
    expect(click).toBeUndefined();

    manager.dispose();
    scene.dispose();
    engine.dispose();
    inputEl.remove();
  });

  it("emits drag start/move/end when movement exceeds threshold", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const inputEl = document.createElement("input");
    inputEl.id = "chat-input";
    document.body.appendChild(inputEl);

    const manager = new DomInputManager();
    manager.initialize(scene);

    notifyPointer(scene, PointerEventTypes.POINTERDOWN, 0, {
      clientX: 10,
      clientY: 10,
    });
    notifyPointer(scene, PointerEventTypes.POINTERMOVE, 0, {
      clientX: 20,
      clientY: 10,
    });
    notifyPointer(scene, PointerEventTypes.POINTERMOVE, 0, {
      clientX: 24,
      clientY: 10,
    });
    notifyPointer(scene, PointerEventTypes.POINTERUP, 0, {
      clientX: 24,
      clientY: 10,
    });

    const drags = manager.consumeAllPointerDrags();
    expect(drags.map((drag) => drag.phase)).toEqual(["start", "move", "end"]);
    expect(manager.consumePointerClick(0)).toBeUndefined();

    manager.dispose();
    scene.dispose();
    engine.dispose();
    inputEl.remove();
  });

  it("blocks movement while chat input is focused", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const inputEl = document.createElement("input");
    inputEl.id = "chat-input";
    document.body.appendChild(inputEl);

    const manager = new DomInputManager();
    manager.initialize(scene);

    notifyKey(scene, KeyboardEventTypes.KEYDOWN, "w");
    inputEl.dispatchEvent(new FocusEvent("focus"));

    expect(manager.isChatInputFocused()).toBe(true);
    expect(manager.getMovementDirection().length()).toBe(0);

    inputEl.dispatchEvent(new FocusEvent("blur"));
    expect(manager.isChatInputFocused()).toBe(false);

    manager.dispose();
    scene.dispose();
    engine.dispose();
    inputEl.remove();
  });
});
