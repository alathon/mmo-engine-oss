import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { ObjState } from '@mmo/shared';
import { ObjEntity } from '../entities/obj-entity';
import type { ZoneConnectionManager } from '../network/zone-connection-manager';
import type { UiLayer } from '../ui/ui-layer';

/**
 * Maintains client-side object entities synced from the server.
 */
export class ObjManager {
  private objects = new Map<string, ObjEntity>();
  private scene?: Scene;
  constructor(
    private zoneNetwork: ZoneConnectionManager,
    private uiLayer: UiLayer
  ) {}

  bindEvents(scene: Scene): void {
    this.scene = scene;

    this.zoneNetwork.onObjectAdded((objectId, object) => {
      if (!this.scene) return;
      this.addObject(this.scene, objectId, object);
    });

    this.zoneNetwork.onObjectUpdated((objectId, object) => {
      this.updateObject(objectId, object);
    });

    this.zoneNetwork.onObjectRemoved((objectId) => {
      this.removeObject(objectId);
    });

    this.zoneNetwork.onDisconnected(() => {
      this.reset();
    });
  }

  /**
   * Creates and stores a new object entity.
   *
   * @param scene - Babylon.js scene to attach meshes to.
   * @param objectId - object identifier from the server.
   * @param object - object state from the server.
   * @returns created ObjEntity instance.
   */
  addObject(scene: Scene, objectId: string, object: ObjState): ObjEntity {
    console.debug('ObjManager add', { objectId });
    const entity = new ObjEntity(scene, {
      id: objectId,
      x: object.x,
      y: object.y,
      z: object.z,
      shape: object.shape as 'box' | 'sphere' | 'cylinder',
      size: object.size,
      isPickable: object.pickable,
      isCollidable: object.collidable,
      label: object.label || undefined,
      color: new Color3(object.colorR, object.colorG, object.colorB),
      uiLayer: this.uiLayer,
    });

    this.objects.set(objectId, entity);
    return entity;
  }

  /**
   * Applies updates to an existing object entity.
   *
   * @param objectId - object identifier to update.
   * @param object - latest object state from the server.
   */
  updateObject(objectId: string, object: ObjState): void {
    const entity = this.objects.get(objectId);
    if (!entity) return;

    console.debug('ObjManager update', { objectId });
    entity.position.x = object.x;
    entity.position.y = object.y;
    entity.position.z = object.z;
    if (object.label) {
      entity.setLabel(object.label);
    }
  }

  /**
   * Removes and disposes an object entity.
   *
   * @param objectId - object identifier to remove.
   */
  removeObject(objectId: string): void {
    const entity = this.objects.get(objectId);
    if (!entity) return;

    console.debug('ObjManager remove', { objectId });
    entity.dispose();
    this.objects.delete(objectId);
  }

  /**
   * Disposes all object entities and clears local state.
   */
  reset(): void {
    for (const entity of this.objects.values()) entity.dispose();
    this.objects.clear();
  }
}
