import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Scene } from "@babylonjs/core/scene.js";

const COLLISION_INCLUDE_PATTERN = /^col_/;
const GLB_ROOT_NODE_NAME = "__root__";
const COLLISION_OCTREE_VERTEX_THRESHOLD = 10_000;
const COLLISION_OCTREE_SUBMESH_CAPACITY = 32;
const COLLISION_OCTREE_SUBMESH_MAX_DEPTH = 2;
const COLLISION_SUBDIVIDE_VERTICES_PER_BUCKET = 4_000;
const COLLISION_SUBDIVIDE_MIN_BUCKETS = 8;
const COLLISION_SUBDIVIDE_MAX_BUCKETS = 64;

interface MeshCollisionMetadata {
  collisionRole?: string;
}

export interface PostLoadProcessSceneOptions {
  meshes?: readonly AbstractMesh[];
  transformNodes?: readonly TransformNode[];
}

export interface PostLoadProcessSceneResult {
  sourceMeshes: Mesh[];
  collisionTaggedMeshes: Mesh[];
}

export const getCollisionTagFromMetadata = (
  metadata: MeshCollisionMetadata | undefined,
): boolean | undefined => {
  if (!metadata) {
    return undefined;
  }

  const role = metadata.collisionRole?.trim().toLowerCase();
  if (!role) {
    return undefined;
  }

  if (role === "collision") {
    return true;
  }

  if (role === "trigger" || role === "visual") {
    return false;
  }

  return undefined;
};

export const resolveCollisionTag = (mesh: AbstractMesh): boolean | undefined => {
  const metadata = mesh.metadata as MeshCollisionMetadata | undefined;
  const metadataTag = getCollisionTagFromMetadata(metadata);
  if (metadataTag !== undefined) {
    return metadataTag;
  }

  const normalizedName = mesh.name.trim().toLowerCase();
  if (normalizedName.length === 0) {
    return undefined;
  }

  if (COLLISION_INCLUDE_PATTERN.test(normalizedName)) {
    return true;
  }

  return undefined;
};

const rotateRootNode = (
  meshes: readonly AbstractMesh[],
  transformNodes: readonly TransformNode[],
): void => {
  const rootNode = [...transformNodes, ...meshes].find((node) => node.name === GLB_ROOT_NODE_NAME);
  rootNode?.addRotation(0, Math.PI, 0);
};

const optimizeCollisionMesh = (mesh: Mesh): void => {
  const vertexCount = mesh.getTotalVertices();
  if (vertexCount < COLLISION_OCTREE_VERTEX_THRESHOLD) {
    return;
  }

  if (mesh.subMeshes.length <= 1) {
    const subdivisionCount = Math.min(
      COLLISION_SUBDIVIDE_MAX_BUCKETS,
      Math.max(
        COLLISION_SUBDIVIDE_MIN_BUCKETS,
        Math.ceil(vertexCount / COLLISION_SUBDIVIDE_VERTICES_PER_BUCKET),
      ),
    );
    mesh.subdivide(subdivisionCount);
  }

  mesh.createOrUpdateSubmeshesOctree(
    COLLISION_OCTREE_SUBMESH_CAPACITY,
    COLLISION_OCTREE_SUBMESH_MAX_DEPTH,
  );
  mesh.useOctreeForCollisions = true;
};

export const postLoadProcessScene = (
  scene: Scene,
  options: PostLoadProcessSceneOptions = {},
): PostLoadProcessSceneResult => {
  const sourceNodes = options.meshes ?? scene.meshes;
  const transformNodes = options.transformNodes ?? scene.transformNodes;
  rotateRootNode(sourceNodes, transformNodes);

  const sourceMeshes = sourceNodes.filter(
    (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0,
  );
  const collisionTaggedMeshes = sourceMeshes.filter((mesh) => resolveCollisionTag(mesh) === true);
  const collisionMeshes = collisionTaggedMeshes.length > 0 ? collisionTaggedMeshes : sourceMeshes;
  const collisionMeshIds = new Set(collisionMeshes.map((mesh) => mesh.uniqueId));

  for (const mesh of sourceMeshes) {
    mesh.checkCollisions = collisionMeshIds.has(mesh.uniqueId);
  }

  for (const mesh of collisionMeshes) {
    optimizeCollisionMesh(mesh);
  }

  return {
    sourceMeshes,
    collisionTaggedMeshes,
  };
};
