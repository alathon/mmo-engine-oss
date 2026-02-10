import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { ClientGameState } from '../state/client-game-state';
import { ClientGameStateHandler } from '../state/client-game-state-handler';
import { FullscreenUiController } from '../ui/fullscreen-ui-controller';
import { createReactUiRoot, type ReactUiRoot } from '../ui/react-ui-root';
import { LoginState } from '../state/login-state';
import { CharacterSelectState } from '../state/character-select-state';
import { IngameState } from '../state/ingame-state';
import { createCoreServices } from '../services/core-services';

/**
 * Top-level client application shell.
 */
export class ClientApp {
  private engine?: Engine;
  private scene?: Scene;
  private camera?: ArcRotateCamera;
  private uiController?: FullscreenUiController;
  private reactUiRoot?: ReactUiRoot;
  private stateHandler = new ClientGameStateHandler();
  private coreServices = createCoreServices();

  /**
   * Initializes the Babylon engine and client state flow.
   *
   * @param canvas - canvas element used for rendering.
   */
  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    if (this.engine) {
      throw new Error('ClientApp already initialized');
    }

    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });

    this.scene = new Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.scene.clearColor = new Color4(0.1, 0.1, 0.18, 1);
    this.scene.collisionsEnabled = true;

    this.camera = new ArcRotateCamera(
      'camera',
      -Math.PI / 2,
      Math.PI / 4,
      30,
      Vector3.Zero(),
      this.scene
    );

    this.camera.lowerBetaLimit = 0.3;
    this.camera.upperBetaLimit = Math.PI / 3;
    this.camera.lowerRadiusLimit = 15;
    this.camera.upperRadiusLimit = 50;

    this.camera.attachControl(canvas, true);
    this.camera.panningSensibility = 0;

    this.uiController = new FullscreenUiController(this.scene);
    this.reactUiRoot = createReactUiRoot();
    await this.transitionToLogin();

    this.engine.runRenderLoop(() => {
      try {
        const deltaTimeMs = this.engine?.getDeltaTime() ?? 0;
        this.stateHandler.update(deltaTimeMs);
        this.scene?.render();
      } catch (error) {
        console.error('Render loop error:', error);
      }
    });

    window.addEventListener('resize', () => {
      this.engine?.resize();
    });
  }

  private async transitionToLogin(): Promise<void> {
    if (!this.uiController) {
      return;
    }

    await this.stateHandler.transitionTo(
      ClientGameState.Login,
      new LoginState(this.uiController, (response) => {
        this.coreServices.session.loginResponse = response;
        void this.transitionToCharacterSelect();
      })
    );
  }

  private async transitionToCharacterSelect(): Promise<void> {
    if (!this.uiController) {
      return;
    }

    if (!this.scene || !this.camera) {
      return;
    }

    await this.stateHandler.transitionTo(
      ClientGameState.CharacterSelect,
      new CharacterSelectState(
        this.uiController,
        this.scene,
        this.camera,
        (characterId, characterName) => {
          void this.transitionToIngame(characterId, characterName);
        }
      )
    );
  }

  private async transitionToIngame(characterId: string, characterName: string): Promise<void> {
    if (!this.scene || !this.coreServices.session.loginResponse || !this.reactUiRoot) {
      return;
    }

    console.debug('Selected character', { characterId });
    this.coreServices.session.characterId = characterId;
    this.coreServices.session.characterName = characterName;
    await this.stateHandler.transitionTo(
      ClientGameState.Ingame,
      new IngameState(this.scene, this.coreServices, this.reactUiRoot)
    );
  }
}
