/**
 * Server movement tuning constants.
 *
 * Keep server-side movement knobs here for quick tuning.
 * Shared constants remain in packages/shared.
 */

// -- Input processing

/**
 * Maximum number of input steps the server may apply for a player in a single tick.
 * This caps catch-up work under lag so movement stays bounded to real time.
 */
export const MAX_INPUT_CATCH_UP_TICKS = 5;

/**
 * Maximum age (in ticks) for client inputs relative to the server tick.
 * Inputs older than this window are dropped to prevent time-banking bursts.
 */
export const MAX_INPUT_LAG_TICKS = 20;

/**
 * Maximum queued inputs per player. Oldest inputs are dropped when full.
 */
export const MAX_PENDING_INPUTS = 64;

// -- Player movement

// -- Server snap tuning

/**
 * Distance threshold for snapping a client when predictions diverge.
 */
export const SERVER_SNAP_DISTANCE = 3.0;

/**
 * Distance threshold for accepting a client snap acknowledgement.
 */
export const SERVER_SNAP_ACCEPT_DISTANCE = 0.25;
