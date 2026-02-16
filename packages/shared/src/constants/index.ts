// Shared game constants
// Configuration values used by both server and client

// Timing
export const TICK_RATE = 20; // Server updates per second
export const TICK_MS = 1000 / TICK_RATE; // Milliseconds per tick (50ms)
export const PATCH_RATE = 50; // State patches per second (ms between patches)

// Combat
export const GCD_SECONDS = 2.5; // Global cooldown in seconds
export const GCD_TICKS = GCD_SECONDS * TICK_RATE; // GCD in ticks (50)
export const INTERNAL_COOLDOWN_MS = 700;
export const BUFFER_OPEN_MS = 300;
export const MAX_BUFFERED_ABILITIES = 1;

// World
export const WORLD_SIZE = 100; // World dimensions (100x100 units)
export const WORLD_HALF = WORLD_SIZE / 2; // Half world size for centering

// Movement
export const PLAYER_SPEED = 6; // Units per second
export const PLAYER_SPRINT_MULTIPLIER = 1.4; // 40% faster while sprinting
export const REMOTE_INTERPOLATION_DELAY_MS = 150;
export const REMOTE_SAMPLE_RETENTION_MS = 1000;
export const CLIENT_MOVE_BUFFER_SIZE = 32;
export const CLIENT_RECONCILE_SOFT_SNAP_DISTANCE = 0.2;
export const CLIENT_RECONCILE_DISTANCE_EPSILON = 0.001;
export const CLIENT_IDLE_SNAP_MS = 2000;
export const NAVMESH_RECOVERY_DISTANCE = 1.0;
export const NAVMESH_DEBUG_LOGS = false;

// Event log
export const DEFAULT_EVENT_RANGE = 10;
