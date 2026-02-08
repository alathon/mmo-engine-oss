import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
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
      vertexData.positions = Array.from(triPrimitive.positions);

      if (triPrimitive.indices && triPrimitive.indices.length > 0) {
        vertexData.indices = Array.from(triPrimitive.indices);
      }

      // Convert RGB colors to RGBA Color4 array for Babylon.js
      const colors: number[] = [];
      const alpha = triPrimitive.opacity ?? 1.0;
      for (let i = 0; i < triPrimitive.colors.length; i += 3) {
        colors.push(
          triPrimitive.colors[i],
          triPrimitive.colors[i + 1],
          triPrimitive.colors[i + 2],
          alpha,
        );
      }
      vertexData.colors = colors;

      // Compute normals for proper lighting (optional, helps with visibility)
      vertexData.normals = [];
      VertexData.ComputeNormals(
        vertexData.positions,
        vertexData.indices ?? [],
        vertexData.normals,
      );

      vertexData.applyToMesh(mesh);

      const material = new StandardMaterial("navcat_debug_tri_mat", scene);
      material.emissiveColor = new Color3(0.5, 0.5, 0.5);
      material.disableLighting = true;

      if (triPrimitive.transparent) {
        material.alpha = triPrimitive.opacity ?? 1.0;
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
      const numLines = linePrimitive.positions.length / 6; // 2 points per line, 3 coords per point
      const lines: Vector3[][] = [];
      const lineColors: Color4[][] = [];
      const alpha = linePrimitive.opacity ?? 1.0;

      for (let i = 0; i < numLines; i++) {
        const baseIdx = i * 6;
        const colorBaseIdx = i * 6; // 2 colors per line segment

        const p1 = new Vector3(
          linePrimitive.positions[baseIdx],
          linePrimitive.positions[baseIdx + 1],
          linePrimitive.positions[baseIdx + 2],
        );
        const p2 = new Vector3(
          linePrimitive.positions[baseIdx + 3],
          linePrimitive.positions[baseIdx + 4],
          linePrimitive.positions[baseIdx + 5],
        );

        const c1 = new Color4(
          linePrimitive.colors[colorBaseIdx],
          linePrimitive.colors[colorBaseIdx + 1],
          linePrimitive.colors[colorBaseIdx + 2],
          alpha,
        );
        const c2 = new Color4(
          linePrimitive.colors[colorBaseIdx + 3],
          linePrimitive.colors[colorBaseIdx + 4],
          linePrimitive.colors[colorBaseIdx + 5],
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
        lineSystem.alpha = linePrimitive.opacity ?? 1.0;
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
      const numPoints = pointPrimitive.positions.length / 3;
      const baseSize = pointPrimitive.size ?? 0.1;
      const alpha = pointPrimitive.opacity ?? 1.0;

      if (numPoints > 0) {
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

        for (let i = 0; i < numPoints; i++) {
          const x = pointPrimitive.positions[i * 3];
          const y = pointPrimitive.positions[i * 3 + 1];
          const z = pointPrimitive.positions[i * 3 + 2];

          const matrix = Matrix.Translation(x, y, z);
          matrixData.push(...matrix.toArray());

          colorData.push(
            pointPrimitive.colors[i * 3],
            pointPrimitive.colors[i * 3 + 1],
            pointPrimitive.colors[i * 3 + 2],
            alpha,
          );
        }

        // Use thin instances for performance
        sphereTemplate.thinInstanceSetBuffer(
          "matrix",
          new Float32Array(matrixData),
          16,
        );
        sphereTemplate.thinInstanceSetBuffer(
          "color",
          new Float32Array(colorData),
          4,
        );

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
      const numBoxes = boxPrimitive.positions.length / 3;
      const alpha = boxPrimitive.opacity ?? 1.0;

      if (numBoxes > 0) {
        // Create box template for thin instances
        const boxTemplate = MeshBuilder.CreateBox(
          "navcat_box_template",
          { size: 1 },
          scene,
        );
        boxTemplate.isVisible = false;

        // Register color as an instanced buffer for per-instance colors
        boxTemplate.registerInstancedBuffer("color", 4);

        const matrixData: number[] = [];
        const colorData: number[] = [];

        for (let i = 0; i < numBoxes; i++) {
          const x = boxPrimitive.positions[i * 3];
          const y = boxPrimitive.positions[i * 3 + 1];
          const z = boxPrimitive.positions[i * 3 + 2];

          const scaleX = boxPrimitive.scales ? boxPrimitive.scales[i * 3] : 1;
          const scaleY = boxPrimitive.scales
            ? boxPrimitive.scales[i * 3 + 1]
            : 1;
          const scaleZ = boxPrimitive.scales
            ? boxPrimitive.scales[i * 3 + 2]
            : 1;

          const matrix = Matrix.Compose(
            new Vector3(scaleX, scaleY, scaleZ),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            null!,
            new Vector3(x, y, z),
          );
          matrixData.push(...matrix.toArray());

          colorData.push(
            boxPrimitive.colors[i * 3],
            boxPrimitive.colors[i * 3 + 1],
            boxPrimitive.colors[i * 3 + 2],
            alpha,
          );
        }

        // Use thin instances for performance
        boxTemplate.thinInstanceSetBuffer(
          "matrix",
          new Float32Array(matrixData),
          16,
        );
        boxTemplate.thinInstanceSetBuffer(
          "color",
          new Float32Array(colorData),
          4,
        );

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
      console.warn(
        "Unknown debug primitive type:",
        (exhaustiveCheck as DebugPrimitive).type,
      );
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
function primitivesToBabylonJS(
  primitives: DebugPrimitive[],
  scene: Scene,
): DebugObject {
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

export const createHeightfieldHelper = (
  heightfield: Heightfield,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createHeightfieldHelper(heightfield);
  return primitivesToBabylonJS(primitives, scene);
};

export const createCompactHeightfieldSolidHelper = (
  compactHeightfield: CompactHeightfield,
  scene: Scene,
): DebugObject => {
  const primitives =
    NavCat.createCompactHeightfieldSolidHelper(compactHeightfield);
  return primitivesToBabylonJS(primitives, scene);
};

export const createCompactHeightfieldDistancesHelper = (
  compactHeightfield: CompactHeightfield,
  scene: Scene,
): DebugObject => {
  const primitives =
    NavCat.createCompactHeightfieldDistancesHelper(compactHeightfield);
  return primitivesToBabylonJS(primitives, scene);
};

export const createCompactHeightfieldRegionsHelper = (
  compactHeightfield: CompactHeightfield,
  scene: Scene,
): DebugObject => {
  const primitives =
    NavCat.createCompactHeightfieldRegionsHelper(compactHeightfield);
  return primitivesToBabylonJS(primitives, scene);
};

export const createRawContoursHelper = (
  contourSet: ContourSet,
  scene: Scene,
): DebugObject => {
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

export const createPolyMeshHelper = (
  polyMesh: PolyMesh,
  scene: Scene,
): DebugObject => {
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

export const createNavMeshHelper = (
  navMesh: NavMesh,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createNavMeshHelper(navMesh);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshTileHelper = (
  tile: NavMeshTile,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createNavMeshTileHelper(tile);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshPolyHelper = (
  navMesh: NavMesh,
  nodeRef: NodeRef,
  scene: Scene,
  color: [number, number, number] = [0, 0.75, 1],
): DebugObject => {
  const primitives = NavCat.createNavMeshPolyHelper(navMesh, nodeRef, color);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshTileBvTreeHelper = (
  navMeshTile: NavMeshTile,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createNavMeshTileBvTreeHelper(navMeshTile);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshLinksHelper = (
  navMesh: NavMesh,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createNavMeshLinksHelper(navMesh);
  return primitivesToBabylonJS(primitives, scene);
};

export const createNavMeshBvTreeHelper = (
  navMesh: NavMesh,
  scene: Scene,
): DebugObject => {
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

export const createNavMeshPortalsHelper = (
  navMesh: NavMesh,
  scene: Scene,
): DebugObject => {
  const primitives = NavCat.createNavMeshPortalsHelper(navMesh);
  return primitivesToBabylonJS(primitives, scene);
};

export const createSearchNodesHelper = (
  nodePool: SearchNodePool,
  scene: Scene,
): DebugObject => {
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
