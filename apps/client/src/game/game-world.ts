import type { Scene } from '@babylonjs/core/scene';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type {
  LoginResponse,
  NPCState,
  PlayerState,
  ZoneDefinition,
  SnapMessage,
  EventLogEntry,
  AbilityCastInterruptEvent,
  AbilityEffectAppliedEvent,
} from '@mmo/shared';
import {
  ABILITY_DEFINITIONS,
  CombatEventType,
  EventCategory,
  NavcatQuery,
  TICK_MS,
  type AbilityDefinition,
} from '@mmo/shared';

// Side-effect import required for collision detection
import '@babylonjs/core/Collisions/collisionCoordinator';

import type { UiLayer } from '../ui/ui-layer';
import { PlayerEntity } from '../entities/player-entity';
import { NpcEntity } from '../entities/npc-entity';
import { MobEntity } from '../entities/mob-entity';
import { LocalPlayerMovementHandler } from '../movement/local-player-movement-handler';
import { DebugManager } from './debug-manager';
import type {
  CombatDebugData,
  NavmeshInspectData,
  NavmeshProbeData,
  PlayerInputDebugData,
} from './debug-manager';
import { getNavcatAssetUrl, getZoneDefinition } from '../zone/asset-loaders';
import { loadNavmeshFromUrl } from '../zone/navmesh-loader';
import { createNavMeshHelper, DebugObject } from '../zone/navcat-debug';
import type { GroundMesh } from '@babylonjs/core/Meshes/groundMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ObjEntity } from '../entities/obj-entity';
import { ObjManager } from './obj-manager';
import { HotbarController } from '../ui/widgets/hotbars/hotbar-controller';
import { CombatController } from '../combat';
import type { AbilityUseContext } from '../combat';
import { TargetingController } from '../combat/targeting-controller';
import { GroundTargetingController } from '../combat/ground-targeting-controller';
import { InputRouter } from '../input/input-router';
import { UiInputHandler } from '../ui/ui-input-handler';
import { buildCombatLogText, createCombatLogTextContext } from '../combat/log';
import { CombatTextSystem } from '../combat/combat-text-system';

const RECONCILE_NUDGE_DISTANCE = 0.25;
import type { ClientSession } from '../state/client-session';
import type { IngameServices } from '../services/ingame-services';

const NAVMESH_PROBE_MAX_DISTANCE = 8;
const NAVMESH_INSPECT_MAX_DISTANCE = 12;

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
    private session: ClientSession
  ) {}

  private scene?: Scene;
  public camera?: ArcRotateCamera;
  private players = new Map<string, PlayerEntity>();
  private npcs = new Map<string, NpcEntity>();
  private localPlayer?: PlayerEntity;
  private localPlayerId?: string;
  private readonly eventStreamBuffer: EventLogEntry[] = [];
  private readonly combatLogContext = createCombatLogTextContext(
    this.resolveEntityName.bind(this),
    this.resolveAbilityName.bind(this),
    this.getLocalPlayerId.bind(this)
  );
  private combatTextSystem?: CombatTextSystem;
  private localMovement?: LocalPlayerMovementHandler;
  private navmeshQuery?: NavcatQuery;
  private objManager?: ObjManager;
  private debugManager?: DebugManager;
  private uiLayer?: UiLayer;
  private groundMesh?: GroundMesh;
  private hotbar?: HotbarController;
  private combatController?: CombatController;
  private targetingController?: TargetingController;
  private groundTargetingController?: GroundTargetingController;
  private inputRouter?: InputRouter;
  private uiInputHandler?: UiInputHandler;
  private pendingReconcileNudge?: { x: number; z: number };
  private navmeshDebug?: DebugObject;
  private serverShadow?: Mesh;
  private serverPositionVisualEnabled = false;
  private zoneDefinition?: ZoneDefinition;

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
      throw new Error('UI layer not initialized');
    }
    this.combatTextSystem = new CombatTextSystem(this.uiLayer);
    this.objManager = new ObjManager(this.services.zoneNetwork, this.uiLayer);
    this.services.input.initialize(this.scene);
    this.inputRouter = new InputRouter(this.services.input);
    this.uiInputHandler = new UiInputHandler();
    this.inputRouter.registerHandler(this.uiInputHandler);
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
        zoneId: 'startingPlains',
      }),
      this.services.socialNetwork.initialize({
        token: options.loginResponse.token,
      }),
    ]);

    this.services.chat.addSystemMessage('Connected to social server');
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
      this.services.chat.addSystemMessage('Failed to resolve zone assignment.');
      return;
    }

    console.debug('Zone assignment confirmed', { zoneId });

    if (!this.loadZone(zoneId)) {
      this.services.chat.addSystemMessage(`Zone not found: ${zoneId}`);
      return;
    }

    console.debug('Zone loaded', { zoneId });
    await this.initializeNavmesh();
    this.createServerShadow();
  }

  /**
   * Disposes the world state.
   */
  dispose(): void {
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
    this.navmeshQuery = undefined;
    this.zoneDefinition = undefined;
    this.groundMesh = undefined;
    this.localPlayer = undefined;
    this.localPlayerId = undefined;
    this.localMovement = undefined;
    this.combatController = undefined;
    this.hotbar?.dispose();
    this.hotbar = undefined;
    this.combatTextSystem?.dispose();
    this.combatTextSystem = undefined;
    this.services.performanceViewModel.dispose();
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
    this.localMovement?.setNavmesh(undefined);
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
    this.combatTextSystem?.beginFrame();
    this.services.performanceViewModel.tick(deltaTimeMs);
    // Run as many fixedTick()'s as we have time for.
    this.elapsedMs += deltaTimeMs;
    while (this.elapsedMs >= TICK_MS) {
      this.elapsedMs -= TICK_MS;
      this.fixedTick();
    }

    this.inputRouter?.updateFrame();

    // Then run updates for entities.
    for (const p of this.players.values()) {
      p.update(deltaTimeMs);
    }

    for (const npc of this.npcs.values()) {
      npc.update(deltaTimeMs);
    }

    this.combatTextSystem?.update(deltaTimeMs);
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
    this.services.hotbarViewModel.tick(Date.now());
    this.localMovement?.fixedTick(TICK_MS);
    this.flushCombatLog();
  }

  private async initializeNavmesh(): Promise<void> {
    const zoneId = this.zoneDefinition?.id;
    if (!zoneId) {
      console.debug('No zoneId configured for current zone');
      return;
    }

    const navmeshUrl = getNavcatAssetUrl(zoneId);
    if (!navmeshUrl) {
      console.warn(`Navmesh asset not found for zone id: ${zoneId}`);
      return;
    }

    console.debug('Loading navmesh asset', { zoneId, navmeshUrl });

    try {
      const navmesh = await loadNavmeshFromUrl(navmeshUrl);
      const query = new NavcatQuery(navmesh);
      this.navmeshQuery = query;
      this.localMovement?.setNavmesh(query);
      console.debug('Navmesh loaded for zone', { zoneId });

      if (this.scene) {
        this.navmeshDebug = createNavMeshHelper(navmesh, this.scene);
        this.debugManager?.setNavmeshDebug(this.navmeshDebug);
        this.navmeshDebug.node.setEnabled(false);
        console.debug('Navmesh debug visualization created', {
          node: this.navmeshDebug.node,
          children: this.navmeshDebug.node.getChildren(),
          position: this.navmeshDebug.node.position,
        });
      }
      this.updateNavmeshProbeProvider();
      this.updateNavmeshInspectProvider();
    } catch (error) {
      console.error('Failed to load navmesh', error);
    }
  }

  private createServerShadow(): void {
    if (!this.scene || this.serverShadow) {
      return;
    }

    this.serverShadow = MeshBuilder.CreateSphere(
      'server_shadow',
      {
        diameter: 0.6,
        segments: 12,
      },
      this.scene
    );
    this.serverShadow.isPickable = false;
    this.serverShadow.renderingGroupId = 2;

    const material = new StandardMaterial('server_shadow_mat', this.scene);
    material.diffuseColor = new Color3(0.9, 0.2, 0.2);
    material.emissiveColor = new Color3(0.4, 0.05, 0.05);
    material.alpha = 0.7;
    this.serverShadow.material = material;

    this.serverShadow.setEnabled(false);
  }

  private loadZone(zoneId: string): boolean {
    if (!this.scene) {
      return false;
    }

    const zoneDefinition = getZoneDefinition(zoneId);
    if (!zoneDefinition) {
      return false;
    }

    this.zoneDefinition = zoneDefinition;

    console.log('Creating ground, grid lines, terrain objects');
    const ground = this.createGround();
    this.createGridLines(ground);
    this.createTerrainObjects(zoneDefinition);
    console.log(`Zone "${zoneDefinition.name}" loaded into scene`);
    return true;
  }

  private createTerrainObjects(zoneDefinition: ZoneDefinition): void {
    if (!this.scene || !this.camera || !this.uiLayer) {
      return;
    }

    for (const objDef of zoneDefinition.sceneData.terrainObjects) {
      new ObjEntity(this.scene, {
        id: objDef.id,
        x: objDef.x,
        z: objDef.z,
        y: objDef.y ?? 0,
        shape: objDef.shape,
        size: objDef.size,
        color: new Color3(objDef.color.r, objDef.color.g, objDef.color.b),
        label: objDef.label,
        uiLayer: this.uiLayer,
      });
    }
  }

  private createGround(): GroundMesh {
    if (!this.scene) {
      throw new Error('Scene not initialized');
    }

    const groundColor = this.zoneDefinition?.sceneData.ground.color;
    const ground = MeshBuilder.CreateGround(
      'ground',
      {
        width: this.zoneDefinition?.sceneData.width,
        height: this.zoneDefinition?.sceneData.height,
      },
      this.scene
    );
    ground.isPickable = true;

    const groundMaterial = new StandardMaterial('groundMaterial', this.scene);
    groundMaterial.diffuseColor = new Color3(
      groundColor?.r ?? 0,
      groundColor?.g ?? 0,
      groundColor?.b ?? 0
    );
    groundMaterial.specularColor = new Color3(0.05, 0.05, 0.1);
    ground.material = groundMaterial;
    this.groundMesh = ground;

    return ground;
  }

  private createGridLines(ground: GroundMesh): void {
    const gridSize = this.zoneDefinition?.sceneData.ground.gridSize;
    if (!gridSize || gridSize <= 0) {
      return;
    }

    const halfHeight = (this.zoneDefinition?.sceneData.height ?? 0) / 2;
    const halfWidth = (this.zoneDefinition?.sceneData.width ?? 0) / 2;

    const gridColorDef = this.zoneDefinition?.sceneData.ground.gridColor ?? {
      r: 0.25,
      g: 0.25,
      b: 0.35,
    };
    const lineColor = new Color3(gridColorDef.r, gridColorDef.g, gridColorDef.b);

    if (!this.scene) {
      return;
    }

    const lineMaterial = new StandardMaterial('lineMaterial', this.scene);
    lineMaterial.diffuseColor = lineColor;
    lineMaterial.emissiveColor = lineColor;

    const grid = new TransformNode('grid', this.scene);
    grid.parent = ground;

    for (let i = -halfHeight; i <= halfHeight; i += gridSize) {
      const lineX = MeshBuilder.CreateLines(
        `gridX_${i}`,
        {
          points: [new Vector3(-halfWidth, 0.01, i), new Vector3(halfWidth, 0.01, i)],
        },
        this.scene
      );
      lineX.parent = grid;
      lineX.material = lineMaterial;
      lineX.color = lineColor;
    }

    for (let i = -halfWidth; i <= halfWidth; i += gridSize) {
      const lineZ = MeshBuilder.CreateLines(
        `gridZ_${i}`,
        {
          points: [new Vector3(i, 0.01, -halfHeight), new Vector3(i, 0.01, halfHeight)],
        },
        this.scene
      );
      lineZ.parent = grid;
      lineZ.material = lineMaterial;
      lineZ.color = lineColor;
    }
  }

  private createLighting(): void {
    if (!this.scene) {
      return;
    }

    const hemisphericLight = new HemisphericLight(
      'hemisphericLight',
      new Vector3(0, 1, 0),
      this.scene
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

    console.debug('Player added', { playerId });
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
        this.navmeshQuery,
        () => {
          this.handleMovementStart();
        }
      );
      this.localMovement.setCamera(this.camera);
      this.hotbar = new HotbarController(this.services.input, 8);
      this.hotbar.setSlotAction(0, {
        type: 'ability',
        abilityId: 'quick_dart',
      });
      this.hotbar.setSlotAction(1, {
        type: 'ability',
        abilityId: 'shield_bash',
      });
      this.hotbar.setSlotAction(2, {
        type: 'ability',
        abilityId: 'fireball',
      });
      this.hotbar.setSlotAction(3, {
        type: 'ability',
        abilityId: 'sky_sword',
      });
      this.hotbar.setSlotAction(4, {
        type: 'ability',
        abilityId: 'ice_storm',
      });
      this.hotbar.setSlotAction(5, {
        type: 'ability',
        abilityId: 'overgrowth',
      });
      this.hotbar.setSlotAction(6, {
        type: 'ability',
        abilityId: 'cleave_line',
      });
      this.hotbar.setSlotAction(7, {
        type: 'ability',
        abilityId: 'radiant_pulse',
      });

      this.combatController = new CombatController(entity, this.services.zoneNetwork);
      this.services.hotbarViewModel.bind(this.hotbar, this.combatController);
      this.groundTargetingController?.setCombatController(this.combatController);
      this.hotbar.onSlotActivated((_slot, action) => {
        if (action.type !== 'ability') {
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

        if (ability.targetType === 'ground' || ability.directionMode === 'cursor') {
          const combatController = this.combatController;
          if (!combatController) {
            return;
          }
          const nowMs = Date.now();
          if (!combatController.getPredictionState().canBufferAbility(ability, nowMs)) {
            return;
          }
          groundTargeting?.beginTargeting(ability.id);
          return;
        }

        const context = this.buildAutoTargetContext(ability);
        if (context === undefined && ability.targetType !== 'self') {
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
      const override = nudge
        ? { x: player.x + nudge.x, y: player.y, z: player.z + nudge.z }
        : undefined;
      this.localMovement?.reconcileFromServerState(player, override);
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

    this.combatController.cancelActiveCast('movement');
  }

  private buildAutoTargetContext(ability: AbilityDefinition): AbilityUseContext | undefined {
    if (ability.targetType === 'ground') {
      return;
    }

    if (ability.targetType === 'self') {
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
    console.debug('Queued reconcile nudge', this.pendingReconcileNudge);
  }

  private handlePlayerRemoved(playerId: string): void {
    const entity = this.players.get(playerId);
    if (!entity) {
      return;
    }

    console.debug('Player removed', { playerId });
    this.targetingController?.clearTargetIfMatches(playerId);
    entity.dispose();
    this.players.delete(playerId);
    if (entity.isLocal) {
      this.localPlayer = undefined;
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

    console.debug('Npc removed', { npcId });
    this.targetingController?.clearTargetIfMatches(npcId);
    entity.dispose();
    this.npcs.delete(npcId);
  }

  private handlePlayerSnap(snap: SnapMessage): void {
    if (!this.localPlayer) {
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
      const isOnNavmesh = navmesh.isPointOnNavmesh(position.x, position.z);
      const nearest = navmesh.findNearestPoint(position.x, position.z, maxDistance);
      if (!nearest) {
        return {
          playerX: position.x,
          playerY: position.y,
          playerZ: position.z,
          isOnNavmesh,
          maxDistance,
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

      const prediction = controller.getPredictionState();
      const nowMs = Date.now();
      const lastAck = controller.getLastAck();
      const target = this.targetingController?.getCurrentTarget();
      const targetPosition = target?.getPosition();
      let targetAggro: CombatDebugData['targetAggro'];

      if (target && 'combatState' in target.sync) {
        const combatState = (target.sync as NPCState).combatState;
        if (combatState) {
          const entries: NonNullable<CombatDebugData['targetAggro']> = [];
          for (const [id, entry] of combatState.aggro.entries()) {
            entries.push({ id, percent: entry.percent });
          }
          entries.sort((a, b) => b.percent - a.percent || a.id.localeCompare(b.id));
          targetAggro = entries;
        }
      }

      return {
        gcdRemainingMs: Math.max(0, prediction.predictedGcdEndTimeMs - nowMs),
        internalCooldownRemainingMs: Math.max(
          0,
          prediction.predictedInternalCooldownEndTimeMs - nowMs
        ),
        queuedAbilityId: prediction.queuedAbilityId,
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
        (node) => node.allocated && node.ref === nearest.nodeRef
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
      return 'Unknown';
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
      effect.outcome === 'crit',
      effect.targetId
    );
  }

  private resolveAbilityName(abilityId: string): string {
    if (!abilityId) {
      return 'Unknown';
    }

    const ability = ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS];
    return ability?.name ?? abilityId;
  }
}
