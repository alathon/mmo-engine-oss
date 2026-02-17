// Shared game constants
// Configuration values used by both server and client

// Timing
export const TICK_RATE = 20; // Server updates per second
export const TICK_MS = 1000 / TICK_RATE; // Milliseconds per tick (50ms)
export const PATCH_RATE = 50; // State patches per second (ms between patches)

// Event log
export const DEFAULT_EVENT_RANGE = 10;
