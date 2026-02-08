import { Scene } from "@babylonjs/core/scene";
import { NPCState } from "@mmo/shared";
import { MobEntity } from "./mobEntity";
import type { UiLayer } from "../ui/uiLayer";

/**
 * NPC entity class.
 */
export class NpcEntity extends MobEntity {
  public sync: NPCState;

  /**
   * Last movement direction used for the facing indicator, in radians.
   */
  /**
   * Creates a new mobile entity.
   *
   * @param name - name for the TransformNode.
   * @param scene - Babylon.js scene to attach to.
   * @param options - mob entity configuration options.
   */
  constructor(name: string, scene: Scene, sync: NPCState, uiLayer: UiLayer) {
    // Create mesh - billboard sprite or capsule fallback
    super(name, scene, sync, uiLayer);
    this.sync = sync;
  }
}
