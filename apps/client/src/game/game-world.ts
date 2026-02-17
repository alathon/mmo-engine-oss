import type { Scene } from "@babylonjs/core/scene";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import {
  NavmeshGenerationSettings,
  ZoneDefinition,
  AbilityCastInterruptEvent,
  AbilityEffectAppliedEvent,
  ABILITY_DEFINITIONS,
  CombatEventType,
  NavcatQuery,
  type AbilityDefinition,
  LoginResponse,
  NPCState,
  PlayerState,
  SnapMessage,
  EventLogEntry,
  EventCategory,
  TICK_MS,
} from "@mmo/shared-sim";

import * as GlbZoneLoader from "../zone/glb-zone-loader";

// Side-effect import required for collision detection
import "@babylonjs/core/Collisions/collisionCoordinator";

import type { UiLayer } from "../ui/ui-layer";
import { PlayerEntity } from "../entities/player-entity";
import { NpcEntity } from "../entities/npc-entity";
import { MobEntity } from "../entities/mob-entity";
import { LocalPlayerMovementHandler } from "../movement/local-player-movement-handler";
import { DebugManager } from "./debug-manager";
import type {
  CombatDebugData,
  NavmeshInspectData,
  NavmeshProbeData,
  PlayerInputDebugData,
} from "./debug-manager";
import { getNavcatAssetUrl, getZoneDefinition } from "../zone/asset-loaders";
import { loadNavmeshFromUrl } from "../zone/navmesh-loader";
import { createNavMeshHelper, DebugObject } from "../zone/navcat-debug";
import {
  DEFAULT_NAVMESH_GENERATION_SETTINGS,
  generateNavmeshFromMeshes,
  type NavmeshGenerationSummary,
} from "../zone/navmesh-generation";
import type { GroundMesh } from "@babylonjs/core/Meshes/groundMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ObjManager } from "./obj-manager";
import { HotbarController } from "../ui/widgets/hotbars/hotbar-controller";
import { CombatController } from "../combat";
import type { AbilityUseContext } from "../combat";
import { TargetingController } from "../combat/targeting-controller";
import { GroundTargetingController } from "../combat/ground-targeting-controller";
import { InputRouter } from "../input/input-router";
import { UiInputHandler } from "../ui/ui-input-handler";
import { buildCombatLogText, createCombatLogTextContext } from "../combat/log";
import { CombatTextSystem } from "../combat/combat-text-system";
import { CameraFovController } from "./camera-fov-controller";
import { CameraAngleController } from "./camera-angle-controller";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { Line } from "@babylonjs/gui/2D/controls/line";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";

const RECONCILE_NUDGE_DISTANCE = 0.25;
import type { ClientSession } from "../state/client-session";
import type { IngameServices } from "../services/ingame-services";

const NAVMESH_PROBE_MAX_DISTANCE = 8;
const NAVMESH_INSPECT_MAX_DISTANCE = 12;
const WORLD_ORIENTATION_HUD_AXIS_LENGTH = 34;
const WORLD_ORIENTATION_HUD_RIGHT_OFFSET = 86;
const WORLD_ORIENTATION_HUD_TOP_OFFSET = 86;
const WORLD_ORIENTATION_HUD_LABEL_OFFSET = 12;

interface CameraSnapshot {
  alpha: number;
  beta: number;
  radius: number;
  fov: number;
  lowerAlphaLimit: number | null;
  upperAlphaLimit: number | null;
  lowerBetaLimit: number | null;
  upperBetaLimit: number | null;
  lowerRadiusLimit: number | null;
  upperRadiusLimit: number | null;
  minZ: number;
  maxZ: number;
}

interface WorldOrientationHud {
  axisX: Line;
  axisY: Line;
  axisZ: Line;
  labels: TextBlock[];
}

export interface GameWorldOptions {
  scene: Scene;
  camera: ArcRotateCamera;
  loginResponse: LoginResponse;
}

/**
 * Handles in-game world setup and simulation.
 */
export class GameWorld {
  constructor(
    private services: IngameServices,
    private session: ClientSession,
  ) {}

  private scene?: Scene;
  public camera?: ArcRotateCamera;
  private cameraSnapshot?: CameraSnapshot;
  private players = new Map<string, PlayerEntity>();
  private npcs = new Map<string, NpcEntity>();
  private localPlayer?: PlayerEntity;
  private localPlayerId?: string;
  private readonly eventStreamBuffer: EventLogEntry[] = [];
  private readonly combatLogContext = createCombatLogTextContext(
    this.resolveEntityName.bind(this),
    this.resolveAbilityName.bind(this),
    this.getLocalPlayerId.bind(this),
  );
  private combatTextSystem?: CombatTextSystem;
  private localMovement?: LocalPlayerMovementHandler;
  private navmeshQuery?: NavcatQuery;
  private objManager?: ObjManager;
  private debugManager?: DebugManager;
  private uiLayer?: UiLayer;
  private groundMesh?: GroundMesh;
  private zoneNavmeshSourceMeshes: Mesh[] = [];
  private zoneGroundTargetMeshIds = new Set<number>();
  private hotbar?: HotbarController;
  private combatController?: CombatController;
  private targetingController?: TargetingController;
  private groundTargetingController?: GroundTargetingController;
  private cameraFovController?: CameraFovController;
  private cameraAngleController?: CameraAngleController;
  private inputRouter?: InputRouter;
  private uiInputHandler?: UiInputHandler;
  private pendingReconcileNudge?: { x: number; z: number };
  private navmeshDebug?: DebugObject;
  private serverShadow?: Mesh;
  private serverPositionVisualEnabled = false;
  private ignoreServerSnaps = false;
  private zoneDefinition?: ZoneDefinition;
  private worldOrientationHud?: WorldOrientationHud;
  private readonly worldOrientationViewAxis = new Vector3();

  private getLocalPlayerId(): string | undefined {
    return this.localPlayerId;
  }

  /**
   * Returns the active navmesh query.
   */
  get navmesh(): NavcatQuery | undefined {
    return this.navmeshQuery;
  }

  /**
   * Returns the active scene, if initialized.
   */
  getScene(): Scene | undefined {
    return this.scene;
  }

  /**
   * Returns the ground mesh, if available.
   */
  getGroundMesh(): GroundMesh | undefined {
    return this.groundMesh;
  }

  getGroundTargetMeshIds(): ReadonlySet<number> {
    return this.zoneGroundTargetMeshIds;
  }

  /**
   * Returns the local player entity, if available.
   */
  getLocalPlayer(): PlayerEntity | undefined {
    return this.localPlayer;
  }

  /**
   * Returns the current target id, if any.
   */
  getCurrentTargetId(): string | undefined {
    return this.targetingController?.getCurrentTargetId();
  }

  /**
   * Returns the UI layer, if available.
   */
  getUiLayer(): UiLayer | undefined {
    return this.uiLayer;
  }

  /**
   * Returns all player entities.
   */
  getPlayerEntities(): Iterable<PlayerEntity> {
    return this.players.values();
  }

  /**
   * Returns all NPC entities.
   */
  getNpcEntities(): Iterable<NpcEntity> {
    return this.npcs.values();
  }

  /**
   * Returns a mob entity by id if present.
   */
  getMobById(id: string): MobEntity | undefined {
    return this.players.get(id) ?? this.npcs.get(id);
  }

  /**
   * Initializes the world.
   *
   * @param options - world initialization options.
   */
  async initialize(options: GameWorldOptions): Promise<void> {
    this.scene = options.scene;
    this.camera = options.camera;
    this.scene.useRightHandedSystem = true;
    this.scene.collisionsEnabled = true;

    this.uiLayer = this.services.ui.texture;

    if (!this.uiLayer) {
      throw new Error("UI layer not initialized");
    }
    this.combatTextSystem = new CombatTextSystem(this.uiLayer);
    this.objManager = new ObjManager(this.services.zoneNetwork, this.uiLayer);
    this.services.input.initialize(this.scene);
    this.inputRouter = new InputRouter(this.services.input);
    this.uiInputHandler = new UiInputHandler();
    this.inputRouter.registerHandler(this.uiInputHandler);
    this.cameraFovController = new CameraFovController(this.camera);
    this.inputRouter.registerHandler(this.cameraFovController);
    this.cameraAngleController = new CameraAngleController(this.camera);
    this.inputRouter.registerHandler(this.cameraAngleController);
    this.groundTargetingController = new GroundTargetingController(this);
    this.inputRouter.registerHandler(this.groundTargetingController);
    this.targetingController = new TargetingController(this, this.services.zoneNetwork);
    this.inputRouter.registerHandler(this.targetingController);
    this.debugManager = new DebugManager(this.scene, this.services.input, this.uiLayer);
    this.debugManager.setServerPositionToggleHandler((enabled) => {
      this.setServerPositionVisualEnabled(enabled);
    });
    this.debugManager.setReconcileNudgeHandler(() => {
      this.queueReconcileNudge();
    });
    this.createWorldOrientationHud();
    this.objManager.bindEvents(this.scene);
    this.services.chat.onChatMessage((playerId, _playerName, message) => {
      this.showSpeechBubble(playerId, message);
    });
    this.bindRoomEvents();
    this.updateNavmeshProbeProvider();
    this.updateNavmeshInspectProvider();
    this.updatePlayerSyncProvider();
    this.updateMovementDebugProvider();
    this.updateCombatDebugProvider();

    this.createLighting();

    this.localPlayerId = options.loginResponse.playerId;

    await Promise.all([
      this.services.zoneNetwork.initialize({
        token: options.loginResponse.token,
        playerId: options.loginResponse.playerId,
        zoneId: "startingPlains",
      }),
      this.services.socialNetwork.initialize({
        token: options.loginResponse.token,
      }),
    ]);

    this.services.chat.addSystemMessage("Connected to social server");
    this.services.zoneNetwork.onSystemMessage((message) => {
      this.services.chat.addSystemMessage(message);
    });

    const zoneId = await new Promise<string>((resolve) => {
      const existingZoneId = this.services.zoneNetwork.getZoneId();
      if (existingZoneId) {
        resolve(existingZoneId);
        return;
      }

      this.services.zoneNetwork.onZoneReady((assignedZoneId) => {
        resolve(assignedZoneId);
      });
    });

    if (!zoneId) {
      this.services.chat.addSystemMessage("Failed to resolve zone assignment.");
      return;
    }

    console.debug("Zone assignment confirmed", { zoneId });

    const ok = await this.loadZone(zoneId);
    if (!ok) {
      this.services.chat.addSystemMessage(`Zone failed to load: ${zoneId}`);
      return;
    }

    this.configureCameraForWorld();

    console.debug("Zone loaded", { zoneId });
    await this.initializeNavmesh();
    this.createServerShadow();
  }

  /**
   * Disposes the world state.
   */
  dispose(): void {
    this.disposeWorldOrientationHud();
    for (const player of this.players.values()) player.dispose();
    this.players.clear();
    for (const npc of this.npcs.values()) npc.dispose();
    this.npcs.clear();
    this.objManager?.reset();
    this.objManager = undefined;
    this.services.chatViewModel.dispose();
    this.services.connectionStatusViewModel.dispose();
    this.services.hotbarViewModel.dispose();
    this.services.chat.dispose();
    this.debugManager?.dispose();
    this.debugManager = undefined;
    this.inputRouter?.clearHandlers();
    this.inputRouter = undefined;
    this.uiInputHandler = undefined;
    this.groundTargetingController?.setCombatController(undefined);
    this.groundTargetingController?.dispose();
    this.groundTargetingController = undefined;
    this.targetingController?.clearTarget();
    this.targetingController = undefined;
    this.cameraFovController = undefined;
    this.cameraAngleController = undefined;
    this.navmeshQuery = undefined;
    this.zoneDefinition = undefined;
    this.groundMesh = undefined;
    this.zoneNavmeshSourceMeshes = [];
    this.zoneGroundTargetMeshIds.clear();
    this.services.navmeshTuningViewModel.setGenerator(undefined);
    this.services.navmeshTuningViewModel.setIgnoreServerSnapsHandler(undefined);
    this.ignoreServerSnaps = false;
    this.localPlayer = undefined;
    this.localPlayerId = undefined;
    this.localMovement?.dispose();
    this.localMovement = undefined;
    this.combatController = undefined;
    this.hotbar?.dispose();
    this.hotbar = undefined;
    this.combatTextSystem?.dispose();
    this.combatTextSystem = undefined;
    this.services.performanceViewModel.dispose();
    this.restoreCameraSnapshot();
    this.setCameraFollowTarget(undefined);
    this.camera = undefined;
    this.scene = undefined;
    this.navmeshDebug?.node.dispose();
    this.navmeshDebug = undefined;
    this.serverShadow?.dispose();
    this.serverShadow = undefined;
    this.services.input.dispose();
    this.services.zoneNetwork.dispose();
    this.services.socialNetwork.dispose();
    this.services.ui.dispose();
  }

  /**
   * Clears the navmesh and cached references.
   */
  clearNavmesh(): void {
    this.navmeshQuery = undefined;
    for (const player of this.players.values()) player.resetNavmeshNodeRef();
    for (const npc of this.npcs.values()) npc.resetNavmeshNodeRef();
    this.updateNavmeshProbeProvider();
    this.updateNavmeshInspectProvider();
  }

  private elapsedMs = 0;
  /**
   * Updates the render loop, and possibly runs the fixed tick if its time.
   *
   * @param deltaTimeMs - elapsed time in milliseconds.
   */
  update(deltaTimeMs: number): void {
    // Run as many fixedTick()'s as we have time for.
    this.elapsedMs += deltaTimeMs;
    while (this.elapsedMs >= TICK_MS) {
      this.elapsedMs -= TICK_MS;
      this.fixedTick();
    }
    const fixedTickAlpha = this.elapsedMs / TICK_MS;

    this.combatTextSystem?.beginFrame();
    this.services.performanceViewModel.tick(deltaTimeMs);
    this.services.hotbarViewModel.tick(this.services.clock.nowMs());

    this.inputRouter?.updateFrame();

    // Then run updates for entities.
    for (const p of this.players.values()) {
      p.update(deltaTimeMs, fixedTickAlpha);
    }

    for (const npc of this.npcs.values()) {
      npc.update(deltaTimeMs, fixedTickAlpha);
    }

    this.updateWorldOrientationHud();
    this.combatTextSystem?.update(deltaTimeMs);
  }

  private configureCameraForWorld(): void {
    if (!this.camera) {
      return;
    }

    if (!this.cameraSnapshot) {
      this.cameraSnapshot = {
        alpha: this.camera.alpha,
        beta: this.camera.beta,
        radius: this.camera.radius,
        fov: this.camera.fov,
        lowerAlphaLimit: this.camera.lowerAlphaLimit,
        upperAlphaLimit: this.camera.upperAlphaLimit,
        lowerBetaLimit: this.camera.lowerBetaLimit,
        upperBetaLimit: this.camera.upperBetaLimit,
        lowerRadiusLimit: this.camera.lowerRadiusLimit,
        upperRadiusLimit: this.camera.upperRadiusLimit,
        minZ: this.camera.minZ,
        maxZ: this.camera.maxZ,
      };
    }

    const zoneWidth = 100; // TODO: this.zoneDefinition?.sceneData.width ?? 100;
    const zoneHeight = 15; // TODO: this.zoneDefinition?.sceneData.height ?? 100;
    const zoneSize = Math.max(zoneWidth, zoneHeight);

    const alpha = -Math.PI / 2;
    const beta = Math.PI / 3;
    const targetRadius = Math.max(30, zoneSize * 0.35);

    this.camera.alpha = alpha;
    this.camera.beta = beta;
    this.camera.radius = targetRadius;
    this.camera.fov = Math.PI / 4;
    this.camera.lowerAlphaLimit = null;
    this.camera.upperAlphaLimit = null;
    this.camera.lowerBetaLimit = 0.1;
    this.camera.upperBetaLimit = Math.PI - 0.1;
    this.camera.lowerRadiusLimit = Math.max(20, targetRadius * 0.6);
    this.camera.upperRadiusLimit = targetRadius * 1.6;
    this.camera.minZ = 0.1;
    this.camera.maxZ = Math.max(1000, zoneSize * 6);
  }

  private restoreCameraSnapshot(): void {
    const camera = this.camera;
    const snapshot = this.cameraSnapshot;
    if (!camera || !snapshot) {
      return;
    }

    camera.alpha = snapshot.alpha;
    camera.beta = snapshot.beta;
    camera.radius = snapshot.radius;
    camera.fov = snapshot.fov;
    camera.lowerAlphaLimit = snapshot.lowerAlphaLimit;
    camera.upperAlphaLimit = snapshot.upperAlphaLimit;
    camera.lowerBetaLimit = snapshot.lowerBetaLimit;
    camera.upperBetaLimit = snapshot.upperBetaLimit;
    camera.lowerRadiusLimit = snapshot.lowerRadiusLimit;
    camera.upperRadiusLimit = snapshot.upperRadiusLimit;
    camera.minZ = snapshot.minZ;
    camera.maxZ = snapshot.maxZ;
    this.cameraSnapshot = undefined;
  }

  private setCameraFollowTarget(target?: TransformNode): void {
    if (!this.camera) {
      return;
    }

    this.camera.lockedTarget = target ?? (undefined as unknown as typeof this.camera.lockedTarget);
  }

  fixedTick() {
    // TODO: this doesn't seem like it scales well later, when we start having behaviors etc under players/NPCs. Namely
    // that if we want all of a certain type of behavior X to run, before all of a certain other type of behavior Y, then
    // that won't work like this.
    for (const p of this.players.values()) p.fixedTick(TICK_MS);
    for (const npc of this.npcs.values()) npc.fixedTick(TICK_MS);
    this.combatController?.fixedTick();
    this.inputRouter?.update();
    if (this.combatController) {
      const moveDir = this.services.input.getMovementDirection();
      this.combatController.setMovementActive(moveDir.lengthSquared() > 0);
    }
    this.hotbar?.update();
    this.localMovement?.fixedTick(TICK_MS);
    this.flushCombatLog();
  }

  private async initializeNavmesh(): Promise<void> {
    const zoneId = this.zoneDefinition?.id;
    if (!zoneId) {
      console.debug("No zoneId configured for current zone");
      return;
    }

    const navmeshUrl = getNavcatAssetUrl(zoneId);
    if (!navmeshUrl) {
      console.warn(`Navmesh asset not found for zone id: ${zoneId}`);
      return;
    }

    console.debug("Loading navmesh asset", { zoneId, navmeshUrl });

    try {
      const navmesh = await loadNavmeshFromUrl(navmeshUrl);
      const query = new NavcatQuery(navmesh);
      this.navmeshQuery = query;
      console.debug("Navmesh loaded for zone", { zoneId });

      if (this.scene) {
        this.navmeshDebug = createNavMeshHelper(navmesh, this.scene);
        this.debugManager?.setNavmeshDebug(this.navmeshDebug);
        this.navmeshDebug.node.setEnabled(false);
        console.debug("Navmesh debug visualization created", {
          node: this.navmeshDebug.node,
          children: this.navmeshDebug.node.getChildren(),
          position: this.navmeshDebug.node.position,
        });
      }
      this.updateNavmeshProbeProvider();
      this.updateNavmeshInspectProvider();
    } catch (error) {
      console.error("Failed to load navmesh", error);
    }
  }

  private async regenerateNavmeshPreview(
    settings: NavmeshGenerationSettings,
  ): Promise<NavmeshGenerationSummary> {
    if (!this.scene) {
      throw new Error("Scene is not ready for navmesh generation.");
    }

    const sourceMeshes = this.zoneNavmeshSourceMeshes.filter((mesh) => !mesh.isDisposed());
    if (sourceMeshes.length === 0) {
      throw new Error("GLB source meshes are not ready for navmesh generation.");
    }

    const { navMesh, summary } = generateNavmeshFromMeshes(sourceMeshes, settings);

    const query = new NavcatQuery(navMesh);
    this.navmeshQuery = query;

    const wasDebugVisible = this.navmeshDebug?.node.isEnabled() ?? false;
    this.navmeshDebug?.dispose();
    this.navmeshDebug = createNavMeshHelper(navMesh, this.scene);
    this.debugManager?.setNavmeshDebug(this.navmeshDebug);
    this.navmeshDebug.node.setEnabled(wasDebugVisible);

    this.updateNavmeshProbeProvider();
    this.updateNavmeshInspectProvider();

    return summary;
  }

  private createServerShadow(): void {
    if (!this.scene || this.serverShadow) {
      return;
    }

    this.serverShadow = MeshBuilder.CreateSphere(
      "server_shadow",
      {
        diameter: 0.6,
        segments: 12,
      },
      this.scene,
    );
    this.serverShadow.isPickable = false;
    this.serverShadow.renderingGroupId = 2;

    const material = new StandardMaterial("server_shadow_mat", this.scene);
    material.diffuseColor = new Color3(0.9, 0.2, 0.2);
    material.emissiveColor = new Color3(0.4, 0.05, 0.05);
    material.alpha = 0.7;
    this.serverShadow.material = material;

    this.serverShadow.setEnabled(false);
  }

  private async loadZone(zoneId: string): Promise<boolean> {
    if (!this.scene) {
      return false;
    }

    const zoneDefinition = getZoneDefinition(zoneId);
    if (!zoneDefinition) {
      return false;
    }

    this.zoneDefinition = zoneDefinition;

    const navmeshDefaults =
      zoneDefinition.sceneData.navmeshGeneration ?? DEFAULT_NAVMESH_GENERATION_SETTINGS;
    this.services.navmeshTuningViewModel.setDefaults(navmeshDefaults);
    this.services.navmeshTuningViewModel.setGenerator(this.regenerateNavmeshPreview.bind(this));
    this.services.navmeshTuningViewModel.setIgnoreServerSnapsHandler((enabled) => {
      this.ignoreServerSnaps = enabled;
      this.localMovement?.setIgnoreServerSnaps(enabled);
    });

    this.zoneNavmeshSourceMeshes = await GlbZoneLoader.load(this.scene, this.zoneDefinition);
    this.zoneGroundTargetMeshIds = new Set(
      this.zoneNavmeshSourceMeshes.map((mesh) => mesh.uniqueId),
    );
    return true;
  }

  private createLighting(): void {
    if (!this.scene) {
      return;
    }

    const hemisphericLight = new HemisphericLight(
      "hemisphericLight",
      new Vector3(0, 1, 0),
      this.scene,
    );
    hemisphericLight.intensity = 0.8;
    hemisphericLight.groundColor = new Color3(0.2, 0.2, 0.3);
  }

  private bindRoomEvents(): void {
    const zoneConnectionManager = this.services.zoneNetwork;
    zoneConnectionManager.onPlayerAdded((playerId, player) => {
      this.handlePlayerAdded(playerId, player);
    });
    zoneConnectionManager.onPlayerUpdated((playerId, player) => {
      this.handlePlayerUpdated(playerId, player);
    });
    zoneConnectionManager.onPlayerRemoved((playerId) => {
      this.handlePlayerRemoved(playerId);
    });
    zoneConnectionManager.onNpcAdded((npcId, npc) => {
      this.handleNpcAdded(npcId, npc);
    });
    zoneConnectionManager.onNpcUpdated((npcId, npc) => {
      this.handleNpcUpdated(npcId, npc);
    });
    zoneConnectionManager.onNpcRemoved((npcId) => {
      this.handleNpcRemoved(npcId);
    });
    zoneConnectionManager.onSnap((snap) => {
      this.handlePlayerSnap(snap);
    });
    zoneConnectionManager.onAbilityAck((ack) => {
      this.combatController?.applyAck(ack);
    });
    zoneConnectionManager.onDisconnected(() => {
      this.resetEntities();
    });
  }

  private handlePlayerAdded(playerId: string, player: PlayerState): void {
    if (!this.scene) {
      return;
    }

    console.debug("Player added", { playerId });
    const isLocal = playerId === this.localPlayerId;
    const uiLayer = this.uiLayer;
    if (!uiLayer) {
      return;
    }
    const entity = new PlayerEntity(this.scene, player, isLocal, uiLayer);
    if (isLocal && this.session.characterName) {
      entity.setName(this.session.characterName);
    }

    if (isLocal) {
      if (!this.camera) {
        return;
      }
      this.localPlayer = entity;
      this.setCameraFollowTarget(entity.getModelMesh());
      this.localMovement = new LocalPlayerMovementHandler(
        entity,
        this.services.input,
        this.services.zoneNetwork,
        () => {
          this.handleMovementStart();
        },
      );
      this.localMovement.setCamera(this.camera);
      this.localMovement.setIgnoreServerSnaps(this.ignoreServerSnaps);
      this.hotbar = new HotbarController(this.services.input, 8);
      this.hotbar.setSlotAction(0, {
        type: "ability",
        abilityId: "quick_dart",
      });
      this.hotbar.setSlotAction(1, {
        type: "ability",
        abilityId: "shield_bash",
      });
      this.hotbar.setSlotAction(2, {
        type: "ability",
        abilityId: "fireball",
      });
      this.hotbar.setSlotAction(3, {
        type: "ability",
        abilityId: "sky_sword",
      });
      this.hotbar.setSlotAction(4, {
        type: "ability",
        abilityId: "ice_storm",
      });
      this.hotbar.setSlotAction(5, {
        type: "ability",
        abilityId: "overgrowth",
      });
      this.hotbar.setSlotAction(6, {
        type: "ability",
        abilityId: "cleave_line",
      });
      this.hotbar.setSlotAction(7, {
        type: "ability",
        abilityId: "radiant_pulse",
      });

      this.combatController = new CombatController(entity, this.services.zoneNetwork);
      this.services.hotbarViewModel.bind(this.hotbar, this.combatController);
      this.groundTargetingController?.setCombatController(this.combatController);
      this.hotbar.onSlotActivated((_slot, action) => {
        if (action.type !== "ability") {
          return;
        }
        const ability = ABILITY_DEFINITIONS[
          action.abilityId as keyof typeof ABILITY_DEFINITIONS
        ] as AbilityDefinition | undefined;
        if (!ability) {
          return;
        }

        const groundTargeting = this.groundTargetingController;
        if (groundTargeting?.isActive()) {
          const activeAbilityId = groundTargeting.getActiveAbilityId();
          if (activeAbilityId && activeAbilityId !== ability.id) {
            groundTargeting.cancelTargeting();
          }
          if (activeAbilityId === ability.id) {
            groundTargeting.confirmTargeting();
            return;
          }
        }

        if (ability.targetType === "ground" || ability.directionMode === "cursor") {
          const combatController = this.combatController;
          if (!combatController) {
            return;
          }
          const nowMs = Date.now();
          if (!combatController.canBufferAbility(ability.id, nowMs)) {
            return;
          }
          groundTargeting?.beginTargeting(ability.id);
          return;
        }

        const context = this.buildAutoTargetContext(ability);
        if (context === undefined && ability.targetType !== "self") {
          return;
        }
        this.combatController?.tryUseAbility(action.abilityId, context);
      });
      this.updatePlayerSyncProvider();
      this.updatePlayerInputDebugProvider();
      this.updateNavmeshProbeProvider();
      this.updateNavmeshInspectProvider();
      this.updateMovementDebugProvider();
      this.updateCombatDebugProvider();
    }

    if (!isLocal) {
      entity.addRemoteMoveSample(player);
    }
    entity.serverPositionVisual.setEnabled(this.serverPositionVisualEnabled);
    entity.setServerPosition(player.x, player.y, player.z);
    this.players.set(playerId, entity);
  }

  private handlePlayerUpdated(playerId: string, player: PlayerState): void {
    const entity = this.players.get(playerId) ?? this.localPlayer;
    if (!entity) {
      return;
    }

    entity.setCurrentHp(player.currentHp);
    entity.setMaxHp(player.maxHp);
    entity.setDisconnected(player.isDisconnected);
    if (entity.isLocal) {
      const nudge = this.pendingReconcileNudge;
      this.pendingReconcileNudge = undefined;
      if (!this.ignoreServerSnaps) {
        const override = nudge
          ? { x: player.x + nudge.x, y: player.y, z: player.z + nudge.z }
          : undefined;
        this.localMovement?.reconcileFromServerState(player, override);
      }
      if (this.session.characterName && this.session.characterName !== entity.getName()) {
        entity.setName(this.session.characterName);
      }
    } else {
      entity.setServerPosition(player.x, player.y, player.z);
      entity.addRemoteMoveSample(player);
    }

    if (!entity.isLocal && player?.name && player.name !== entity.getName()) {
      entity.setName(player.name);
    }
  }

  private handleMovementStart(): void {
    if (!this.localPlayer || !this.combatController) {
      return;
    }

    const abilityState = this.localPlayer.sync.abilityState;
    if (!abilityState.isCasting(Date.now())) {
      return;
    }

    this.combatController.cancelActiveCast("movement");
  }

  private buildAutoTargetContext(ability: AbilityDefinition): AbilityUseContext | undefined {
    if (ability.targetType === "ground") {
      return;
    }

    if (ability.targetType === "self") {
      return;
    }

    const selectedTarget = this.targetingController?.getCurrentTarget();
    if (!selectedTarget) {
      return;
    }

    const visibleTargets = this.localPlayer?.sync.visibleTargets;
    if (visibleTargets && !visibleTargets.includes(selectedTarget.getId())) {
      return;
    }

    const targetPosition = selectedTarget.getPosition();
    const sourcePosition = this.localPlayer?.getPosition();
    if (sourcePosition) {
      const dx = targetPosition.x - sourcePosition.x;
      const dy = targetPosition.y - sourcePosition.y;
      const dz = targetPosition.z - sourcePosition.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > ability.range) {
        return;
      }
    }
    return {
      targetEntityId: selectedTarget.getId(),
    };
  }

  private queueReconcileNudge(): void {
    const angle = Math.random() * Math.PI * 2;
    this.pendingReconcileNudge = {
      x: Math.cos(angle) * RECONCILE_NUDGE_DISTANCE,
      z: Math.sin(angle) * RECONCILE_NUDGE_DISTANCE,
    };
    console.debug("Queued reconcile nudge", this.pendingReconcileNudge);
  }

  private handlePlayerRemoved(playerId: string): void {
    const entity = this.players.get(playerId);
    if (!entity) {
      return;
    }

    console.debug("Player removed", { playerId });
    this.targetingController?.clearTargetIfMatches(playerId);
    entity.dispose();
    this.players.delete(playerId);
    if (entity.isLocal) {
      this.localPlayer = undefined;
      this.localMovement?.dispose();
      this.localMovement = undefined;
      this.combatController = undefined;
      this.setCameraFollowTarget(undefined);
      this.groundTargetingController?.setCombatController(undefined);
      this.targetingController?.clearTarget();
      this.hotbar?.dispose();
      this.hotbar = undefined;
      this.services.hotbarViewModel.clear();
      this.updatePlayerSyncProvider();
      this.updatePlayerInputDebugProvider();
      this.updateNavmeshProbeProvider();
      this.updateNavmeshInspectProvider();
      this.updateMovementDebugProvider();
      this.updateCombatDebugProvider();
    }
  }

  private handleNpcAdded(npcId: string, npc: NPCState): void {
    if (!this.scene) {
      return;
    }

    const uiLayer = this.uiLayer;
    if (!uiLayer) {
      return;
    }
    const entity = new NpcEntity(`npc_${npc.id}`, this.scene, npc, uiLayer);
    entity.addRemoteMoveSample(npc);
    entity.serverPositionVisual.setEnabled(this.serverPositionVisualEnabled);
    entity.setServerPosition(npc.x, npc.y, npc.z);
    this.npcs.set(npcId, entity);
  }

  private handleNpcUpdated(npcId: string, npc: NPCState): void {
    const entity = this.npcs.get(npcId);
    if (!entity) {
      return;
    }

    entity.setCurrentHp(npc.currentHp);
    entity.setMaxHp(npc.maxHp);
    entity.setServerPosition(npc.x, npc.y, npc.z);
    entity.addRemoteMoveSample(npc);
  }

  private handleNpcRemoved(npcId: string): void {
    const entity = this.npcs.get(npcId);
    if (!entity) {
      return;
    }

    console.debug("Npc removed", { npcId });
    this.targetingController?.clearTargetIfMatches(npcId);
    entity.dispose();
    this.npcs.delete(npcId);
  }

  private handlePlayerSnap(snap: SnapMessage): void {
    if (!this.localPlayer) {
      return;
    }

    if (this.ignoreServerSnaps) {
      return;
    }

    this.localMovement?.applyServerSnap(snap.x, snap.y, snap.z, snap.seq);
  }

  private resetEntities(): void {
    for (const player of this.players.values()) player.dispose();
    this.players.clear();
    for (const npc of this.npcs.values()) npc.dispose();
    this.npcs.clear();
    this.navmeshQuery = undefined;
    this.localPlayer = undefined;
    this.localPlayerId = undefined;
    this.localMovement?.dispose();
    this.localMovement = undefined;
    this.combatController = undefined;
    this.combatTextSystem?.clear();
    this.setCameraFollowTarget(undefined);
    this.groundTargetingController?.setCombatController(undefined);
    this.targetingController?.clearTarget();
    this.hotbar?.dispose();
    this.hotbar = undefined;
    this.services.hotbarViewModel.clear();
    this.updatePlayerSyncProvider();
    this.updatePlayerInputDebugProvider();
    this.updateNavmeshProbeProvider();
    this.updateNavmeshInspectProvider();
    this.updateMovementDebugProvider();
    this.updateCombatDebugProvider();
  }

  private createAxisLine(name: string, color: string): Line {
    const line = new Line(name);
    line.color = color;
    line.lineWidth = 4;
    line.isHitTestVisible = false;
    this.uiLayer?.addControl(line);
    return line;
  }

  private createAxisLabel(text: string, color: string): TextBlock {
    const label = new TextBlock(`world_orientation_label_${text.replaceAll(" ", "_")}`);
    label.text = text;
    label.color = color;
    label.fontSize = 12;
    label.fontFamily = "Segoe UI, system-ui, sans-serif";
    label.fontWeight = "700";
    label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    label.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    label.outlineWidth = 3;
    label.outlineColor = "black";
    label.isHitTestVisible = false;
    this.uiLayer?.addControl(label);
    return label;
  }

  private createWorldOrientationHud(): void {
    this.disposeWorldOrientationHud();
    if (!this.uiLayer) {
      return;
    }

    const axisX = this.createAxisLine("world_orientation_axis_x", "#ff6b6b");
    const axisY = this.createAxisLine("world_orientation_axis_y", "#5fe05f");
    const axisZ = this.createAxisLine("world_orientation_axis_z", "#6ea8ff");
    const labels = [
      this.createAxisLabel("+X", "#ff6b6b"),
      this.createAxisLabel("+Y", "#5fe05f"),
      this.createAxisLabel("+Z (Back)", "#6ea8ff"),
    ];

    this.worldOrientationHud = { axisX, axisY, axisZ, labels };
    this.updateWorldOrientationHud();
  }

  private updateWorldOrientationHud(): void {
    const hud = this.worldOrientationHud;
    const camera = this.camera;
    const scene = this.scene;
    if (!hud || !camera || !scene) {
      return;
    }

    const engine = scene.getEngine();
    const centerX = engine.getRenderWidth() - WORLD_ORIENTATION_HUD_RIGHT_OFFSET;
    const centerY = WORLD_ORIENTATION_HUD_TOP_OFFSET;
    const view = camera.getViewMatrix(true);

    const updateAxis = (
      axis: Vector3,
      line: Line,
      label: TextBlock,
      fallbackX: number,
      fallbackY: number,
    ): void => {
      Vector3.TransformNormalToRef(axis, view, this.worldOrientationViewAxis);
      const endX = centerX + this.worldOrientationViewAxis.x * WORLD_ORIENTATION_HUD_AXIS_LENGTH;
      const endY = centerY - this.worldOrientationViewAxis.y * WORLD_ORIENTATION_HUD_AXIS_LENGTH;

      line.x1 = `${centerX}px`;
      line.y1 = `${centerY}px`;
      line.x2 = `${endX}px`;
      line.y2 = `${endY}px`;

      const labelXDirection =
        Math.abs(this.worldOrientationViewAxis.x) > 0.05
          ? Math.sign(this.worldOrientationViewAxis.x)
          : fallbackX;
      const labelYDirection =
        Math.abs(this.worldOrientationViewAxis.y) > 0.05
          ? -Math.sign(this.worldOrientationViewAxis.y)
          : fallbackY;

      label.left = `${endX + labelXDirection * WORLD_ORIENTATION_HUD_LABEL_OFFSET}px`;
      label.top = `${endY + labelYDirection * WORLD_ORIENTATION_HUD_LABEL_OFFSET}px`;
    };

    updateAxis(Vector3.RightReadOnly, hud.axisX, hud.labels[0], 1, 0);
    updateAxis(Vector3.UpReadOnly, hud.axisY, hud.labels[1], 0, -1);
    updateAxis(Vector3.Forward(scene.useRightHandedSystem), hud.axisZ, hud.labels[2], -1, 0);
  }

  private disposeWorldOrientationHud(): void {
    const hud = this.worldOrientationHud;
    if (!hud) {
      return;
    }

    this.uiLayer?.removeControl(hud.axisX);
    this.uiLayer?.removeControl(hud.axisY);
    this.uiLayer?.removeControl(hud.axisZ);
    hud.axisX.dispose();
    hud.axisY.dispose();
    hud.axisZ.dispose();

    for (const label of hud.labels) {
      this.uiLayer?.removeControl(label);
      label.dispose();
    }

    this.worldOrientationHud = undefined;
  }

  private showSpeechBubble(playerId: string, message: string): void {
    const player = this.players.get(playerId) ?? this.localPlayer;
    if (player) {
      player.showSpeechBubble(message);
    }
  }

  private setServerPositionVisualEnabled(enabled: boolean): void {
    this.serverPositionVisualEnabled = enabled;
    for (const player of this.players.values()) {
      player.serverPositionVisual.setEnabled(enabled);
      if (enabled) {
        player.serverPositionVisual.position.set(player.sync.x, player.sync.y, player.sync.z);
      }
    }
    for (const npc of this.npcs.values()) {
      npc.serverPositionVisual.setEnabled(enabled);
      if (enabled) {
        npc.serverPositionVisual.position.set(npc.sync.x, npc.sync.y, npc.sync.z);
      }
    }
  }

  private updateNavmeshProbeProvider(): void {
    if (!this.debugManager || !this.localPlayer || !this.navmeshQuery) {
      this.debugManager?.setNavmeshProbeProvider(undefined);
      return;
    }

    const navmesh = this.navmeshQuery;
    const maxDistance = NAVMESH_PROBE_MAX_DISTANCE;
    this.debugManager.setNavmeshProbeProvider((): NavmeshProbeData | undefined => {
      const player = this.localPlayer;
      if (!player) {
        return;
      }
      const position = player.position;
      const moveDebug = player.getLastNavmeshMoveDebug();
      const groundHeight = this.groundMesh?.getHeightAtCoordinates(position.x, position.z);
      const navmeshHeight = navmesh.sampleHeight(position.x, position.z) ?? undefined;
      const hasHeights =
        typeof groundHeight === "number" &&
        Number.isFinite(groundHeight) &&
        typeof navmeshHeight === "number" &&
        Number.isFinite(navmeshHeight);
      const isOnNavmesh = navmesh.isPointOnNavmesh(position.x, position.z);
      const nearest = navmesh.findNearestPoint(position.x, position.z, maxDistance);
      if (!nearest) {
        return {
          playerX: position.x,
          playerY: position.y,
          playerZ: position.z,
          isOnNavmesh,
          maxDistance,
          groundHeight: hasHeights ? groundHeight : undefined,
          navmeshHeight: hasHeights ? navmeshHeight : undefined,
          heightDelta: hasHeights ? navmeshHeight - groundHeight : undefined,
          move: moveDebug
            ? {
                requested: moveDebug.requested,
                actual: moveDebug.actual,
                ratio: moveDebug.ratio,
                collided: moveDebug.collided,
                nodeRef: moveDebug.nodeRef,
              }
            : undefined,
        };
      }

      const dx = nearest.x - position.x;
      const dz = nearest.z - position.z;
      const dy = nearest.y - position.y;
      return {
        playerX: position.x,
        playerY: position.y,
        playerZ: position.z,
        isOnNavmesh,
        maxDistance,
        groundHeight: hasHeights ? groundHeight : undefined,
        navmeshHeight: hasHeights ? navmeshHeight : undefined,
        heightDelta: hasHeights ? navmeshHeight - groundHeight : undefined,
        move: moveDebug
          ? {
              requested: moveDebug.requested,
              actual: moveDebug.actual,
              ratio: moveDebug.ratio,
              collided: moveDebug.collided,
              nodeRef: moveDebug.nodeRef,
            }
          : undefined,
        nearest: {
          x: nearest.x,
          y: nearest.y,
          z: nearest.z,
          nodeRef: nearest.nodeRef,
          distanceXZ: Math.hypot(dx, dz),
          distanceY: dy,
        },
      };
    });
  }

  private updatePlayerSyncProvider(): void {
    if (!this.debugManager || !this.localPlayer) {
      this.debugManager?.setPlayerSyncProvider(undefined);
      return;
    }

    this.debugManager.setPlayerSyncProvider(() => {
      const player = this.localPlayer;
      if (!player) {
        return;
      }

      const synced = player.sync;
      return {
        x: synced.x,
        y: synced.y,
        z: synced.z,
        lastProcessedSeq: synced.lastProcessedSeq,
        serverTimeMs: synced.serverTimeMs,
      };
    });
  }

  private updatePlayerInputDebugProvider(): void {
    if (!this.debugManager || !this.localPlayer || !this.localMovement) {
      this.debugManager?.setPlayerInputDebugProvider(undefined);
      return;
    }

    this.debugManager.setPlayerInputDebugProvider((): PlayerInputDebugData | undefined => {
      const player = this.localPlayer;
      const movement = this.localMovement;
      if (!player || !movement) {
        return;
      }

      const debug = player.sync.debug;
      if (!debug) {
        return;
      }

      const reconcileDebug = movement.getReconcileDebug();
      return {
        serverTick: debug.serverTick,
        pendingInputs: debug.pendingInputs,
        processedInputs: debug.processedInputs,
        droppedInputs: debug.droppedInputs,
        remainingInputs: debug.remainingInputs,
        budgetBefore: debug.budgetBefore,
        budgetAfter: debug.budgetAfter,
        clientPendingMoves: reconcileDebug.pendingMoves,
        clientLastAckedSeq: reconcileDebug.lastAckedSeq,
        clientReconcileDelta: reconcileDebug.lastReconcileDelta,
        clientReconcileSnapped: reconcileDebug.lastReconcileSnapped,
        clientReconcileSeq: reconcileDebug.lastReconcileSeq,
      };
    });
  }

  private updateMovementDebugProvider(): void {
    if (!this.debugManager || !this.localPlayer || !this.localMovement) {
      this.debugManager?.setMovementDebugProvider(undefined);
      return;
    }

    this.debugManager.setMovementDebugProvider(() => {
      const player = this.localPlayer;
      const movement = this.localMovement;
      if (!player || !movement) {
        return;
      }

      const reconcileDebug = movement.getReconcileDebug();
      const navmeshDebug = player.getLastNavmeshMoveDebug();

      return {
        pendingMoves: reconcileDebug.pendingMoves,
        lastReconcileDelta: reconcileDebug.lastReconcileDelta,
        lastReconcileSnapped: reconcileDebug.lastReconcileSnapped,
        lastReconcileSeq: reconcileDebug.lastReconcileSeq,
        navmeshMove: navmeshDebug
          ? {
              requested: navmeshDebug.requested,
              actual: navmeshDebug.actual,
              ratio: navmeshDebug.ratio,
              collided: navmeshDebug.collided,
              nodeRef: navmeshDebug.nodeRef,
            }
          : undefined,
      };
    });
  }

  private updateCombatDebugProvider(): void {
    if (!this.debugManager || !this.combatController) {
      this.debugManager?.setCombatDebugProvider(undefined);
      return;
    }

    this.debugManager.setCombatDebugProvider((): CombatDebugData | undefined => {
      const controller = this.combatController;
      if (!controller) {
        return;
      }

      const nowMs = Date.now();
      const clientCombatState = controller.getClientCombatState(nowMs);
      const lastAck = controller.getLastAck();
      const target = this.targetingController?.getCurrentTarget();
      const targetPosition = target?.getPosition();
      let targetAggro: CombatDebugData["targetAggro"];

      if (target && "combatState" in target.sync) {
        const combatState = (target.sync as NPCState).combatState;
        if (combatState) {
          const entries: NonNullable<CombatDebugData["targetAggro"]> = [];
          for (const [id, entry] of combatState.aggro.entries()) {
            entries.push({ id, percent: entry.percent });
          }
          entries.sort((a, b) => b.percent - a.percent || a.id.localeCompare(b.id));
          targetAggro = entries;
        }
      }

      return {
        gcdRemainingMs: clientCombatState.gcd.remainingMs,
        internalCooldownRemainingMs: clientCombatState.internalCooldown.remainingMs,
        queuedAbilityId: clientCombatState.queuedAbilityId,
        target:
          target && targetPosition
            ? {
                id: target.getId(),
                x: targetPosition.x,
                y: targetPosition.y,
                z: targetPosition.z,
              }
            : undefined,
        targetAggro,
        lastAck: lastAck
          ? {
              requestId: lastAck.requestId,
              accepted: lastAck.accepted,
              rejectReason: lastAck.rejectReason,
              serverTick: lastAck.serverTick,
              serverTimeMs: lastAck.serverTimeMs,
              castStartTimeMs: lastAck.castStartTimeMs,
              castEndTimeMs: lastAck.castEndTimeMs,
            }
          : undefined,
      };
    });
  }

  private updateNavmeshInspectProvider(): void {
    if (!this.debugManager || !this.navmeshQuery) {
      this.debugManager?.setNavmeshInspectProvider(undefined);
      return;
    }

    const navmesh = this.navmeshQuery;
    const navmeshData = navmesh.getNavmesh();
    const maxDistance = NAVMESH_INSPECT_MAX_DISTANCE;
    this.debugManager.setNavmeshInspectProvider((point): NavmeshInspectData | undefined => {
      const isOnNavmesh = navmesh.isPointOnNavmesh(point.x, point.z);
      const nearest = navmesh.findNearestPoint(point.x, point.z, maxDistance);
      if (!nearest) {
        return {
          clickX: point.x,
          clickY: point.y,
          clickZ: point.z,
          isOnNavmesh,
          maxDistance,
          navmesh: navmeshData,
        };
      }

      const polyIndex = navmeshData.nodes.findIndex(
        (node) => node.allocated && node.ref === nearest.nodeRef,
      );
      const polyInfo =
        polyIndex === -1
          ? undefined
          : {
              tileId: navmeshData.nodes[polyIndex].tileId,
              polyIndex: navmeshData.nodes[polyIndex].polyIndex,
              neighbors:
                navmeshData.tiles[navmeshData.nodes[polyIndex].tileId]?.polys?.[
                  navmeshData.nodes[polyIndex].polyIndex
                ]?.neis ?? [],
            };

      const dx = nearest.x - point.x;
      const dz = nearest.z - point.z;
      const dy = nearest.y - point.y;
      return {
        clickX: point.x,
        clickY: point.y,
        clickZ: point.z,
        isOnNavmesh,
        maxDistance,
        navmesh: navmeshData,
        nodeRef: nearest.nodeRef,
        polyInfo,
        nearest: {
          x: nearest.x,
          y: nearest.y,
          z: nearest.z,
          nodeRef: nearest.nodeRef,
          distanceXZ: Math.hypot(dx, dz),
          distanceY: dy,
        },
      };
    });
  }

  private flushCombatLog(): void {
    const buffer = this.eventStreamBuffer;
    buffer.length = 0;
    this.services.zoneNetwork.drainEventStream(buffer);
    if (buffer.length === 0) {
      return;
    }

    for (const entry of buffer) {
      if (
        entry.category === EventCategory.Combat &&
        entry.eventType === CombatEventType.AbilityCastInterrupt
      ) {
        this.combatController?.handleServerCastInterrupt(entry as AbilityCastInterruptEvent);
      }
      const message = buildCombatLogText(entry, this.combatLogContext);
      if (message) {
        this.services.ui.appendBattleMessage(message);
      }
      this.maybeSpawnCombatText(entry);
    }
  }

  private resolveEntityName(entityId: string): string {
    if (!entityId) {
      return "Unknown";
    }

    const player = this.players.get(entityId);
    if (player) {
      return player.getName();
    }

    const npc = this.npcs.get(entityId);
    if (npc) {
      return npc.getName();
    }

    return entityId;
  }

  private maybeSpawnCombatText(entry: EventLogEntry): void {
    if (!this.combatTextSystem) {
      return;
    }

    if (entry.category !== EventCategory.Combat) {
      return;
    }

    if (entry.eventType !== CombatEventType.AbilityEffectApplied) {
      return;
    }

    const effect = entry as AbilityEffectAppliedEvent;

    const damage = effect.damage;
    if (!damage || damage <= 0) {
      const healing = effect.healing;
      if (!healing || healing <= 0) {
        return;
      }

      const healTarget = this.getMobById(effect.targetId);
      if (!healTarget) {
        return;
      }

      this.combatTextSystem.spawnHealing(healTarget.getModelMesh(), healing, effect.targetId);
      return;
    }

    const target = this.getMobById(effect.targetId);
    if (!target) {
      return;
    }

    this.combatTextSystem.spawnDamage(
      target.getModelMesh(),
      damage,
      effect.outcome === "crit",
      effect.targetId,
    );
  }

  private resolveAbilityName(abilityId: string): string {
    if (!abilityId) {
      return "Unknown";
    }

    const ability = ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS];
    return ability?.name ?? abilityId;
  }
}
