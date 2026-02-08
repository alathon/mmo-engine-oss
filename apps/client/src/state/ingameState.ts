import type { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { ClientState } from "./types";
import { GameWorld } from "../game/gameWorld";
import { createIngameServices } from "../services/ingameServices";
import type { CoreServices } from "../services/coreServices";
import type { ReactUiRoot } from "../ui/reactUiRoot";

/**
 * In-game state that owns the world simulation.
 */
export class IngameState implements ClientState {
  private world?: GameWorld;
  /**
   * Creates an in-game state.
   *
   * @param scene - Babylon.js scene shared by the app.
   */
  constructor(
    private scene: Scene,
    private coreServices: CoreServices,
    private reactUiRoot: ReactUiRoot,
  ) {}

  /**
   * Enters the in-game state and initializes the world.
   */
  async enter(): Promise<void> {
    const camera = this.scene.activeCamera;
    if (!camera || !(camera instanceof ArcRotateCamera)) {
      throw new Error("ArcRotateCamera not found for in-game state");
    }

    const services = createIngameServices(this.scene);
    this.reactUiRoot.mountIngame({
      chatViewModel: services.chatViewModel,
      connectionStatusViewModel: services.connectionStatusViewModel,
      hotbarViewModel: services.hotbarViewModel,
    });
    services.ui.attachChatViewModel(services.chatViewModel);
    this.world = new GameWorld(services, this.coreServices.session);
    services.zoneNetwork.refreshStatus();

    const loginResponse = this.coreServices.session.loginResponse;
    if (!loginResponse) {
      throw new Error("Login response missing in client session");
    }

    await this.world.initialize({
      scene: this.scene,
      camera,
      loginResponse,
    });
    console.debug("Entering world with character", {
      characterId: this.coreServices.session.characterId,
    });
  }

  /**
   * Exits the in-game state and disposes the world.
   */
  exit(): void {
    this.world?.dispose();
    this.world = undefined;
    this.reactUiRoot.unmountIngame();
  }

  /**
   * Updates world simulation.
   *
   * @param deltaTimeMs - elapsed time in milliseconds.
   */
  update(deltaTimeMs: number): void {
    this.world?.update(deltaTimeMs);
  }
}
