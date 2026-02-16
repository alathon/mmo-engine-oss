# Combat (Client)

## Line of Sight (LoS)
- The server computes LoS and syncs `PlayerState.visibleTargets` to each client.
- The client uses this list for immediate UI feedback and gating.

### Where It’s Checked
- `gameWorld.ts` uses `visibleTargets` when building `AbilityUseContext` for targeted abilities.
- `targetingController.ts` uses it to tint the target indicator:
  - Bright red when in LoS.
  - Dark grey when out of LoS.

### Pattern for New UI/Logic
If you need a quick LoS check on the client:
- Use `localPlayer.sync.visibleTargets.includes(targetId)` for the local player.
- Treat the list as **advisory** (the server is authoritative).

## Ground Reticle Tuning
Ground-targeting projection thresholds are in `ground-targeting-controller.ts`:
- `PREVIEW_SAMPLE_STEP`: Base spacing between projected samples.
- `PREVIEW_MIN_SAMPLE_STEP`: Lowest spacing adaptive refinement can reach.
- `PREVIEW_REFINE_MULTIPLIER`: Scale applied each refinement pass.
- `PREVIEW_MAX_REFINE_STEPS`: Max refinement passes per targeting session.
- `PREVIEW_REFINE_STEEP_EDGE_RATIO`: Slope ratio (`dy / horizontalDistance`) that counts as steep.
- `PREVIEW_REFINE_EDGE_FRACTION`: Fraction of steep/problem edges required to trigger refinement.
- `PREVIEW_SURFACE_OFFSET`: Offset along surface normal to keep reticle above geometry.
- `PREVIEW_DEPTH_BIAS`: Material depth bias to reduce z-fighting.

Runtime debug readout while targeting:
- `step`: current sample spacing.
- `refine`: number of refinement passes applied.
- `miss`: raw projection misses before repair.
- `unresolved`: misses remaining after neighbor + midpoint repairs.
- `steep`: fraction of edges considered steep/problematic.
