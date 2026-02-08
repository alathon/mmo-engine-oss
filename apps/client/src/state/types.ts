/**
 * State interface for client-side game flow.
 */
export interface ClientState {
  /**
   * Enter the state and initialize any UI or resources.
   */
  enter(): Promise<void> | void;
  /**
   * Exit the state and clean up resources.
   */
  exit(): Promise<void> | void;
  /**
   * Per-frame update callback.
   *
   * @param deltaTimeMs - elapsed time in milliseconds.
   */
  update?(deltaTimeMs: number): void;
}
