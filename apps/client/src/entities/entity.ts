import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';

/** Buffer added to collision mesh dimensions. */
const COLLISION_BUFFER = 0.1;

/** Enable to visualize collision meshes for debugging. */
const DEBUG_COLLISION = true;

export interface EntityOptions {
  /** Unique identifier for this entity. */
  id: string;
  /** Initial X position. */
  x: number;
  /** Initial Z position. */
  z: number;
  /** Initial Y position (height). Defaults to 0. */
  y?: number;
  /** Main body color. */
  color: Color3;
  /** Emissive color for the body. */
  emissiveColor?: Color3;
  /** The visual model mesh (required). */
  modelMesh: Mesh;
  /** Y offset for the model mesh. Defaults to 0. */
  modelMeshOffsetY?: number;
  /** Whether this entity should have collision detection. Defaults to false. */
  hasCollision?: boolean;
}

/**
 * Base class for all game entities with a physical presence in the world.
 * Extends TransformNode to integrate with Babylon.js scene graph.
 * Both model and collision meshes are provided by the subclass.
 */
export class Entity extends TransformNode {
  protected readonly entityId: string;
  protected modelMesh: Mesh;
  protected collisionMesh?: Mesh;
  protected material: StandardMaterial;

  /**
   * Creates a new entity.
   *
   * @param name - name for the TransformNode.
   * @param scene - Babylon.js scene to attach to.
   * @param options - entity configuration options.
   */
  constructor(name: string, scene: Scene, options: EntityOptions) {
    super(name, scene);

    const {
      id,
      x,
      z,
      y = 0,
      color,
      emissiveColor,
      modelMesh,
      modelMeshOffsetY = 0,
      hasCollision = false,
    } = options;

    this.entityId = id;

    // Set transform node position
    this.position = new Vector3(x, y, z);

    // Set up model mesh
    this.modelMesh = modelMesh;
    this.modelMesh.parent = this;
    this.modelMesh.position = new Vector3(0, modelMeshOffsetY, 0);

    // Create and apply material
    this.material = new StandardMaterial(`${id}_mat`, scene);
    this.material.diffuseColor = color;
    this.material.emissiveColor = emissiveColor ?? color.scale(0.3);
    this.modelMesh.material = this.material;

    // Create collision mesh from model mesh bounding box if collision is enabled
    this.collisionMesh = hasCollision
      ? this.createCollisionMesh(id, modelMeshOffsetY, scene)
      : undefined;
  }

  /**
   * Returns the entity's current world position.
   */
  getPosition(): Vector3 {
    return this.position;
  }

  /**
   * Creates a collision mesh (box) based on the model mesh's bounding box.
   */
  private createCollisionMesh(id: string, offsetY: number, scene: Scene): Mesh {
    // Force bounding info calculation
    this.modelMesh.computeWorldMatrix(true);
    const boundingInfo = this.modelMesh.getBoundingInfo();
    const boundingBox = boundingInfo.boundingBox;

    // Get dimensions from bounding box and add buffer
    const size = boundingBox.maximumWorld.subtract(boundingBox.minimumWorld);
    const width = size.x + COLLISION_BUFFER;
    const height = size.y + COLLISION_BUFFER;
    const depth = size.z + COLLISION_BUFFER;

    // Create box collision mesh
    const collisionMesh = MeshBuilder.CreateBox(`${id}_collision`, { width, height, depth }, scene);

    // Parent to this entity and position at same offset as model
    collisionMesh.parent = this;
    collisionMesh.position = new Vector3(0, offsetY, 0);
    collisionMesh.checkCollisions = true;

    // Debug visualization
    if (DEBUG_COLLISION) {
      collisionMesh.isVisible = true;
      const debugMat = new StandardMaterial(`${id}_collision_mat`, scene);
      debugMat.diffuseColor = new Color3(0, 1, 0);
      debugMat.alpha = 0.3;
      debugMat.wireframe = true;
      collisionMesh.material = debugMat;
      // Render on top for visibility
      collisionMesh.renderingGroupId = 1;
    } else {
      collisionMesh.isVisible = false;
    }

    return collisionMesh;
  }

  /**
   * Returns the entity's unique identifier.
   */
  getId(): string {
    return this.entityId;
  }

  /**
   * Returns the visual model mesh for UI linking purposes.
   */
  getModelMesh(): Mesh {
    return this.modelMesh;
  }

  /**
   * Returns the collision mesh, or null if none exists.
   */
  getCollisionMesh(): Mesh | undefined {
    return this.collisionMesh;
  }

  update(_deltaTimeMs: number) {}

  fixedTick(_tickMs: number): void {}
}
