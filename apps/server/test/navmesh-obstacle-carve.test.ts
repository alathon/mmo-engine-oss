import { describe, expect, it } from "vitest";
import {
  filterIndicesByObstacleFootprints,
  type ObstacleFootprint,
} from "../src/navmesh/navcat-babylon";

const SQUARE_POSITIONS = new Float32Array([
  0,
  0,
  0, // 0
  2,
  0,
  0, // 1
  2,
  0,
  2, // 2
  0,
  0,
  2, // 3
]);

const SQUARE_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

describe("filterIndicesByObstacleFootprints", () => {
  it("removes triangles under circle footprints", () => {
    const footprints: ObstacleFootprint[] = [
      {
        shape: "circle",
        x: 1,
        z: 1,
        radius: 1.1,
      },
    ];

    const filtered = filterIndicesByObstacleFootprints(
      SQUARE_POSITIONS,
      SQUARE_INDICES,
      footprints,
    );

    expect(filtered.length).toBe(0);
  });

  it("removes only triangles inside box footprints", () => {
    const footprints: ObstacleFootprint[] = [
      {
        shape: "box",
        x: 1.4,
        z: 0.6,
        halfSizeX: 0.4,
        halfSizeZ: 0.4,
      },
    ];

    const filtered = filterIndicesByObstacleFootprints(
      SQUARE_POSITIONS,
      SQUARE_INDICES,
      footprints,
    );

    expect(filtered.length).toBe(3);
    expect([...filtered]).toEqual([0, 2, 3]);
  });
});
