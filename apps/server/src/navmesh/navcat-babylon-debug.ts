import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type {
  ArrayLike,
  CompactHeightfield,
  ContourSet,
  DebugBoxes,
  DebugLines,
  DebugPoints,
  DebugPrimitive,
  DebugTriangles,
  Heightfield,
  NavMesh,
  NavMeshTile,
  NodeRef,
  PolyMesh,
  PolyMeshDetail,
  SearchNodePool,
} from "navcat";
import * as NavCat from "navcat";
import { DebugPrimitiveType } from "navcat";

export interface DebugObject {
  node: TransformNode;
  dispose: () => void;
}

/**
 * Converts a single debug primitive to a Babylon.js mesh.
 */
const primitiveToBabylonJS = (
  primitive: DebugPrimitive,
  scene: Scene,
): { node: TransformNode; dispose: () => void } => {
  const disposables: (() => void)[] = [];

  switch (primitive.type) {
    case DebugPrimitiveType.Triangles: {
      const triPrimitive = primitive as DebugTriangles;
      const mesh = new Mesh("navcat_debug_triangles", scene);

      const vertexData = new VertexData();
      vertexData.positions = [...triPrimitive.positions];

      if (triPrimitive.indices && triPrimitive.indices.length > 0) {
        vertexData.indices = [...triPrimitive.indices];
      }

      // Convert RGB colors to RGBA Color4 array for Babylon.js
      const colors: number[] = [];
      const alpha = triPrimitive.opacity ?? 1;
      for (let index = 0; index < triPrimitive.colors.length; index += 3) {
        colors.push(
          triPrimitive.colors[index],
          triPrimitive.colors[index + 1],
          triPrimitive.colors[index + 2],
          alpha,
        );
      }
      vertexData.colors = colors;

      // Compute normals for proper lighting (optional, helps with visibility)
      vertexData.normals = [];
      VertexData.ComputeNormals(vertexData.positions, vertexData.indices ?? [], vertexData.normals);

      vertexData.applyToMesh(mesh);

      const material = new StandardMaterial("navcat_debug_tri_mat", scene);
      material.emissiveColor = new Color3(0.5, 0.5, 0.5);
      material.disableLighting = true;

      if (triPrimitive.transparent) {
        material.alpha = triPrimitive.opacity ?? 1;
        material.transparencyMode = 2; // ALPHABLEND
      }

      if (triPrimitive.doubleSided) {
        material.backFaceCulling = false;
      }

      mesh.material = material;

      disposables.push(() => {
        mesh.dispose();
        material.dispose();
      });

      return {
        node: mesh,
        dispose: () => {
          for (const dispose of disposables) {
            dispose();
          }
        },
      };
    }

    case DebugPrimitiveType.Lines: {
      const linePrimitive = primitive as DebugLines;
      const numberLines = linePrimitive.positions.length / 6; // 2 points per line, 3 coords per point
      const lines: Vector3[][] = [];
      const lineColors: Color4[][] = [];
      const alpha = linePrimitive.opacity ?? 1;

      for (let index = 0; index < numberLines; index++) {
        const baseIndex = index * 6;
        const colorBaseIndex = index * 6; // 2 colors per line segment

        const p1 = new Vector3(
          linePrimitive.positions[baseIndex],
          linePrimitive.positions[baseIndex + 1],
          linePrimitive.positions[baseIndex + 2],
        );
        const p2 = new Vector3(
          linePrimitive.positions[baseIndex + 3],
          linePrimitive.positions[baseIndex + 4],
          linePrimitive.positions[baseIndex + 5],
        );

        const c1 = new Color4(
          linePrimitive.colors[colorBaseIndex],
          linePrimitive.colors[colorBaseIndex + 1],
          linePrimitive.colors[colorBaseIndex + 2],
          alpha,
        );
        const c2 = new Color4(
          linePrimitive.colors[colorBaseIndex + 3],
          linePrimitive.colors[colorBaseIndex + 4],
          linePrimitive.colors[colorBaseIndex + 5],
          alpha,
        );

        lines.push([p1, p2]);
        lineColors.push([c1, c2]);
      }

      const lineSystem = MeshBuilder.CreateLineSystem(
        "navcat_debug_lines",
        {
          lines,
          colors: lineColors,
        },
        scene,
      );

      if (linePrimitive.transparent) {
        lineSystem.alpha = linePrimitive.opacity ?? 1;
      }

      disposables.push(() => {
        lineSystem.dispose();
      });

      return {
        node: lineSystem,
        dispose: () => {
          for (const dispose of disposables) {
            dispose();
          }
        },
      };
    }

    case DebugPrimitiveType.Points: {
      const pointPrimitive = primitive as DebugPoints;
      const parent = new TransformNode("navcat_debug_points", scene);
      const numberPoints = pointPrimitive.positions.length / 3;
      const baseSize = pointPrimitive.size ?? 0.1;
      const alpha = pointPrimitive.opacity ?? 1;

      if (numberPoints > 0) {
        // Create spheres for each point
        // For better performance with many points, use thin instances
        const sphereTemplate = MeshBuilder.CreateSphere(
          "navcat_point_template",
          { diameter: baseSize * 2, segments: 6 },
          scene,
        );
        sphereTemplate.isVisible = false;

        // Register color as an instanced buffer for per-instance colors
        sphereTemplate.registerInstancedBuffer("color", 4);

        const matrixData: number[] = [];
        const colorData: number[] = [];

        for (let index = 0; index < numberPoints; index++) {
          const x = pointPrimitive.positions[index * 3];
          const y = pointPrimitive.positions[index * 3 + 1];
          const z = pointPrimitive.positions[index * 3 + 2];

          const matrix = Matrix.Translation(x, y, z);
          matrixData.push(...matrix.toArray());

          colorData.push(
            pointPrimitive.colors[index * 3],
            pointPrimitive.colors[index * 3 + 1],
            pointPrimitive.colors[index * 3 + 2],
            alpha,
          );
        }

        // Use thin instances for performance
        sphereTemplate.thinInstanceSetBuffer("matrix", new Float32Array(matrixData), 16);
        sphereTemplate.thinInstanceSetBuffer("color", new Float32Array(colorData), 4);

        const material = new StandardMaterial("navcat_point_mat", scene);
        material.emissiveColor = new Color3(0.3, 0.3, 0.3);
        material.disableLighting = true;

        if (pointPrimitive.transparent) {
          material.alpha = alpha;
          material.transparencyMode = 2;
        }

        sphereTemplate.material = material;
        sphereTemplate.isVisible = true;
        sphereTemplate.parent = parent;

        disposables.push(() => {
          sphereTemplate.dispose();
          material.dispose();
        });
      }

      disposables.push(() => {
        parent.dispose();
      });

      return {
        node: parent,
        dispose: () => {
          for (const dispose of disposables) {
            dispose();
          }
        },
      };
    }

    case DebugPrimitiveType.Boxes: {
      const boxPrimitive = primitive as DebugBoxes;
      const parent = new TransformNode("navcat_debug_boxes", scene);
      const numberBoxes = boxPrimitive.positions.length / 3;
      const alpha = boxPrimitive.opacity ?? 1;

      if (numberBoxes > 0) {
        // Create box template for thin instances
        const boxTemplate = MeshBuilder.CreateBox("navcat_box_template", { size: 1 }, scene);
        boxTemplate.isVisible = false;

        // Register color as an instanced buffer for per-instance colors
        boxTemplate.registerInstancedBuffer("color", 4);

        const matrixData: number[] = [];
        const colorData: number[] = [];

        for (let index = 0; index < numberBoxes; index++) {
          const x = boxPrimitive.positions[index * 3];
          const y = boxPrimitive.positions[index * 3 + 1];
          const z = boxPrimitive.positions[index * 3 + 2];

          const scaleX = boxPrimitive.scales ? boxPrimitive.scales[index * 3] : 1;
          const scaleY = boxPrimitive.scales ? boxPrimitive.scales[index * 3 + 1] : 1;
          const scaleZ = boxPrimitive.scales ? boxPrimitive.scales[index * 3 + 2] : 1;

          const matrix = Matrix.Compose(
            new Vector3(scaleX, scaleY, scaleZ),
            Quaternion.Identity(),
            new Vector3(x, y, z),
          );
          matrixData.push(...matrix.toArray());

          colorData.push(
            boxPrimitive.colors[index * 3],
            boxPrimitive.colors[index * 3 + 1],
            boxPrimitive.colors[index * 3 + 2],
            alpha,
          );
        }

        // Use thin instances for performance
        boxTemplate.thinInstanceSetBuffer("matrix", new Float32Array(matrixData), 16);
        boxTemplate.thinInstanceSetBuffer("color", new Float32Array(colorData), 4);

        const material = new StandardMaterial("navcat_box_mat", scene);
        material.emissiveColor = new Color3(0.3, 0.3, 0.3);
        material.disableLighting = true;

        if (boxPrimitive.transparent) {
          material.alpha = alpha;
          material.transparencyMode = 2;
        }

        boxTemplate.material = material;
        boxTemplate.isVisible = true;
        boxTemplate.parent = parent;

        disposables.push(() => {
          boxTemplate.dispose();
          material.dispose();
        });
      }

      disposables.push(() => {
        parent.dispose();
      });

      return {
        node: parent,
        dispose: () => {
          for (const dispose of disposables) {
            dispose();
          }
        },
      };
    }

    default: {
      const exhaustiveCheck: never = primitive;
      console.warn("Unknown debug primitive type:", (exhaustiveCheck as DebugPrimitive).type);
      return {
        node: new TransformNode("navcat_debug_unknown", scene),
        dispose: () => {},
      };
    }
  }
};

/**
 * Converts an array of debug primitives to a Babylon.js TransformNode group.
 */
function primitivesToBabylonJS(primitives: DebugPrimitive[], scene: Scene): DebugObject {
  const parent = new TransformNode("navcat_debug_group", scene);
  const disposables: (() => void)[] = [];

  for (const primitive of primitives) {
    const { node, dispose } = primitiveToBabylonJS(primitive, scene);
    node.parent = parent;
    disposables.push(dispose);
  }

  return {
    node: parent,
    dispose: () => {
      for (const dispose of disposables) {
        dispose();
      }
      parent.dispose();
    },
  };
}

export const createTriangleAreaIdsHelper = (
  input: { positions: ArrayLike<number>; indices: ArrayLike<number> },
  triAreaIds: ArrayLike<number>,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createTriangleAreaIdsHelper(input, triAreaIds);
  return primitivesToBabylonJS(primitives, scene);
};

export const createHeightfieldHelper = (heightfield: Heightfield, scene: Scene): DebugObject => {
  const primitives = NavCat.createHeightfieldHelper(heightfield);
  return primitivesToBabylonJS(primitives, scene);
};

export const createCompactHeightfieldSolidHelper = (
  compactHeightfield: CompactHeightfield,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createCompactHeightfieldSolidHelper(compactHeightfield);
  return primitivesToBabylonJS(primitives, scene);
};

export const createCompactHeightfieldDistancesHelper = (
  compactHeightfield: CompactHeightfield,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createCompactHeightfieldDistancesHelper(compactHeightfield);
  return primitivesToBabylonJS(primitives, scene);
};

export const createCompactHeightfieldRegionsHelper = (
  compactHeightfield: CompactHeightfield,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createCompactHeightfieldRegionsHelper(compactHeightfield);
  return primitivesToBabylonJS(primitives, scene);
};

export const createRawContoursHelper = (contourSet: ContourSet, scene: Scene): DebugObject => {
  const primitives = NavCat.createRawContoursHelper(contourSet);
  return primitivesToBabylonJS(primitives, scene);
};

export const createSimplifiedContoursHelper = (
  contourSet: ContourSet,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createSimplifiedContoursHelper(contourSet);
  return primitivesToBabylonJS(primitives, scene);
};

export const createPolyMeshHelper = (polyMesh: PolyMesh, scene: Scene): DebugObject => {
  const primitives = NavCat.createPolyMeshHelper(polyMesh);
  return primitivesToBabylonJS(primitives, scene);
};

export const createPolyMeshDetailHelper = (
  polyMeshDetail: PolyMeshDetail,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createPolyMeshDetailHelper(polyMeshDetail);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshHelper = (navMesh: NavMesh, scene: Scene): DebugObject => {
  const primitives = NavCat.createNavMeshHelper(navMesh);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshTileHelper = (tile: NavMeshTile, scene: Scene): DebugObject => {
  const primitives = NavCat.createNavMeshTileHelper(tile);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshPolyHelper = (
  navMesh: NavMesh,
  nodeReference: NodeRef,
  scene: Scene,
  color: [number, number, number] = [0, 0.75, 1],
): DebugObject => {
  const primitives = NavCat.createNavMeshPolyHelper(navMesh, nodeReference, color);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshTileBvTreeHelper = (
  navMeshTile: NavMeshTile,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createNavMeshTileBvTreeHelper(navMeshTile);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshLinksHelper = (navMesh: NavMesh, scene: Scene): DebugObject => {
  const primitives = NavCat.createNavMeshLinksHelper(navMesh);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshBvTreeHelper = (navMesh: NavMesh, scene: Scene): DebugObject => {
  const primitives = NavCat.createNavMeshBvTreeHelper(navMesh);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshTilePortalsHelper = (
  navMeshTile: NavMeshTile,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createNavMeshTilePortalsHelper(navMeshTile);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshPortalsHelper = (navMesh: NavMesh, scene: Scene): DebugObject => {
  const primitives = NavCat.createNavMeshPortalsHelper(navMesh);
  return primitivesToBabylonJS(primitives, scene);
};

export const createSearchNodesHelper = (nodePool: SearchNodePool, scene: Scene): DebugObject => {
  const primitives = NavCat.createSearchNodesHelper(nodePool);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshOffMeshConnectionsHelper = (
  navMesh: NavMesh,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createNavMeshOffMeshConnectionsHelper(navMesh);
  return primitivesToBabylonJS(primitives, scene);
};
