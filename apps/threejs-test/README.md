# ThreeJS Navmesh Test

This is a focused Three.js playground for validating heightmap-based terrain against `navcat` navmesh generation. It renders a high‑resolution terrain mesh from a heightmap and generates a navmesh from a lower‑resolution version of the same terrain, optionally including simple obstacle meshes.

**What It Does**
- Loads `assets/testzone.zone.json` and `assets/heightmap.png`.
- Builds a high‑resolution ground mesh that matches the heightmap pixel grid.
- Builds a lower‑resolution ground mesh for navmesh input using the same heightmap sampling.
- Generates a navmesh via `navcat` and overlays the helper geometry.
- Adds simple obstacle meshes positioned on the heightmap surface.
- Provides in‑scene controls to toggle the ground mesh, navmesh, vertices, and wireframe.

**How It Works**
- `src/main.ts` loads the heightmap and reads pixels via a temporary canvas.
- A plane is created for visuals at full heightmap resolution.
- A second plane is created for navmesh input at a reduced resolution.
- Both planes are displaced by sampling heightmap luminance at each vertex UV.
- `navcat/three` collects positions and indices and feeds them into `generateSoloNavMesh`.
- A navmesh helper is rendered slightly above the ground for visibility.

**Generation Choices**
- Visual mesh resolution matches the heightmap dimensions to preserve fidelity.
- Navmesh input mesh is intentionally downsampled to reduce polygon count.
- Height sampling uses nearest‑pixel luminance (`RGB -> luminance -> height`).
- Obstacles are simple primitives placed at sampled ground height.
- The navmesh input includes the low‑res ground and obstacle meshes.

**Controls**
- Arrow keys: Move camera.
- Mouse drag: Rotate camera.
- `N`: Toggle navmesh overlay.
- `V`: Toggle vertex dots (navmesh input vertices).
- `T`: Toggle wireframe (navmesh input mesh).
- “Toggle Ground Mesh” button: Hide/show the high‑res visual mesh.

**Run It**
1. `pnpm install`
2. `pnpm --filter @mmo/threejs-test dev`
3. Visit `http://localhost:5555`

**Tuning**
- Adjust navmesh input density via `navmeshSubdivisionScale` in `src/main.ts`.
- Update heightmap range in `assets/testzone.zone.json` (`minHeight` / `maxHeight`).
