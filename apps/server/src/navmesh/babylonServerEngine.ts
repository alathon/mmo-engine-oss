import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { logger } from "@mmo/shared-servers";

let engine: NullEngine | null = null;

/**
 * Initializes the server-side Babylon.js null engine.
 * Must be called once at server startup.
 */
export function initializeServerEngine(): void {
  if (engine) {
    return;
  }
  engine = new NullEngine();
  logger.info("Server Babylon.js null engine initialized");
}

/**
 * Returns the server-side Babylon.js null engine.
 *
 * @returns the null engine instance.
 * @throws if the engine has not been initialized.
 */
export function getServerEngine(): NullEngine {
  if (!engine) {
    throw new Error("Server engine not initialized. Call initializeServerEngine() first.");
  }
  return engine;
}
