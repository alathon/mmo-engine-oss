# Input System

This folder contains the client-side input pipeline. The design separates raw input collection from game logic:

- `InputManager` collects raw keyboard/mouse state and queues pointer clicks.
- `InputRouter` dispatches input to `InputHandler`s in priority order.
- `InputHandler`s implement game-specific logic (targeting, UI, movement, etc.).

## Key Files

- `inputManager.ts`: interface for raw input collection (`PointerClick`, key presses, movement direction).
- `domInputManager.ts`: browser implementation that listens to Babylon.js input events.
- `inputHandler.ts`: interface for input handlers.
- `inputRouter.ts`: dispatcher that routes clicks/ticks to handlers.

## Data Flow

1. `DomInputManager` listens to Babylon `onKeyboardObservable` and `onPointerObservable`.
2. Keyboard state updates are stored in the manager.
3. Pointer clicks are queued as `PointerClick` items.
4. `InputRouter.update()` runs once per fixed tick and does two things. It calls each handler's `handleTick()` for key presses or continuous input. It also drains the click queue and sends each click to handlers by priority until one consumes it.

## InputHandler Interface

An `InputHandler` can implement any of the following:

- `priority`: higher numbers run first.
- `enabled()`: gate the handler based on game state.
- `handleTick(input)`: handle key presses or continuous input.
- `handlePointerClick(click)`: handle one click and return `true` to consume it.

## Registering a Handler

Register handlers with the router at startup (e.g. `GameWorld.initialize`).

```ts
import { InputRouter } from "../input/inputRouter";
import { UiInputHandler } from "../ui/uiInputHandler";

const router = new InputRouter(services.input);
router.registerHandler(new UiInputHandler());
router.registerHandler(myHandler);
```

Call `router.update()` from the fixed tick loop.

## Consuming Keyboard Input

Use `InputManager.consumeKeyPress(key)` for one-shot presses. This returns `true` once per key-down event.

```ts
handleTick(input: InputManager): void {
  if (!input.consumeKeyPress("tab")) {
    return;
  }

  // Do something on Tab press.
}
```

Most one-shot actions should use `consumeKeyPress`. Continuous mouse state is available via `input.isRightMouseDown()` where needed.

## Consuming Pointer Clicks

Pointer clicks are queued in `DomInputManager` and routed by `InputRouter`.

```ts
handlePointerClick(click: PointerClick): boolean {
  if (click.button !== 0) {
    return false;
  }

  // Do pick logic, return true if consumed.
  return true;
}
```

If a click is consumed, lower-priority handlers will not receive it.

## Consuming Pointer Drags

Pointer drags are queued in `DomInputManager` once the cursor moves beyond the
drag threshold while a button is held. Drags are routed before clicks.

```ts
handlePointerDrag(drag: PointerDrag): boolean {
  if (drag.button !== 0) {
    return false;
  }

  if (drag.phase === "start") {
    // Begin dragging.
  } else if (drag.phase === "move") {
    // Update drag.
  } else {
    // End drag.
  }

  return true;
}
```

## UI vs World Clicks

UI should generally have higher priority than world interaction. The default `UiInputHandler` checks whether the click is over known UI elements and consumes it to prevent world actions.

## Chat Focus

`DomInputManager` tracks whether the chat input is focused. Handlers should avoid responding to input while `input.isChatInputFocused()` is `true` unless explicitly desired.

## Adding a New Handler

1. Create a class that implements `InputHandler`.
2. Decide its `priority` and add any `enabled()` gating.
3. Register it with `InputRouter`.
4. Consume input via `handleTick()` and/or `handlePointerClick()`.

Example:

```ts
class MapPingHandler implements InputHandler {
  priority = 20;

  enabled(): boolean {
    return true;
  }

  handlePointerClick(click: PointerClick): boolean {
    if (click.button !== 2) {
      return false;
    }

    // Right-click ping logic here.
    return true;
  }
}
```

## Notes

- `PointerClick.x/y` are Babylon scene coordinates (`scene.pointerX` / `scene.pointerY`).
- `PointerClick.clientX/clientY` are DOM client coordinates.
- Handlers should keep allocations minimal inside tick loops.
