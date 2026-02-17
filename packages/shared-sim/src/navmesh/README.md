# Navmesh (Shared)

This module provides shared utilities for navmesh queries across client and server.

## NavcatQuery
- `navcatQuery.ts` wraps navcat’s low-level APIs with movement and sampling helpers.
- Used on the server for authoritative movement and on the client for prediction/debug.

## Line of Sight
- `lineOfSight.ts` exports `hasLineOfSight(navmesh, from, to)`.
- It raycasts across the navmesh surface and returns true when the path is unobstructed.
- Used by server combat validation and the server LoS tracker.
  - The LoS tracker caps candidate distance using the max ability range derived from `ABILITY_DEFINITIONS`.

## Notes
- LoS checks are 2D (XZ plane) and expect short ranges.
- The server is authoritative; client-side LoS uses the synced `visibleTargets` list.
