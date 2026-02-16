import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { IndicesArray } from "@babylonjs/core/types";
import { mergePositionsAndIndices } from "navcat/blocks";

/**
 * Extracts world-space positions and indices from Babylon meshes.
 *
 * @param meshes - Babylon meshes to extract geometry from.
 * @returns tuple of positions and indices arrays.
 */

export interface MeshExtractionOptions {
  /** Skip triangles whose |normal.y| is above this threshold (0..1). */
  skipTrianglesWithNormalYAbsAbove?: number;
}

const TMP_POSITION = new Vector3();

export type ObstacleFootprint =
  | {
      shape: "box";
      x: number;
      z: number;
      halfSizeX: number;
      halfSizeZ: number;
    }
  | {
      shape: "circle";
      x: number;
      z: number;
      radius: number;
    };

export interface EnsureRightHandedResult {
  meshes: Mesh[];
  dispose: () => void;
}

const getNavmeshShape = (mesh: Mesh): "box" | "circle" => {
  const metadata = mesh.metadata as { navmeshShape?: string } | undefined;
  return metadata?.navmeshShape === "box" ? "box" : "circle";
};

export const buildObstacleFootprints = (meshes: Mesh[], margin: number): ObstacleFootprint[] => {
  const footprints: ObstacleFootprint[] = [];
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo(true);
    const boundingInfo = mesh.getBoundingInfo();
    const extents = boundingInfo.boundingBox.extendSizeWorld;
    const center = boundingInfo.boundingBox.centerWorld;
    const shape = getNavmeshShape(mesh);

    if (shape === "box") {
      footprints.push({
        shape: "box",
        x: center.x,
        z: center.z,
        halfSizeX: extents.x + margin,
        halfSizeZ: extents.z + margin,
      });
      continue;
    }

    const radius = Math.max(extents.x, extents.z) + margin;
    footprints.push({ shape: "circle", x: center.x, z: center.z, radius });
  }
  return footprints;
};

export const filterIndicesByObstacleFootprints = (
  positions: Float32Array,
  indices: ArrayLike<number>,
  footprints: ObstacleFootprint[],
): ArrayLike<number> => {
  if (footprints.length === 0) {
    return indices;
  }

  const filtered: number[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    const i0 = indices[index];
    const i1 = indices[index + 1];
    const i2 = indices[index + 2];

    const p0 = i0 * 3;
    const p1 = i1 * 3;
    const p2 = i2 * 3;

    const x0 = positions[p0];
    const z0 = positions[p0 + 2];
    const x1 = positions[p1];
    const z1 = positions[p1 + 2];
    const x2 = positions[p2];
    const z2 = positions[p2 + 2];

    const cx = (x0 + x1 + x2) / 3;
    const cz = (z0 + z1 + z2) / 3;

    let blocked = false;
    for (const footprint of footprints) {
      if (footprint.shape === "box") {
        if (
          (Math.abs(x0 - footprint.x) <= footprint.halfSizeX &&
            Math.abs(z0 - footprint.z) <= footprint.halfSizeZ) ||
          (Math.abs(x1 - footprint.x) <= footprint.halfSizeX &&
            Math.abs(z1 - footprint.z) <= footprint.halfSizeZ) ||
          (Math.abs(x2 - footprint.x) <= footprint.halfSizeX &&
            Math.abs(z2 - footprint.z) <= footprint.halfSizeZ) ||
          (Math.abs(cx - footprint.x) <= footprint.halfSizeX &&
            Math.abs(cz - footprint.z) <= footprint.halfSizeZ)
        ) {
          blocked = true;
          break;
        }
        continue;
      }

      const radiusSq = footprint.radius * footprint.radius;
      const dx0 = x0 - footprint.x;
      const dz0 = z0 - footprint.z;
      const dx1 = x1 - footprint.x;
      const dz1 = z1 - footprint.z;
      const dx2 = x2 - footprint.x;
      const dz2 = z2 - footprint.z;
      const dxc = cx - footprint.x;
      const dzc = cz - footprint.z;
      if (
        dx0 * dx0 + dz0 * dz0 <= radiusSq ||
        dx1 * dx1 + dz1 * dz1 <= radiusSq ||
        dx2 * dx2 + dz2 * dz2 <= radiusSq ||
        dxc * dxc + dzc * dzc <= radiusSq
      ) {
        blocked = true;
        break;
      }
    }

    if (blocked) {
      continue;
    }

    filtered.push(i0, i1, i2);
  }

  return filtered;
};

export const ensureRightHandedCCW = (meshes: Mesh[]): EnsureRightHandedResult => {
  if (meshes.length === 0) {
    return { meshes, dispose: () => {} };
  }

  const scene = meshes[0].getScene();
  const needsMirror = scene ? !scene.useRightHandedSystem : false;

  const mirrored: Mesh[] = [];
  for (const mesh of meshes) {
    const worldMatrix = mesh.computeWorldMatrix(true);
    const determinant = worldMatrix.determinant();
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) {
      throw new Error(`Mesh ${mesh.name} has a degenerate transform; cannot ensure RH/CCW.`);
    }

    const shouldFlipWinding = determinant > 0;

    if (!needsMirror && !shouldFlipWinding) {
      mirrored.push(mesh);
      continue;
    }

    const clone = mesh.clone(`${mesh.name}_rhccw`);
    if (!clone) {
      continue;
    }

    if (mesh.metadata && !clone.metadata) {
      clone.metadata = mesh.metadata;
    }

    clone.makeGeometryUnique();

    if (needsMirror) {
      clone.bakeTransformIntoVertices(Matrix.Scaling(1, 1, -1));
    }

    if (shouldFlipWinding) {
      flipMeshWinding(clone);
    }

    clone.isVisible = false;
    clone.setEnabled(false);
    clone.computeWorldMatrix(true);
    mirrored.push(clone);
  }

  return {
    meshes: mirrored,
    dispose: () => {
      for (const mesh of mirrored) {
        if (mesh.isDisposed() || meshes.includes(mesh)) {
          continue;
        }
        mesh.dispose();
      }
    },
  };
};

const buildAscendingIndices = (vertexCount: number): number[] => {
  const indices: number[] = Array.from({ length: vertexCount });
  for (let index = 0; index < vertexCount; index += 1) {
    indices[index] = index;
  }
  return indices;
};

const flipMeshWinding = (mesh: Mesh): void => {
  const vertexCount = mesh.getTotalVertices();
  if (vertexCount === 0) {
    return;
  }

  const existingIndices = mesh.getIndices() ?? buildAscendingIndices(vertexCount);
  const flipped: IndicesArray = Array.from({ length: existingIndices.length });
  for (let index = 0; index < existingIndices.length; index += 3) {
    flipped[index] = existingIndices[index];
    flipped[index + 1] = existingIndices[index + 2];
    flipped[index + 2] = existingIndices[index + 1];
  }

  mesh.setIndices(flipped);
};

const filterIndicesByNormal = (
  positions: Float32Array,
  indices: ArrayLike<number>,
  normalThreshold: number,
): number[] => {
  const filtered: number[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    const i0 = indices[index];
    const i1 = indices[index + 1];
    const i2 = indices[index + 2];

    const p0 = i0 * 3;
    const p1 = i1 * 3;
    const p2 = i2 * 3;

    const ax = positions[p1] - positions[p0];
    const ay = positions[p1 + 1] - positions[p0 + 1];
    const az = positions[p1 + 2] - positions[p0 + 2];

    const bx = positions[p2] - positions[p0];
    const by = positions[p2 + 1] - positions[p0 + 1];
    const bz = positions[p2 + 2] - positions[p0 + 2];

    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const lenSq = nx * nx + ny * ny + nz * nz;

    if (lenSq > 0) {
      const invLen = 1 / Math.sqrt(lenSq);
      const normalYAbs = Math.abs(ny * invLen);
      if (normalYAbs >= normalThreshold) {
        continue;
      }
    }

    filtered.push(i0, i1, i2);
  }
  return filtered;
};

export function getPositionsAndIndices(
  sceneMeshes: Mesh[],
  options?: MeshExtractionOptions,
): [Float32Array, Uint32Array] {
  const toMerge: { positions: ArrayLike<number>; indices: ArrayLike<number> }[] = [];
  const normalThreshold = options?.skipTrianglesWithNormalYAbsAbove;

  for (const mesh of sceneMeshes) {
    const data = mesh.getPositionData();
    const meshIndices = mesh.getIndices() ?? undefined;
    if (!data || data.length === 0) {
      console.warn(`Mesh ${mesh.name} has no geometry`);
      continue;
    }

    const worldMatrix = mesh.computeWorldMatrix(true);
    const positions = new Float32Array(data.length);
    for (let index = 0; index < data.length; index += 3) {
      TMP_POSITION.set(data[index], data[index + 1], data[index + 2]);
      Vector3.TransformCoordinatesToRef(TMP_POSITION, worldMatrix, TMP_POSITION);
      positions[index] = TMP_POSITION.x;
      positions[index + 1] = TMP_POSITION.y;
      positions[index + 2] = TMP_POSITION.z;
    }

    let indices: ArrayLike<number> | undefined = meshIndices;
    if (!indices || indices.length === 0) {
      indices = buildAscendingIndices(data.length / 3);
    }

    const finalIndices =
      normalThreshold === undefined
        ? indices
        : filterIndicesByNormal(positions, indices, normalThreshold);

    if (finalIndices.length === 0) {
      continue;
    }

    toMerge.push({ positions, indices: finalIndices });
  }

  const [mergedPositions, mergedIndices] = mergePositionsAndIndices(toMerge);
  return [new Float32Array(mergedPositions), new Uint32Array(mergedIndices)];
}
