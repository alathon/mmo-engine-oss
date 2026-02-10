import type { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { InputHandler } from '../input/input-handler';
import type { InputManager, PointerClick } from '../input/input-manager';
import type { ZoneConnectionManager } from '../network/zone-connection-manager';
import type { PlayerEntity } from '../entities/player-entity';
import type { NpcEntity } from '../entities/npc-entity';
import { MobEntity } from '../entities/mob-entity';

export interface TargetingWorld {
  getScene(): Scene | undefined;
  getLocalPlayer(): PlayerEntity | undefined;
  getPlayerEntities(): Iterable<PlayerEntity>;
  getNpcEntities(): Iterable<NpcEntity>;
  getMobById(id: string): MobEntity | undefined;
}

export class TargetingController implements InputHandler {
  priority = 50;
  private currentTargetId?: string;
  private indicator?: Mesh;
  private indicatorMaterial?: StandardMaterial;
  private indicatorInLos?: boolean;

  // Babylon's API uses null for parent clearing; lint forbids null so we pass undefined.
  private clearIndicatorParent(indicator: AbstractMesh): void {
    indicator.setParent(undefined as unknown as AbstractMesh);
  }

  private static readonly IN_LOS_DIFFUSE = new Color3(0.9, 0.1, 0.1);
  private static readonly IN_LOS_EMISSIVE = new Color3(0.4, 0.05, 0.05);
  private static readonly OUT_LOS_DIFFUSE = new Color3(0.2, 0.2, 0.2);
  private static readonly OUT_LOS_EMISSIVE = new Color3(0.08, 0.08, 0.08);

  constructor(
    private readonly world: TargetingWorld,
    private readonly zoneNetwork: ZoneConnectionManager
  ) {}

  enabled(): boolean {
    return !!this.world.getScene() && !!this.world.getLocalPlayer();
  }

  handleTick(input: InputManager): void {
    if (!this.enabled()) {
      return;
    }
    if (input.isChatInputFocused()) {
      return;
    }
    if (input.consumeKeyPress('escape')) {
      this.clearTarget();
      return;
    }
    if (!input.consumeKeyPress('tab')) {
      return;
    }

    const candidates = this.getTargetCandidates();
    if (candidates.length === 0) {
      this.clearTarget();
      return;
    }

    const currentId = this.currentTargetId;
    const currentIndex = currentId
      ? candidates.findIndex((candidate) => candidate.getId() === currentId)
      : -1;
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % candidates.length : 0;
    this.setCurrentTargetId(candidates[nextIndex].getId());
  }

  handleFrame(): void {
    this.updateIndicatorLoS();
  }

  handlePointerClick(click: PointerClick): boolean {
    if (!this.enabled()) {
      return false;
    }
    if (click.button !== 0) {
      return false;
    }

    const scene = this.world.getScene();
    if (!scene) {
      return false;
    }

    const pick = scene.pick(click.x, click.y);
    if (!pick?.hit || !pick.pickedMesh) {
      this.clearTarget();
      return false;
    }

    const target = this.resolveMobEntityFromMesh(pick.pickedMesh);
    if (!target) {
      this.clearTarget();
      return false;
    }
    if (target.getId() === this.world.getLocalPlayer()?.getId()) {
      return false;
    }

    this.setCurrentTargetId(target.getId());
    return true;
  }

  getCurrentTargetId(): string | undefined {
    return this.currentTargetId;
  }

  getCurrentTarget(): MobEntity | undefined {
    const targetId = this.currentTargetId;
    if (!targetId) {
      return undefined;
    }

    const target = this.world.getMobById(targetId);
    if (!target) {
      this.clearTarget();
      return undefined;
    }

    return target;
  }

  clearTargetIfMatches(targetId: string): void {
    if (this.currentTargetId !== targetId) {
      return;
    }
    this.clearTarget();
  }

  clearTarget(): void {
    this.setCurrentTargetId(undefined);
    this.detachIndicator();
  }

  private setCurrentTargetId(targetId?: string): void {
    const normalized = targetId?.trim();
    const resolved = normalized && normalized.length > 0 ? normalized : undefined;
    if (this.currentTargetId === resolved) {
      return;
    }

    const localPlayer = this.world.getLocalPlayer();
    this.currentTargetId = localPlayer && resolved === localPlayer.getId() ? undefined : resolved;

    if (!localPlayer) {
      return;
    }

    this.zoneNetwork.sendTargetChange(
      this.currentTargetId ? { targetEntityId: this.currentTargetId } : {}
    );

    if (this.currentTargetId) {
      this.attachIndicator(this.world.getMobById(this.currentTargetId));
    } else {
      this.detachIndicator();
    }
  }

  private getTargetCandidates(): MobEntity[] {
    const localPlayer = this.world.getLocalPlayer();
    if (!localPlayer) {
      return [];
    }

    const sourcePosition = localPlayer.getPosition();
    const candidates: {
      entity: MobEntity;
      distSq: number;
      id: string;
    }[] = [];

    for (const player of this.world.getPlayerEntities()) {
      if (player.getId() === localPlayer.getId()) {
        continue;
      }
      const pos = player.getPosition();
      const dx = pos.x - sourcePosition.x;
      const dy = pos.y - sourcePosition.y;
      const dz = pos.z - sourcePosition.z;
      candidates.push({
        entity: player,
        distSq: dx * dx + dy * dy + dz * dz,
        id: player.getId(),
      });
    }

    for (const npc of this.world.getNpcEntities()) {
      const pos = npc.getPosition();
      const dx = pos.x - sourcePosition.x;
      const dy = pos.y - sourcePosition.y;
      const dz = pos.z - sourcePosition.z;
      candidates.push({
        entity: npc,
        distSq: dx * dx + dy * dy + dz * dz,
        id: npc.getId(),
      });
    }

    candidates.sort((a, b) => {
      if (a.distSq !== b.distSq) {
        return a.distSq - b.distSq;
      }
      return a.id.localeCompare(b.id);
    });

    return candidates.map((entry) => entry.entity);
  }

  private resolveMobEntityFromMesh(mesh: AbstractMesh): MobEntity | undefined {
    let node = mesh.parent;
    while (node) {
      if (node instanceof MobEntity) {
        return node;
      }
      node = node.parent;
    }
    return undefined;
  }

  private ensureIndicator(): Mesh | undefined {
    if (this.indicator) {
      return this.indicator;
    }

    const scene = this.world.getScene();
    if (!scene) {
      return undefined;
    }

    const indicator = MeshBuilder.CreateTorus(
      'target_indicator',
      { diameter: 1.4, thickness: 0.05, tessellation: 48 },
      scene
    );
    indicator.isPickable = false;
    indicator.position.y = 0.05;

    const material = new StandardMaterial('target_indicator_mat', scene);
    material.diffuseColor = TargetingController.IN_LOS_DIFFUSE;
    material.emissiveColor = TargetingController.IN_LOS_EMISSIVE;
    material.alpha = 0.85;
    indicator.material = material;
    this.indicatorMaterial = material;
    indicator.setEnabled(false);

    this.indicator = indicator;
    return indicator;
  }

  private attachIndicator(target?: MobEntity): void {
    const indicator = this.ensureIndicator();
    if (!indicator) {
      return;
    }

    if (!target) {
      indicator.setEnabled(false);
      this.clearIndicatorParent(indicator);
      this.indicatorInLos = undefined;
      return;
    }

    indicator.parent = target;
    indicator.setEnabled(true);
    this.indicatorInLos = undefined;
    this.updateIndicatorLoS();
  }

  private detachIndicator(): void {
    if (!this.indicator) {
      return;
    }

    this.indicator.setEnabled(false);
    this.clearIndicatorParent(this.indicator);
    this.indicatorInLos = undefined;
  }

  private updateIndicatorLoS(): void {
    if (!this.indicator || !this.indicatorMaterial || !this.currentTargetId) {
      return;
    }

    const localPlayer = this.world.getLocalPlayer();
    if (!localPlayer) {
      return;
    }

    const visibleTargets = localPlayer.sync.visibleTargets;
    const inLos = visibleTargets.includes(this.currentTargetId);
    if (this.indicatorInLos === inLos) {
      return;
    }

    this.indicatorInLos = inLos;
    if (inLos) {
      this.indicatorMaterial.diffuseColor = TargetingController.IN_LOS_DIFFUSE;
      this.indicatorMaterial.emissiveColor = TargetingController.IN_LOS_EMISSIVE;
      this.indicatorMaterial.alpha = 0.85;
      return;
    }

    this.indicatorMaterial.diffuseColor = TargetingController.OUT_LOS_DIFFUSE;
    this.indicatorMaterial.emissiveColor = TargetingController.OUT_LOS_EMISSIVE;
    this.indicatorMaterial.alpha = 0.65;
  }
}
