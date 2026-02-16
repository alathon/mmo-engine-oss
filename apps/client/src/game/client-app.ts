import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { ClientGameState } from "../state/client-game-state";
import { ClientGameStateHandler } from "../state/client-game-state-handler";
import { FullscreenUiController } from "../ui/fullscreen-ui-controller";
import { createReactUiRoot, type ReactUiRoot } from "../ui/react-ui-root";
import { LoginState } from "../state/login-state";
import { CharacterSelectState } from "../state/character-select-state";
import { IngameState } from "../state/ingame-state";
import { createCoreServices } from "../services/core-services";

interface MmoDebugRenderState {
  engine: {
    webGLVersion: number;
    glVersion: string | null;
    shadingLanguageVersion: string | null;
  };
  scene: {
    postProcessesEnabled: boolean;
    meshes: {
      total: number;
      enabled: number;
      visible: number;
    };
    activeCameraName?: string;
  };
  effects: {
    total: number;
    failed: {
      key?: string;
      name?: string;
      error: string;
    }[];
    shaderStore: {
      hasPostprocessVertexShader: boolean;
      hasPostprocessFragmentShader: boolean;
      includesCount: number;
    };
  };
  meshesByName: {
    name: string;
    enabled: boolean;
    visible: boolean;
    hasMaterial: boolean;
    materialName?: string;
  }[];
}

interface MmoClientDebugApi {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  dumpRenderState: () => MmoDebugRenderState;
}

interface MmoClientDebugWindow extends Window {
  __mmoDebug?: MmoClientDebugApi;
}

interface InternalEngineForDebug {
  _compiledEffects?: Record<string, InternalEffectForDebug>;
  _gl?: WebGLRenderingContext | WebGL2RenderingContext;
}

interface InternalEffectForDebug {
  _key?: string;
  name?: string;
  _compilationError?: string;
  constructor?: {
    ShadersStore?: Record<string, string>;
    IncludesShadersStore?: Record<string, string>;
  };
}

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

  private createDumpRenderState(engine: Engine, scene: Scene): () => MmoDebugRenderState {
    return () => {
      const internalEngine = engine as unknown as InternalEngineForDebug;
      const gl = internalEngine._gl;
      const compiledEffects = Object.values(internalEngine._compiledEffects ?? {});
      const failedEffects = compiledEffects
        .filter((effect) => (effect._compilationError ?? "").trim().length > 0)
        .map((effect) => ({
          key: effect._key,
          name: effect.name,
          error: effect._compilationError ?? "",
        }));
      const effectConstructor = compiledEffects[0]?.constructor;
      const shaderStore = effectConstructor?.ShadersStore ?? {};
      const includesStore = effectConstructor?.IncludesShadersStore ?? {};

      const camera = scene.activeCamera;
      const meshRows = scene.meshes
        .filter((mesh) => mesh.name.startsWith("col_") || mesh.name === "Cube")
        .map((mesh) => ({
          name: mesh.name,
          enabled: mesh.isEnabled(),
          visible: mesh.isVisible,
          hasMaterial: mesh.material !== null,
          materialName: mesh.material?.name,
        }));

      const summary = {
        engine: {
          webGLVersion: engine.webGLVersion,
          glVersion: gl ? gl.getParameter(gl.VERSION) : null,
          shadingLanguageVersion: gl ? gl.getParameter(gl.SHADING_LANGUAGE_VERSION) : null,
        },
        scene: {
          postProcessesEnabled: scene.postProcessesEnabled,
          meshes: {
            total: scene.meshes.length,
            enabled: scene.meshes.filter((mesh) => mesh.isEnabled()).length,
            visible: scene.meshes.filter((mesh) => mesh.isVisible).length,
          },
          activeCameraName: camera?.name,
        },
        effects: {
          total: compiledEffects.length,
          failed: failedEffects,
          shaderStore: {
            hasPostprocessVertexShader: shaderStore.postprocessVertexShader !== undefined,
            hasPostprocessFragmentShader:
              shaderStore.postprocessPixelShader !== undefined ||
              shaderStore.postprocessFragmentShader !== undefined,
            includesCount: Object.keys(includesStore).length,
          },
        },
        meshesByName: meshRows,
      };

      console.log("window.__mmoDebug.dumpRenderState()", summary);
      if (meshRows.length > 0) {
        console.table(meshRows);
      }

      return summary;
    };
  }

  /**
   * Initializes the Babylon engine and client state flow.
   *
   * @param canvas - canvas element used for rendering.
   */
  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    if (this.engine) {
      throw new Error("ClientApp already initialized");
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
      "camera",
      -Math.PI / 2,
      Math.PI / 3,
      30,
      Vector3.Zero(),
      this.scene,
    );

    this.camera.lowerBetaLimit = 0.1;
    this.camera.upperBetaLimit = Math.PI - 0.1;
    this.camera.lowerRadiusLimit = 15;
    this.camera.upperRadiusLimit = 50;

    this.camera.attachControl(canvas, true);
    this.camera.panningSensibility = 0;

    if (import.meta.env.DEV) {
      // eslint-disable-next-line unicorn/prefer-global-this
      const debugWindow = window as MmoClientDebugWindow;
      debugWindow.__mmoDebug = {
        engine: this.engine,
        scene: this.scene,
        camera: this.camera,
        dumpRenderState: this.createDumpRenderState(this.engine, this.scene),
      };
      console.debug("Attached client debug refs to window.__mmoDebug");
    }

    this.uiController = new FullscreenUiController(this.scene);
    this.reactUiRoot = createReactUiRoot();
    await this.transitionToLogin();

    this.engine.runRenderLoop(() => {
      try {
        const deltaTimeMs = this.engine?.getDeltaTime() ?? 0;
        this.stateHandler.update(deltaTimeMs);
        this.scene?.render();
      } catch (error) {
        console.error("Render loop error:", error);
      }
    });

    window.addEventListener("resize", () => {
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
      }),
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
        },
      ),
    );
  }

  private async transitionToIngame(characterId: string, characterName: string): Promise<void> {
    if (!this.scene || !this.coreServices.session.loginResponse || !this.reactUiRoot) {
      return;
    }

    console.debug("Selected character", { characterId });
    this.coreServices.session.characterId = characterId;
    this.coreServices.session.characterName = characterName;
    await this.stateHandler.transitionTo(
      ClientGameState.Ingame,
      new IngameState(this.scene, this.coreServices, this.reactUiRoot),
    );
  }
}
