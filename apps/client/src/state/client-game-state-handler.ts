import type { ClientState } from "./types";
import type { ClientGameStateKey } from "./client-game-state";

/**
 * Handles transitions between client game states.
 */
export class ClientGameStateHandler {
  public currentStateKey?: ClientGameStateKey;

  private currentState?: ClientState;
  private isTransitioning = false;

  /**
   * Transition to a new client state.
   *
   * @param nextStateKey - identifier for the next state.
   * @param nextState - state instance to activate.
   */
  async transitionTo(nextStateKey: ClientGameStateKey, nextState: ClientState): Promise<void> {
    if (this.isTransitioning) {
      return;
    }

    this.isTransitioning = true;
    try {
      if (this.currentState) {
        await this.currentState.exit();
      }
      this.currentState = nextState;
      this.currentStateKey = nextStateKey;
      await nextState.enter();
    } finally {
      this.isTransitioning = false;
    }
  }

  /**
   * Forward per-frame updates to the active state.
   *
   * @param deltaTimeMs - elapsed time in milliseconds.
   */
  update(deltaTimeMs: number): void {
    this.currentState?.update?.(deltaTimeMs);
  }
}
