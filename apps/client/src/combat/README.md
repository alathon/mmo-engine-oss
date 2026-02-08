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
