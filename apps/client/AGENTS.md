# AGENTS.md

Read the [main AGENTS.md](../../AGENTS.md) file for general guidelines.

## Client (Babylon.js) Guidelines
- Use Babylon.js best practices for resource management.
- Favor WebGPU with WebGL fallback.
- Use instancing, LOD, culling, and frozen meshes/materials where appropriate.
- Use AssetsManager/SceneLoader; avoid runtime allocations in the hot path.

## Render
- Render build: pnpm --filter "@mmo/client..." run build:render
