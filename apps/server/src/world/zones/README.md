# Zones (Server)

## Line of Sight Tracker
- `LineOfSightTracker` (`line-of-sight-tracker.ts`) computes per-player visibility to nearby mobs.
- It builds a spatial hash of all players/NPCs each tick and only updates a subset of players per tick (staggered).
- A player is re-evaluated when they move past a small threshold or the cached result gets stale.
- Targets are limited to a **max range** based on the largest ability range in `ABILITY_DEFINITIONS`.
- The tracker writes the sorted result into `PlayerState.visibleTargets`.

### How It’s Used
- Combat validation uses `hasLineOfSight(...)` directly for authoritative checks.
- Clients use the synced `visibleTargets` list for instant UI feedback and input gating.

### Tuning
If LoS costs get high, tune these constants in `line-of-sight-tracker.ts`:
- `LOS_CELL_SIZE` (spatial hash size)
- `LOS_UPDATE_STRIDE` (how many ticks to spread updates across)
- `LOS_MOVE_THRESHOLD` (movement required to recompute)
- `LOS_MAX_STALE_TICKS` (force refresh after this many ticks)
