import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { KeyboardEventTypes, type KeyboardInfo } from '@babylonjs/core/Events/keyboardEvents';
import { PointerEventTypes, type PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';
import { Control } from '@babylonjs/gui/2D/controls/control';
import type { NavMesh } from 'navcat';
import type { InputManager } from '../input/input-manager';
import type { UiLayer } from '../ui/ui-layer';
import { createNavMeshPolyHelper, type DebugObject } from '../zone/navcat-debug';

// Side-effect import
import '@babylonjs/core/Culling/ray';

const inspectorEnabled = import.meta.env.VITE_ENABLE_INSPECTOR === 'true';

const loadInspectorLib = () => import('@babylonjs/inspector');

export interface NavmeshProbeData {
  playerX: number;
  playerY: number;
  playerZ: number;
  isOnNavmesh: boolean;
  maxDistance: number;
  move?: {
    requested: number;
    actual: number;
    ratio: number;
    collided: boolean;
    nodeRef?: number;
  };
  nearest?: {
    x: number;
    y: number;
    z: number;
    nodeRef: number;
    distanceXZ: number;
    distanceY: number;
  };
}

export interface NavmeshInspectData {
  clickX: number;
  clickY: number;
  clickZ: number;
  isOnNavmesh: boolean;
  maxDistance: number;
  navmesh?: NavMesh;
  nodeRef?: number;
  polyInfo?: {
    tileId: number;
    polyIndex: number;
    neighbors: number[];
  };
  nearest?: {
    x: number;
    y: number;
    z: number;
    nodeRef: number;
    distanceXZ: number;
    distanceY: number;
  };
}

export interface PlayerInputDebugData {
  serverTick: number;
  pendingInputs: number;
  processedInputs: number;
  droppedInputs: number;
  remainingInputs: number;
  budgetBefore: number;
  budgetAfter: number;
  clientPendingMoves?: number;
  clientLastAckedSeq?: number;
  clientReconcileDelta?: number;
  clientReconcileSnapped?: boolean;
  clientReconcileSeq?: number;
}

export interface MovementDebugData {
  pendingMoves: number;
  lastReconcileDelta: number;
  lastReconcileSnapped: boolean;
  lastReconcileSeq: number;
  navmeshMove?: {
    requested: number;
    actual: number;
    ratio: number;
    collided: boolean;
    nodeRef?: number;
  };
}

export interface CombatDebugData {
  gcdRemainingMs: number;
  internalCooldownRemainingMs: number;
  queuedAbilityId?: string;
  target?: {
    id: string;
    x: number;
    y: number;
    z: number;
  };
  targetAggro?: {
    id: string;
    percent: number;
  }[];
  lastAck?: {
    requestId: string;
    accepted: boolean;
    rejectReason?: string;
    serverTick: number;
    serverTimeMs: number;
    castStartTimeMs: number;
    castEndTimeMs: number;
  };
}

/**
 * Manages client-side debug toggles.
 */
export class DebugManager {
  private navmeshDebug?: DebugObject;
  private serverPositionVisualEnabled = false;
  private serverPositionToggleHandler?: (enabled: boolean) => void;
  private movementHud?: TextBlock;
  private movementDebugProvider?: () => MovementDebugData | undefined;
  private movementDebugEnabled = false;
  private movementDebugHud?: TextBlock;
  private playerSyncHud?: TextBlock;
  private movementMetricsProvider?: () => {
    pendingInputs: number;
    reconcileDistance: number;
  };
  private playerSyncProvider?: () =>
    | {
        x: number;
        y: number;
        z: number;
        lastProcessedSeq: number;
        serverTimeMs: number;
      }
    | undefined;
  private playerSyncEnabled = false;
  private playerInputDebugProvider?: () => PlayerInputDebugData | undefined;
  private playerInputDebugEnabled = false;
  private playerInputDebugHud?: TextBlock;
  private combatDebugProvider?: () => CombatDebugData | undefined;
  private combatDebugEnabled = false;
  private combatDebugHud?: TextBlock;
  private reconcileNudgeHandler?: () => void;
  private navmeshProbeProvider?: () => NavmeshProbeData | undefined;
  private navmeshProbeEnabled = false;
  private navmeshProbeHud?: TextBlock;
  private navmeshProbeLine?: LinesMesh;
  private navmeshProbePoint?: Mesh;
  private navmeshInspectProvider?: (point: Vector3) => NavmeshInspectData | undefined;
  private navmeshInspectEnabled = false;
  private navmeshInspectHud?: TextBlock;
  private navmeshInspectLine?: LinesMesh;
  private navmeshInspectClickPoint?: Mesh;
  private navmeshInspectNearestPoint?: Mesh;
  private navmeshInspectPoly?: DebugObject;
  private navmeshInspectEdges?: LinesMesh;
  private navmeshInspectNeighborPolys: DebugObject[] = [];
  private keyboardObserver?: Observer<KeyboardInfo>;
  private pointerObserver?: Observer<PointerInfo>;
  private beforeRenderObserver?: Observer<Scene>;

  constructor(
    private scene: Scene,
    private input: InputManager,
    private uiLayer: UiLayer
  ) {
    this.bindDebugToggle();
    this.bindInspectPick();
    this.bindHudUpdate();
  }

  setNavmeshDebug(debugObject?: DebugObject): void {
    this.navmeshDebug = debugObject;
  }

  setServerPositionToggleHandler(handler?: (enabled: boolean) => void): void {
    this.serverPositionToggleHandler = handler;
    this.serverPositionToggleHandler?.(this.serverPositionVisualEnabled);
  }
  /**
   * Registers a provider for movement debug metrics.
   *
   * @param provider - callback returning metrics.
   */
  setMovementMetricsProvider(
    provider?: () => { pendingInputs: number; reconcileDistance: number }
  ): void {
    this.movementMetricsProvider = provider;
  }

  /**
   * Registers a provider for client movement debug data.
   */
  setMovementDebugProvider(provider?: () => MovementDebugData | undefined): void {
    this.movementDebugProvider = provider;
  }

  /**
   * Registers a provider for synced player debug data.
   *
   * @param provider - callback returning synced player info.
   */
  setPlayerSyncProvider(
    provider?: () =>
      | {
          x: number;
          y: number;
          z: number;
          lastProcessedSeq: number;
          serverTimeMs: number;
        }
      | undefined
  ): void {
    this.playerSyncProvider = provider;
  }

  /**
   * Registers a provider for server input debug metrics.
   *
   * @param provider - callback returning server input debug info.
   */
  setPlayerInputDebugProvider(provider?: () => PlayerInputDebugData | undefined): void {
    this.playerInputDebugProvider = provider;
  }

  /**
   * Registers a provider for combat debug info.
   */
  setCombatDebugProvider(provider?: () => CombatDebugData | undefined): void {
    this.combatDebugProvider = provider;
  }

  setReconcileNudgeHandler(handler?: () => void): void {
    this.reconcileNudgeHandler = handler;
  }

  /**
   * Registers a provider for navmesh probe debug data.
   *
   * @param provider - callback returning probe data.
   */
  setNavmeshProbeProvider(provider?: () => NavmeshProbeData | undefined): void {
    this.navmeshProbeProvider = provider;
  }

  /**
   * Registers a provider for navmesh inspect data.
   *
   * @param provider - callback returning inspect data.
   */
  setNavmeshInspectProvider(provider?: (point: Vector3) => NavmeshInspectData | undefined): void {
    this.navmeshInspectProvider = provider;
  }

  /**
   * Binds keyboard input to toggle the debug layer.
   */
  private bindDebugToggle(): void {
    this.keyboardObserver = this.scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type !== KeyboardEventTypes.KEYDOWN) {
        return;
      }

      if (this.input.isChatInputFocused()) {
        return;
      }

      const key = kbInfo.event.key.toLowerCase();

      if (key === 'i') {
        if (kbInfo.event.shiftKey) {
          this.toggleNavmeshDebug();
          return;
        }

        if (!inspectorEnabled) {
          return;
        }

        void this.toggleInspector();
        return;
      }

      if (key === 'o') {
        this.toggleServerPositionVisuals();
        return;
      }

      if (key === 'm') {
        this.toggleMovementDebugHud();
        return;
      }

      if (key === 'c') {
        this.togglePlayerSyncHud();
        return;
      }

      if (key === 'b') {
        this.togglePlayerInputDebugHud();
        return;
      }

      if (key === 'g') {
        this.toggleCombatDebugHud();
        return;
      }

      if (key === 'r') {
        this.reconcileNudgeHandler?.();
        return;
      }

      if (key === 'p') {
        this.toggleNavmeshProbe();
        return;
      }

      if (key === 'k') {
        this.toggleNavmeshInspect();
      }
    });
  }

  private toggleNavmeshDebug(): void {
    if (!this.navmeshDebug) {
      return;
    }

    const navmeshNode = this.navmeshDebug.node;
    navmeshNode.setEnabled(!navmeshNode.isEnabled());
  }

  private async toggleInspector(): Promise<void> {
    if (inspectorEnabled) {
      await loadInspectorLib();
    }

    if (this.scene.debugLayer.isVisible()) {
      this.scene.debugLayer.hide();
    } else {
      this.scene.debugLayer.show();
    }
  }
  private togglePlayerSyncHud(): void {
    this.playerSyncEnabled = !this.playerSyncEnabled;
    if (!this.playerSyncEnabled) {
      this.disposePlayerSyncHud();
    }
  }

  private toggleMovementDebugHud(): void {
    this.movementDebugEnabled = !this.movementDebugEnabled;
    if (!this.movementDebugEnabled) {
      this.disposeMovementDebugHud();
    }
  }

  private togglePlayerInputDebugHud(): void {
    this.playerInputDebugEnabled = !this.playerInputDebugEnabled;
    if (!this.playerInputDebugEnabled) {
      this.disposePlayerInputDebugHud();
    }
  }

  private toggleCombatDebugHud(): void {
    this.combatDebugEnabled = !this.combatDebugEnabled;
    if (!this.combatDebugEnabled) {
      this.disposeCombatDebugHud();
    }
  }

  private toggleServerPositionVisuals(): void {
    this.serverPositionVisualEnabled = !this.serverPositionVisualEnabled;
    this.serverPositionToggleHandler?.(this.serverPositionVisualEnabled);
  }

  private toggleNavmeshProbe(): void {
    this.navmeshProbeEnabled = !this.navmeshProbeEnabled;
    if (!this.navmeshProbeEnabled) {
      this.setNavmeshProbeVisible(false);
      this.disposeNavmeshProbeHud();
    }
  }

  private toggleNavmeshInspect(): void {
    this.navmeshInspectEnabled = !this.navmeshInspectEnabled;
    if (!this.navmeshInspectEnabled) {
      this.clearNavmeshInspect();
      return;
    }

    this.showNavmeshInspectHint();
  }

  private bindInspectPick(): void {
    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) {
        return;
      }

      if (!this.navmeshInspectEnabled || !this.navmeshInspectProvider) {
        return;
      }

      if (pointerInfo.event.button !== 0) {
        return;
      }

      if (this.input.isChatInputFocused()) {
        return;
      }

      const pick = this.scene.pick(
        this.scene.pointerX,
        this.scene.pointerY,
        (mesh) =>
          mesh.isPickable &&
          !mesh.name.startsWith('navmeshProbe') &&
          !mesh.name.startsWith('navmeshInspect') &&
          !mesh.name.startsWith('navcat_debug')
      );

      if (pick?.hit && pick.pickedPoint) {
        const result = this.navmeshInspectProvider(pick.pickedPoint);
        this.setNavmeshInspectResult(result);
        return;
      }

      const camera = this.scene.activeCamera;
      if (!camera) {
        return;
      }

      const ray = this.scene.createPickingRay(
        this.scene.pointerX,
        this.scene.pointerY,
        Matrix.Identity(),
        camera
      );
      const dirY = ray.direction.y;
      if (Math.abs(dirY) < 0.0001) {
        return;
      }

      const t = -ray.origin.y / dirY;
      if (t < 0) {
        return;
      }

      const point = ray.origin.add(ray.direction.scale(t));
      const result = this.navmeshInspectProvider(point);
      this.setNavmeshInspectResult(result);
    });
  }

  private bindHudUpdate(): void {
    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.updateMovementHud();
      this.updateMovementDebugHud();
      this.updatePlayerSyncHud();
      this.updatePlayerInputDebugHud();
      this.updateCombatDebugHud();
      this.updateNavmeshProbe();
      this.updateNavmeshInspectState();
    });
  }

  private updateMovementHud(): void {
    if (!this.movementMetricsProvider) {
      this.disposeMovementHud();
      return;
    }

    const metrics = this.movementMetricsProvider();
    if (!this.movementHud) {
      this.movementHud = this.createMovementHud();
    }

    this.movementHud.text =
      `Pending: ${metrics.pendingInputs}\n` + `Reconcile: ${metrics.reconcileDistance.toFixed(3)}`;
  }

  private updateMovementDebugHud(): void {
    if (!this.movementDebugEnabled || !this.movementDebugProvider) {
      this.disposeMovementDebugHud();
      return;
    }

    const data = this.movementDebugProvider();
    if (!data) {
      this.disposeMovementDebugHud();
      return;
    }

    if (!this.movementDebugHud) {
      this.movementDebugHud = this.createMovementDebugHud();
    }

    const navmeshMove = data.navmeshMove;
    const lines: string[] = [
      'Movement Debug',
      `PendingMoves: ${data.pendingMoves}`,
      `ReplayΔ: ${this.formatFloat(data.lastReconcileDelta)} ` +
        `Snap: ${data.lastReconcileSnapped ? 'yes' : 'no'}`,
      `ReplaySeq: ${data.lastReconcileSeq}`,
      ...(navmeshMove
        ? [
            `Move: req ${this.formatFloat(navmeshMove.requested)} ` +
              `act ${this.formatFloat(navmeshMove.actual)} ` +
              `ratio ${this.formatFloat(navmeshMove.ratio)}`,
            `MoveCollide: ${navmeshMove.collided ? 'yes' : 'no'}`,
            ...(typeof navmeshMove.nodeRef === 'number'
              ? [`MoveNode: ${navmeshMove.nodeRef}`]
              : []),
          ]
        : []),
    ];

    this.movementDebugHud.text = lines.join('\n');
  }

  private updatePlayerSyncHud(): void {
    if (!this.playerSyncEnabled || !this.playerSyncProvider) {
      this.disposePlayerSyncHud();
      return;
    }

    const data = this.playerSyncProvider();
    if (!data) {
      this.disposePlayerSyncHud();
      return;
    }

    if (!this.playerSyncHud) {
      this.playerSyncHud = this.createPlayerSyncHud();
    }

    this.playerSyncHud.text =
      `Synced\n` +
      `Pos: ${this.formatFloat(data.x)} ` +
      `${this.formatFloat(data.y)} ` +
      `${this.formatFloat(data.z)}\n` +
      `Seq: ${data.lastProcessedSeq}\n` +
      `ServerMs: ${Math.round(data.serverTimeMs)}\n`;
  }

  private updatePlayerInputDebugHud(): void {
    if (!this.playerInputDebugEnabled || !this.playerInputDebugProvider) {
      this.disposePlayerInputDebugHud();
      return;
    }

    const data = this.playerInputDebugProvider();
    if (!data) {
      this.disposePlayerInputDebugHud();
      return;
    }

    if (!this.playerInputDebugHud) {
      this.playerInputDebugHud = this.createPlayerInputDebugHud();
    }

    const lines: string[] = [
      'Input Debug',
      `Tick: ${data.serverTick}`,
      `Pending: ${data.pendingInputs} ` + `Processed: ${data.processedInputs}`,
      '',
      `Dropped: ${data.droppedInputs} ` + `Remaining: ${data.remainingInputs}`,
      `Budget: ${data.budgetBefore} -> ${data.budgetAfter}`,
      ...(typeof data.clientPendingMoves === 'number'
        ? [`ClientPending: ${data.clientPendingMoves} ` + `Acked: ${data.clientLastAckedSeq ?? 0}`]
        : []),
      ...(typeof data.clientReconcileDelta === 'number'
        ? [
            `ReplayΔ: ${this.formatFloat(data.clientReconcileDelta)} ` +
              `Snap: ${data.clientReconcileSnapped ? 'yes' : 'no'}`,
          ]
        : []),
      ...(typeof data.clientReconcileSeq === 'number'
        ? [`ReplaySeq: ${data.clientReconcileSeq}`]
        : []),
    ];

    this.playerInputDebugHud.text = lines.join('\n');
  }

  private updateCombatDebugHud(): void {
    if (!this.combatDebugEnabled || !this.combatDebugProvider) {
      this.disposeCombatDebugHud();
      return;
    }

    const data = this.combatDebugProvider();
    if (!data) {
      this.disposeCombatDebugHud();
      return;
    }

    if (!this.combatDebugHud) {
      this.combatDebugHud = this.createCombatDebugHud();
    }

    const target = data.target;
    const lastAck = data.lastAck;
    const targetAggro = data.targetAggro;
    const lines: string[] = [
      'Combat Debug',
      `GCD: ${Math.max(0, Math.round(data.gcdRemainingMs))}ms ` +
        `(${this.formatFloat(data.gcdRemainingMs / 1000)}s)`,
      `ICD: ${Math.max(0, Math.round(data.internalCooldownRemainingMs))}ms ` +
        `(${this.formatFloat(data.internalCooldownRemainingMs / 1000)}s)`,
      `Buffered: ${data.queuedAbilityId ?? 'none'}`,
      ...(target
        ? [
            `Target: ${target.id}`,
            `TargetPos: ${this.formatFloat(target.x)} ` +
              `${this.formatFloat(target.y)} ` +
              `${this.formatFloat(target.z)}`,
          ]
        : ['Target: none']),
      ...(lastAck
        ? [
            `Ack: ${lastAck.requestId} ` + `${lastAck.accepted ? 'ok' : 'rej'}`,
            ...(lastAck.accepted ? [] : [`Reject: ${lastAck.rejectReason ?? 'unknown'}`]),
            `AckTick: ${lastAck.serverTick}`,
            `AckServerMs: ${Math.round(lastAck.serverTimeMs)}`,
            `Cast: ${Math.round(lastAck.castStartTimeMs)} -> ` +
              `${Math.round(lastAck.castEndTimeMs)}`,
          ]
        : []),
      ...(targetAggro
        ? [
            '',
            ...(targetAggro.length === 0
              ? ['Aggro: none']
              : ['Aggro:', ...targetAggro.map((entry) => `Aggro ${entry.id}: ${entry.percent}%`)]),
          ]
        : []),
    ];

    this.combatDebugHud.text = lines.join('\n');
  }

  private updateNavmeshProbe(): void {
    if (!this.navmeshProbeEnabled || !this.navmeshProbeProvider) {
      this.setNavmeshProbeVisible(false);
      this.disposeNavmeshProbeHud();
      return;
    }

    const data = this.navmeshProbeProvider();
    if (!data) {
      this.setNavmeshProbeVisible(false);
      this.disposeNavmeshProbeHud();
      return;
    }

    if (!this.navmeshProbeHud) {
      this.navmeshProbeHud = this.createNavmeshProbeHud();
    }

    const nearest = data.nearest;
    const move = data.move;
    const lines: string[] = [
      'Navmesh Probe',
      `Player: ${this.formatFloat(data.playerX)} ` +
        `${this.formatFloat(data.playerY)} ` +
        `${this.formatFloat(data.playerZ)}`,
      `OnNavmesh: ${data.isOnNavmesh ? 'yes' : 'no'}`,
      ...(nearest
        ? [
            `Nearest: ${this.formatFloat(nearest.x)} ` +
              `${this.formatFloat(nearest.y)} ` +
              `${this.formatFloat(nearest.z)}`,
            `ΔXZ: ${this.formatFloat(nearest.distanceXZ)} ` +
              `ΔY: ${this.formatFloat(nearest.distanceY)}`,
            `NodeRef: ${nearest.nodeRef}`,
          ]
        : [`Nearest: none (max ${this.formatFloat(data.maxDistance)})`]),
      ...(move
        ? [
            `Move: req ${this.formatFloat(move.requested)} ` +
              `act ${this.formatFloat(move.actual)} ` +
              `ratio ${this.formatFloat(move.ratio)}`,
            `MoveCollide: ${move.collided ? 'yes' : 'no'}`,
            ...(typeof move.nodeRef === 'number' ? [`MoveNode: ${move.nodeRef}`] : []),
          ]
        : []),
    ];

    if (nearest) {
      this.updateNavmeshProbeMeshes(
        data.playerX,
        data.playerY,
        data.playerZ,
        nearest.x,
        nearest.y,
        nearest.z
      );
    } else {
      this.setNavmeshProbeVisible(false);
    }

    this.navmeshProbeHud.text = lines.join('\n');
  }

  private updateNavmeshInspectState(): void {
    if (!this.navmeshInspectEnabled || !this.navmeshInspectProvider) {
      this.clearNavmeshInspect();
    }
  }

  private setNavmeshInspectResult(result?: NavmeshInspectData): void {
    if (!this.navmeshInspectEnabled || !result) {
      this.clearNavmeshInspect();
      return;
    }

    if (!this.navmeshInspectHud) {
      this.navmeshInspectHud = this.createNavmeshInspectHud();
    }

    const nearest = result.nearest;
    const polyInfo = result.polyInfo;
    const nearestLines = nearest
      ? [
          `Nearest: ${this.formatFloat(nearest.x)} ` +
            `${this.formatFloat(nearest.y)} ` +
            `${this.formatFloat(nearest.z)}`,
          `ΔXZ: ${this.formatFloat(nearest.distanceXZ)} ` +
            `ΔY: ${this.formatFloat(nearest.distanceY)}`,
          `NodeRef: ${nearest.nodeRef}`,
        ]
      : [`Nearest: none (max ${this.formatFloat(result.maxDistance)})`];

    if (nearest) {
      this.updateNavmeshInspectMeshes(
        result.clickX,
        result.clickY,
        result.clickZ,
        nearest.x,
        nearest.y,
        nearest.z
      );
    } else {
      this.setNavmeshInspectVisible(false);
    }

    let polyInfoLines: string[] = [];
    if (polyInfo) {
      const boundaryEdges: number[] = [];
      const portalEdges: number[] = [];
      const internalEdges: number[] = [];
      for (let i = 0; i < polyInfo.neighbors.length; i += 1) {
        const nei = polyInfo.neighbors[i] ?? 0;
        if (nei === 0) {
          boundaryEdges.push(i);
        } else if ((nei & 0x80_00) === 0) {
          internalEdges.push(i);
        } else {
          portalEdges.push(i);
        }
      }
      polyInfoLines = [
        `Tile: ${polyInfo.tileId} Poly: ${polyInfo.polyIndex}`,
        `Neighbors: ${polyInfo.neighbors.join(', ')}`,
        `Edges B:${boundaryEdges.join(',') || '-'} ` +
          `P:${portalEdges.join(',') || '-'} ` +
          `I:${internalEdges.join(',') || '-'}`,
      ];
    }

    const lines: string[] = [
      'Navmesh Inspect (click)',
      `Click: ${this.formatFloat(result.clickX)} ` +
        `${this.formatFloat(result.clickY)} ` +
        `${this.formatFloat(result.clickZ)}`,
      `OnNavmesh: ${result.isOnNavmesh ? 'yes' : 'no'}`,
      ...nearestLines,
      ...polyInfoLines,
    ];

    this.navmeshInspectHud.text = lines.join('\n');

    if (result.navmesh && result.polyInfo && typeof result.nodeRef === 'number') {
      this.updateNavmeshInspectPoly(result.navmesh, result.nodeRef);
      this.updateNavmeshInspectEdges(
        result.navmesh,
        result.polyInfo.tileId,
        result.polyInfo.polyIndex
      );
      this.updateNavmeshInspectNeighborPolys(
        result.navmesh,
        result.polyInfo.tileId,
        result.polyInfo.neighbors
      );
    } else {
      this.disposeNavmeshInspectPoly();
      this.disposeNavmeshInspectEdges();
      this.disposeNavmeshInspectNeighborPolys();
    }
  }

  private showNavmeshInspectHint(): void {
    if (!this.navmeshInspectEnabled) {
      return;
    }

    if (!this.navmeshInspectHud) {
      this.navmeshInspectHud = this.createNavmeshInspectHud();
    }

    this.navmeshInspectHud.text = 'Navmesh Inspect (click)\n' + 'Click ground to inspect polygon';
  }

  private updateNavmeshProbeMeshes(
    playerX: number,
    playerY: number,
    playerZ: number,
    targetX: number,
    targetY: number,
    targetZ: number
  ): void {
    const start = new Vector3(playerX, playerY, playerZ);
    const end = new Vector3(targetX, targetY, targetZ);

    if (this.navmeshProbeLine) {
      MeshBuilder.CreateLines(
        'navmeshProbeLine',
        { points: [start, end], instance: this.navmeshProbeLine },
        this.scene
      );
    } else {
      this.navmeshProbeLine = MeshBuilder.CreateLines(
        'navmeshProbeLine',
        { points: [start, end] },
        this.scene
      );
      this.navmeshProbeLine.isPickable = false;
      this.navmeshProbeLine.color = new Color3(1, 0.85, 0.2);
      this.navmeshProbeLine.renderingGroupId = 1;
    }

    if (!this.navmeshProbePoint) {
      this.navmeshProbePoint = MeshBuilder.CreateSphere(
        'navmeshProbePoint',
        { diameter: 0.2 },
        this.scene
      );
      const mat = new StandardMaterial('navmeshProbePointMat', this.scene);
      mat.emissiveColor = new Color3(1, 0.8, 0.2);
      mat.diffuseColor = new Color3(1, 0.8, 0.2);
      this.navmeshProbePoint.material = mat;
      this.navmeshProbePoint.isPickable = false;
      this.navmeshProbePoint.renderingGroupId = 1;
    }

    this.navmeshProbePoint.position.set(targetX, targetY, targetZ);
    this.setNavmeshProbeVisible(true);
  }

  private setNavmeshProbeVisible(visible: boolean): void {
    this.navmeshProbeLine?.setEnabled(visible);
    this.navmeshProbePoint?.setEnabled(visible);
  }

  private updateNavmeshInspectMeshes(
    clickX: number,
    clickY: number,
    clickZ: number,
    targetX: number,
    targetY: number,
    targetZ: number
  ): void {
    const start = new Vector3(clickX, clickY, clickZ);
    const end = new Vector3(targetX, targetY, targetZ);

    if (this.navmeshInspectLine) {
      MeshBuilder.CreateLines(
        'navmeshInspectLine',
        { points: [start, end], instance: this.navmeshInspectLine },
        this.scene
      );
    } else {
      this.navmeshInspectLine = MeshBuilder.CreateLines(
        'navmeshInspectLine',
        { points: [start, end] },
        this.scene
      );
      this.navmeshInspectLine.isPickable = false;
      this.navmeshInspectLine.color = new Color3(0.2, 1, 0.6);
      this.navmeshInspectLine.renderingGroupId = 1;
    }

    if (!this.navmeshInspectClickPoint) {
      this.navmeshInspectClickPoint = MeshBuilder.CreateSphere(
        'navmeshInspectClickPoint',
        { diameter: 0.16 },
        this.scene
      );
      const mat = new StandardMaterial('navmeshInspectClickMat', this.scene);
      mat.emissiveColor = new Color3(0.2, 1, 0.6);
      mat.diffuseColor = new Color3(0.2, 1, 0.6);
      this.navmeshInspectClickPoint.material = mat;
      this.navmeshInspectClickPoint.isPickable = false;
      this.navmeshInspectClickPoint.renderingGroupId = 1;
    }

    if (!this.navmeshInspectNearestPoint) {
      this.navmeshInspectNearestPoint = MeshBuilder.CreateSphere(
        'navmeshInspectNearestPoint',
        { diameter: 0.2 },
        this.scene
      );
      const mat = new StandardMaterial('navmeshInspectNearestMat', this.scene);
      mat.emissiveColor = new Color3(0.2, 0.9, 1);
      mat.diffuseColor = new Color3(0.2, 0.9, 1);
      this.navmeshInspectNearestPoint.material = mat;
      this.navmeshInspectNearestPoint.isPickable = false;
      this.navmeshInspectNearestPoint.renderingGroupId = 1;
    }

    this.navmeshInspectClickPoint.position.set(clickX, clickY, clickZ);
    this.navmeshInspectNearestPoint.position.set(targetX, targetY, targetZ);
    this.setNavmeshInspectVisible(true);
  }

  private updateNavmeshInspectPoly(navmesh: NavMesh, nodeRef: number): void {
    if (this.navmeshInspectPoly) {
      this.navmeshInspectPoly.dispose();
      this.navmeshInspectPoly = undefined;
    }

    this.navmeshInspectPoly = createNavMeshPolyHelper(navmesh, nodeRef, this.scene);
    this.navmeshInspectPoly.node.setEnabled(true);
  }

  private updateNavmeshInspectEdges(navmesh: NavMesh, tileId: number, polyIndex: number): void {
    this.disposeNavmeshInspectEdges();

    const tile = navmesh.tiles?.[tileId] ?? navmesh.tiles?.[String(tileId)];
    if (!tile || !tile.polys || !tile.vertices) {
      return;
    }

    const poly = tile.polys[polyIndex];
    if (!poly || !poly.vertices || !poly.neis) {
      return;
    }

    const points: Vector3[][] = [];
    const colors: Color4[][] = [];
    const vert = tile.vertices;
    const vertexCount = poly.vertices.length;
    for (let i = 0; i < vertexCount; i += 1) {
      const v0 = poly.vertices[i];
      const v1 = poly.vertices[(i + 1) % vertexCount];
      const base0 = v0 * 3;
      const base1 = v1 * 3;
      if (base0 + 2 >= vert.length || base1 + 2 >= vert.length) {
        continue;
      }

      const p0 = new Vector3(vert[base0], vert[base0 + 1], vert[base0 + 2]);
      const p1 = new Vector3(vert[base1], vert[base1 + 1], vert[base1 + 2]);

      const nei = poly.neis[i] ?? 0;
      let color = new Color4(0.2, 0.9, 0.2, 1);
      if (nei === 0) {
        color = new Color4(1, 0.35, 0.35, 1);
      } else if ((nei & 0x80_00) !== 0) {
        color = new Color4(1, 0.7, 0.2, 1);
      }

      points.push([p0, p1]);
      colors.push([color, color]);
    }

    this.navmeshInspectEdges = MeshBuilder.CreateLineSystem(
      'navmeshInspectEdges',
      { lines: points, colors },
      this.scene
    );
    this.navmeshInspectEdges.isPickable = false;
    this.navmeshInspectEdges.renderingGroupId = 1;
  }

  private updateNavmeshInspectNeighborPolys(
    navmesh: NavMesh,
    tileId: number,
    neighbors: number[]
  ): void {
    this.disposeNavmeshInspectNeighborPolys();

    const tile = navmesh.tiles?.[tileId] ?? navmesh.tiles?.[String(tileId)];
    if (!tile || !tile.polys) {
      return;
    }

    const uniquePolyIndexes = new Set<number>();
    for (const nei of neighbors) {
      if (!nei || (nei & 0x80_00) !== 0) {
        continue;
      }
      const polyIndex = nei - 1;
      if (polyIndex >= 0) {
        uniquePolyIndexes.add(polyIndex);
      }
    }

    if (uniquePolyIndexes.size === 0) {
      return;
    }

    const nodeRefs = new Map<number, number>();
    for (const node of navmesh.nodes) {
      if (node.allocated && node.tileId === tileId) {
        nodeRefs.set(node.polyIndex, node.ref);
      }
    }

    for (const polyIndex of uniquePolyIndexes) {
      const ref = nodeRefs.get(polyIndex);
      if (ref === undefined) {
        continue;
      }
      this.navmeshInspectNeighborPolys.push(
        createNavMeshPolyHelper(navmesh, ref, this.scene, [0.1, 0.6, 1])
      );
    }
  }

  private disposeNavmeshInspectEdges(): void {
    if (!this.navmeshInspectEdges) {
      return;
    }

    this.navmeshInspectEdges.dispose();
    this.navmeshInspectEdges = undefined;
  }

  private disposeNavmeshInspectNeighborPolys(): void {
    if (this.navmeshInspectNeighborPolys.length === 0) {
      return;
    }

    for (const poly of this.navmeshInspectNeighborPolys) {
      poly.dispose();
    }
    this.navmeshInspectNeighborPolys = [];
  }

  private disposeNavmeshInspectPoly(): void {
    if (!this.navmeshInspectPoly) {
      return;
    }

    this.navmeshInspectPoly.dispose();
    this.navmeshInspectPoly = undefined;
  }

  private setNavmeshInspectVisible(visible: boolean): void {
    this.navmeshInspectLine?.setEnabled(visible);
    this.navmeshInspectClickPoint?.setEnabled(visible);
    this.navmeshInspectNearestPoint?.setEnabled(visible);
  }

  private disposeNavmeshProbeMeshes(): void {
    if (this.navmeshProbeLine) {
      this.navmeshProbeLine.dispose();
      this.navmeshProbeLine = undefined;
    }
    if (this.navmeshProbePoint) {
      this.navmeshProbePoint.dispose();
      this.navmeshProbePoint = undefined;
    }
  }

  private disposeNavmeshInspectMeshes(): void {
    if (this.navmeshInspectLine) {
      this.navmeshInspectLine.dispose();
      this.navmeshInspectLine = undefined;
    }
    if (this.navmeshInspectClickPoint) {
      this.navmeshInspectClickPoint.dispose();
      this.navmeshInspectClickPoint = undefined;
    }
    if (this.navmeshInspectNearestPoint) {
      this.navmeshInspectNearestPoint.dispose();
      this.navmeshInspectNearestPoint = undefined;
    }
  }

  private createMovementHud(): TextBlock {
    const hud = new TextBlock('movementHud');
    hud.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    hud.color = '#e6f1ff';
    hud.fontSize = 14;
    hud.fontFamily = 'JetBrains Mono, Consolas, Menlo, monospace';
    hud.paddingLeft = '12px';
    hud.paddingTop = '10px';
    hud.shadowColor = '#000000';
    hud.shadowBlur = 4;
    hud.shadowOffsetX = 1;
    hud.shadowOffsetY = 1;

    this.uiLayer.addControl(hud);
    return hud;
  }

  private createMovementDebugHud(): TextBlock {
    const hud = new TextBlock('movementDebugHud');
    hud.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    hud.color = '#c6ffd9';
    hud.fontSize = 14;
    hud.fontFamily = 'JetBrains Mono, Consolas, Menlo, monospace';
    hud.paddingLeft = '12px';
    hud.paddingTop = '240px';
    hud.shadowColor = '#000000';
    hud.shadowBlur = 4;
    hud.shadowOffsetX = 1;
    hud.shadowOffsetY = 1;

    this.uiLayer.addControl(hud);
    return hud;
  }

  private createPlayerSyncHud(): TextBlock {
    const hud = new TextBlock('playerSyncHud');
    hud.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    hud.color = '#c2f2ff';
    hud.fontSize = 14;
    hud.fontFamily = 'JetBrains Mono, Consolas, Menlo, monospace';
    hud.paddingLeft = '12px';
    hud.paddingTop = '40px';
    hud.shadowColor = '#000000';
    hud.shadowBlur = 4;
    hud.shadowOffsetX = 1;
    hud.shadowOffsetY = 1;

    this.uiLayer.addControl(hud);
    return hud;
  }

  private createPlayerInputDebugHud(): TextBlock {
    const hud = new TextBlock('playerInputDebugHud');
    hud.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    hud.color = '#ffd6a5';
    hud.fontSize = 14;
    hud.fontFamily = 'JetBrains Mono, Consolas, Menlo, monospace';
    hud.paddingLeft = '12px';
    hud.paddingTop = '110px';
    hud.shadowColor = '#000000';
    hud.shadowBlur = 4;
    hud.shadowOffsetX = 1;
    hud.shadowOffsetY = 1;

    this.uiLayer.addControl(hud);
    return hud;
  }

  private createCombatDebugHud(): TextBlock {
    const hud = new TextBlock('combatDebugHud');
    hud.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    hud.color = '#f6cfa8';
    hud.fontSize = 14;
    hud.fontFamily = 'JetBrains Mono, Consolas, Menlo, monospace';
    hud.paddingLeft = '12px';
    hud.paddingTop = '170px';
    hud.shadowColor = '#000000';
    hud.shadowBlur = 4;
    hud.shadowOffsetX = 1;
    hud.shadowOffsetY = 1;

    this.uiLayer.addControl(hud);
    return hud;
  }

  private createNavmeshProbeHud(): TextBlock {
    const hud = new TextBlock('navmeshProbeHud');
    hud.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    hud.color = '#f7d48a';
    hud.fontSize = 14;
    hud.fontFamily = 'JetBrains Mono, Consolas, Menlo, monospace';
    hud.paddingLeft = '12px';
    hud.paddingTop = '70px';
    hud.shadowColor = '#000000';
    hud.shadowBlur = 4;
    hud.shadowOffsetX = 1;
    hud.shadowOffsetY = 1;

    this.uiLayer.addControl(hud);
    return hud;
  }

  private createNavmeshInspectHud(): TextBlock {
    const hud = new TextBlock('navmeshInspectHud');
    hud.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    hud.color = '#9ff1d4';
    hud.fontSize = 14;
    hud.fontFamily = 'JetBrains Mono, Consolas, Menlo, monospace';
    hud.paddingLeft = '12px';
    hud.paddingTop = '170px';
    hud.shadowColor = '#000000';
    hud.shadowBlur = 4;
    hud.shadowOffsetX = 1;
    hud.shadowOffsetY = 1;

    this.uiLayer.addControl(hud);
    return hud;
  }

  private disposeMovementHud(): void {
    if (!this.movementHud) {
      return;
    }

    this.uiLayer.removeControl(this.movementHud);
    this.movementHud.dispose();
    this.movementHud = undefined;
  }

  private disposeMovementDebugHud(): void {
    if (!this.movementDebugHud) {
      return;
    }

    this.uiLayer.removeControl(this.movementDebugHud);
    this.movementDebugHud.dispose();
    this.movementDebugHud = undefined;
  }

  private disposePlayerSyncHud(): void {
    if (!this.playerSyncHud) {
      return;
    }

    this.uiLayer.removeControl(this.playerSyncHud);
    this.playerSyncHud.dispose();
    this.playerSyncHud = undefined;
  }

  private disposePlayerInputDebugHud(): void {
    if (!this.playerInputDebugHud) {
      return;
    }

    this.uiLayer.removeControl(this.playerInputDebugHud);
    this.playerInputDebugHud.dispose();
    this.playerInputDebugHud = undefined;
  }

  private disposeCombatDebugHud(): void {
    if (!this.combatDebugHud) {
      return;
    }

    this.uiLayer.removeControl(this.combatDebugHud);
    this.combatDebugHud.dispose();
    this.combatDebugHud = undefined;
  }

  private disposeNavmeshProbeHud(): void {
    if (!this.navmeshProbeHud) {
      return;
    }

    this.uiLayer.removeControl(this.navmeshProbeHud);
    this.navmeshProbeHud.dispose();
    this.navmeshProbeHud = undefined;
  }

  private disposeNavmeshInspectHud(): void {
    if (!this.navmeshInspectHud) {
      return;
    }

    this.uiLayer.removeControl(this.navmeshInspectHud);
    this.navmeshInspectHud.dispose();
    this.navmeshInspectHud = undefined;
  }

  private clearNavmeshInspect(): void {
    this.setNavmeshInspectVisible(false);
    this.disposeNavmeshInspectHud();
    this.disposeNavmeshInspectPoly();
    this.disposeNavmeshInspectEdges();
    this.disposeNavmeshInspectNeighborPolys();
  }

  private formatFloat(value: number): string {
    return value.toFixed(2);
  }

  dispose(): void {
    if (this.keyboardObserver) {
      this.scene.onKeyboardObservable.remove(this.keyboardObserver);
      this.keyboardObserver = undefined;
    }
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = undefined;
    }
    if (this.beforeRenderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
      this.beforeRenderObserver = undefined;
    }

    this.movementDebugEnabled = false;
    this.playerSyncEnabled = false;
    this.playerInputDebugEnabled = false;
    this.combatDebugEnabled = false;
    this.navmeshProbeEnabled = false;
    this.navmeshInspectEnabled = false;
    this.serverPositionVisualEnabled = false;
    this.serverPositionToggleHandler = undefined;
    this.reconcileNudgeHandler = undefined;
    this.movementMetricsProvider = undefined;
    this.movementDebugProvider = undefined;
    this.playerSyncProvider = undefined;
    this.playerInputDebugProvider = undefined;
    this.combatDebugProvider = undefined;
    this.navmeshProbeProvider = undefined;
    this.navmeshInspectProvider = undefined;
    this.navmeshDebug = undefined;

    this.disposeMovementHud();
    this.disposeMovementDebugHud();
    this.disposePlayerSyncHud();
    this.disposePlayerInputDebugHud();
    this.disposeCombatDebugHud();
    this.disposeNavmeshProbeHud();
    this.disposeNavmeshProbeMeshes();
    this.clearNavmeshInspect();
    this.disposeNavmeshInspectMeshes();
  }
}
