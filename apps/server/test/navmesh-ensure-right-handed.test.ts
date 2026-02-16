import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ensureRightHandedCCW, getPositionsAndIndices } from "../src/navmesh/navcat-babylon";

const createScene = (useRightHandedSystem: boolean): { scene: Scene; engine: NullEngine } => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = useRightHandedSystem;
  return { scene, engine };
};

const createTriangleMesh = (scene: Scene, positions: number[], indices?: number[]): Mesh => {
  const mesh = new Mesh("triangle", scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  if (indices) {
    vertexData.indices = indices;
  }
  vertexData.applyToMesh(mesh);
  return mesh;
};

const computeTriangleNormalY = (positions: Float32Array, indices: Uint32Array): number => {
  if (indices.length < 3) {
    throw new Error("Not enough indices to compute a triangle normal.");
  }

  const i0 = indices[0] * 3;
  const i1 = indices[1] * 3;
  const i2 = indices[2] * 3;

  const ax = positions[i1] - positions[i0];
  const ay = positions[i1 + 1] - positions[i0 + 1];
  const az = positions[i1 + 2] - positions[i0 + 2];

  const bx = positions[i2] - positions[i0];
  const by = positions[i2 + 1] - positions[i0 + 1];
  const bz = positions[i2 + 2] - positions[i0 + 2];

  return az * bx - ax * bz;
};

describe("ensureRightHandedCCW", () => {
  it("converts RH Babylon winding to CCW", () => {
    const { scene, engine } = createScene(true);
    try {
      const positions = [0, 0, 0, 1, 0, 0, 0, 0, 1];
      const indices = [0, 1, 2];
      const mesh = createTriangleMesh(scene, positions, indices);
      const ensured = ensureRightHandedCCW([mesh]);
      try {
        const [outPositions, outIndices] = getPositionsAndIndices(ensured.meshes);
        const normalY = computeTriangleNormalY(outPositions, outIndices);
        expect(normalY).toBeGreaterThan(0);
      } finally {
        ensured.dispose();
      }
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("fixes mirrored transforms in RH scenes", () => {
    const { scene, engine } = createScene(true);
    try {
      const positions = [0, 0, 0, 1, 0, 0, 0, 0, 1];
      const indices = [0, 1, 2];
      const mesh = createTriangleMesh(scene, positions, indices);
      mesh.scaling.z = -1;
      const ensured = ensureRightHandedCCW([mesh]);
      try {
        const [outPositions, outIndices] = getPositionsAndIndices(ensured.meshes);
        const normalY = computeTriangleNormalY(outPositions, outIndices);
        expect(normalY).toBeGreaterThan(0);
      } finally {
        ensured.dispose();
      }
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("converts LH scenes to RH CCW", () => {
    const { scene, engine } = createScene(false);
    try {
      const positions = [0, 0, 0, 1, 0, 0, 0, 0, 1];
      const indices = [0, 1, 2];
      const mesh = createTriangleMesh(scene, positions, indices);
      const ensured = ensureRightHandedCCW([mesh]);
      try {
        const [outPositions, outIndices] = getPositionsAndIndices(ensured.meshes);
        const normalY = computeTriangleNormalY(outPositions, outIndices);
        expect(normalY).toBeGreaterThan(0);
      } finally {
        ensured.dispose();
      }
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("throws on degenerate transforms", () => {
    const { scene, engine } = createScene(true);
    try {
      const positions = [0, 0, 0, 1, 0, 0, 0, 0, 1];
      const indices = [0, 2, 1];
      const mesh = createTriangleMesh(scene, positions, indices);
      mesh.scaling.x = 0;
      expect(() => ensureRightHandedCCW([mesh])).toThrow("cannot ensure RH/CCW");
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});

describe("getPositionsAndIndices", () => {
  it("generates indices for non-indexed geometry", () => {
    const { scene, engine } = createScene(true);
    try {
      const positions = [0, 0, 0, 0, 0, 1, 1, 0, 0];
      const mesh = createTriangleMesh(scene, positions);
      const ensured = ensureRightHandedCCW([mesh]);
      try {
        const [outPositions, outIndices] = getPositionsAndIndices(ensured.meshes);
        expect(outIndices.length).toBe(3);
        const normalY = computeTriangleNormalY(outPositions, outIndices);
        expect(normalY).toBeGreaterThan(0);
      } finally {
        ensured.dispose();
      }
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
