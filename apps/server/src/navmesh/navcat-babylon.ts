import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Geometry, Mesh, VertexData } from "@babylonjs/core";
import { DebugPrimitive, DebugPrimitiveType, DebugTriangles } from "navcat";

/**
 * Extracts world-space positions and indices from Babylon meshes.
 *
 * @param meshes - Babylon meshes to extract geometry from.
 * @returns tuple of positions and indices arrays.
 */

export function getPositionsAndIndices(sceneMeshes: Mesh[]): [Float32Array, Uint32Array] {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const mesh of sceneMeshes) {
    // Share vertices to reduce count
    mesh.forceSharedVertices();

    const data = mesh.getPositionData();
    const meshIndices = mesh.getIndices();
    if (!data || !meshIndices || meshIndices.length === 0) {
      console.warn(`Mesh ${mesh.name} has no geometry`);
      continue;
    }

    const worldMatrix = mesh.computeWorldMatrix(true);
    for (let index = 0; index < data.length; index += 3) {
      const position = Vector3.TransformCoordinates(
        new Vector3(data[index], data[index + 1], data[index + 2]),
        worldMatrix
      );
      positions.push(position.x, position.y, position.z);

    }

    // Reverse winding order for navcat (swap indices 1 and 2 of each triangle)
    // Recast expects counter-clockwise winding for upward-facing surfaces
    for (let index = 0; index < meshIndices.length; index += 3) {
      indices.push(
        meshIndices[index] + vertexOffset,
        meshIndices[index + 2] + vertexOffset,  // swapped
        meshIndices[index + 1] + vertexOffset   // swapped
      );
    }

    vertexOffset += data.length / 3;

  }

  return [new Float32Array(positions), new Uint32Array(indices)];
}
