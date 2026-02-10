import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { GroundMesh } from '@babylonjs/core/Meshes/groundMesh';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';
import { Control } from '@babylonjs/gui/2D/controls/control';
import { ABILITY_DEFINITIONS, type AbilityDefinition } from '@mmo/shared';
import type { InputHandler } from '../input/input-handler';
import type { InputManager, PointerClick } from '../input/input-manager';
import type { CombatController } from './combat-controller';
import type { PlayerEntity } from '../entities/player-entity';
import type { MobEntity } from '../entities/mob-entity';
import type { UiLayer } from '../ui/ui-layer';

export interface GroundTargetingWorld {
  getScene(): Scene | undefined;
  getGroundMesh(): GroundMesh | undefined;
  getLocalPlayer(): PlayerEntity | undefined;
  getUiLayer(): UiLayer | undefined;
  getCurrentTargetId(): string | undefined;
  getMobById(id: string): MobEntity | undefined;
}

export class GroundTargetingController implements InputHandler {
  priority = 80;
  private activeAbilityId?: string;
  private combatController?: CombatController;
  private targetPoint?: { x: number; y: number; z: number };
  private previewMesh?: Mesh;
  private previewAbilityId?: string;
  private previewMaterial?: StandardMaterial;
  private previewInRange?: boolean;
  private rangeHint?: TextBlock;
  private aimModeHint?: TextBlock;

  constructor(private readonly world: GroundTargetingWorld) {}

  setCombatController(controller?: CombatController): void {
    this.combatController = controller;
    if (!controller) {
      this.cancelTargeting();
    }
  }

  enabled(): boolean {
    return !!this.world.getScene() && !!this.world.getGroundMesh();
  }

  isActive(): boolean {
    return !!this.activeAbilityId;
  }

  getActiveAbilityId(): string | undefined {
    return this.activeAbilityId;
  }

  beginTargeting(abilityId: string): void {
    const ability = ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS] as
      | AbilityDefinition
      | undefined;
    if (!ability || (ability.targetType !== 'ground' && ability.directionMode !== 'cursor')) {
      return;
    }

    this.activeAbilityId = abilityId;
    this.previewInRange = undefined;
    this.ensurePreviewMesh(ability);
    this.updateTargetPointFromPointer();
  }

  cancelTargeting(): void {
    this.activeAbilityId = undefined;
    this.targetPoint = undefined;
    this.previewInRange = undefined;
    this.setPreviewVisible(false);
    this.setRangeHintVisible(false);
    this.setAimModeHintVisible(false);
  }

  confirmTargeting(): boolean {
    if (!this.activeAbilityId || !this.targetPoint) {
      return false;
    }
    if (!this.combatController) {
      return false;
    }

    const ability = ABILITY_DEFINITIONS[
      this.activeAbilityId as keyof typeof ABILITY_DEFINITIONS
    ] as AbilityDefinition | undefined;
    if (!ability) {
      return false;
    }
    if (!this.isAbilityInRange(ability, this.targetPoint)) {
      return false;
    }

    const targetEntityId = this.resolveTargetEntityId(ability);
    if ((ability.targetType === 'enemy' || ability.targetType === 'ally') && !targetEntityId) {
      return false;
    }

    this.combatController.tryUseAbility(this.activeAbilityId, {
      targetPoint: this.targetPoint,
      targetEntityId,
    });
    this.cancelTargeting();
    return true;
  }

  handleTick(input: InputManager): void {
    if (!this.isActive()) {
      return;
    }
    if (input.isChatInputFocused()) {
      return;
    }
    if (input.consumeKeyPress('escape')) {
      this.cancelTargeting();
      return;
    }
  }

  handleFrame(input: InputManager): void {
    if (!this.isActive()) {
      return;
    }
    if (input.isChatInputFocused()) {
      return;
    }
    this.updateTargetPointFromPointer();
  }

  handlePointerClick(click: PointerClick): boolean {
    if (!this.isActive()) {
      return false;
    }
    if (click.button !== 0) {
      return false;
    }

    this.updateTargetPointFromScreen(click.x, click.y);
    this.confirmTargeting();
    return true;
  }

  private updateTargetPointFromPointer(): void {
    const scene = this.world.getScene();
    if (!scene) {
      return;
    }

    this.updateTargetPointFromScreen(scene.pointerX, scene.pointerY);
  }

  private updateTargetPointFromScreen(x: number, y: number): void {
    const scene = this.world.getScene();
    if (!scene) {
      return;
    }

    const ground = this.world.getGroundMesh();
    const pick = scene.pick(
      x,
      y,
      ground ? (mesh) => mesh === ground : (mesh) => mesh.name === 'ground'
    );

    if (!pick?.hit || !pick.pickedPoint) {
      this.targetPoint = undefined;
      this.setPreviewVisible(false);
      return;
    }

    this.targetPoint = {
      x: pick.pickedPoint.x,
      y: pick.pickedPoint.y,
      z: pick.pickedPoint.z,
    };
    this.updatePreviewTransform();
  }

  private ensurePreviewMesh(ability: AbilityDefinition): void {
    if (this.previewAbilityId === ability.id && this.previewMesh) {
      return;
    }

    this.disposePreviewMesh();

    const scene = this.world.getScene();
    if (!scene) {
      return;
    }

    const shape = ability.aoeShape;
    let mesh: Mesh | undefined;
    if (shape === 'single') {
      mesh = CreateDisc(
        'aoe_preview_single',
        { radius: 0.6, tessellation: 48, sideOrientation: Mesh.DOUBLESIDE },
        scene
      );
      mesh.rotation.x = Math.PI / 2;
    } else
      switch (shape.type) {
        case 'circle': {
          mesh = CreateDisc(
            'aoe_preview_circle',
            {
              radius: shape.radius,
              tessellation: 64,
              sideOrientation: Mesh.DOUBLESIDE,
            },
            scene
          );
          mesh.rotation.x = Math.PI / 2;

          break;
        }
        case 'cone': {
          mesh = CreateDisc(
            'aoe_preview_cone',
            {
              radius: shape.length,
              arc: shape.angleDeg / 360,
              tessellation: 64,
              sideOrientation: Mesh.DOUBLESIDE,
            },
            scene
          );
          mesh.rotation.x = Math.PI / 2;

          break;
        }
        case 'line': {
          mesh = MeshBuilder.CreateGround(
            'aoe_preview_rect',
            {
              width: shape.width,
              height: shape.length,
            },
            scene
          );

          break;
        }
        // No default
      }

    if (!mesh) {
      return;
    }

    mesh.isPickable = false;
    mesh.material = this.ensurePreviewMaterial(scene);
    mesh.setEnabled(false);
    this.previewMesh = mesh;
    this.previewAbilityId = ability.id;
  }

  private ensurePreviewMaterial(scene: Scene): StandardMaterial {
    if (this.previewMaterial) {
      return this.previewMaterial;
    }

    const material = new StandardMaterial('aoe_preview_mat', scene);
    material.diffuseColor = new Color3(0.9, 0.1, 0.1);
    material.emissiveColor = new Color3(0.4, 0.05, 0.05);
    material.alpha = 0.6;
    material.backFaceCulling = false;
    this.previewMaterial = material;
    this.previewInRange = true;
    return material;
  }

  private updatePreviewTransform(): void {
    const mesh = this.previewMesh;
    const targetPoint = this.targetPoint;
    const abilityId = this.activeAbilityId;
    if (!mesh || !targetPoint || !abilityId) {
      this.setPreviewVisible(false);
      return;
    }

    const ability = ABILITY_DEFINITIONS[abilityId as keyof typeof ABILITY_DEFINITIONS];
    const resolvedAbility = ability as AbilityDefinition | undefined;
    if (!resolvedAbility) {
      this.setPreviewVisible(false);
      return;
    }

    const localPlayer = this.world.getLocalPlayer();
    if (!localPlayer) {
      this.setPreviewVisible(false);
      return;
    }

    const sourcePosition = localPlayer.getPosition();
    const facingYaw = localPlayer.getFacingYaw();
    const directionMode = this.resolveDirectionMode(resolvedAbility);
    const directionYaw = this.resolveDirectionYaw(resolvedAbility, targetPoint, facingYaw);
    const shape = resolvedAbility.aoeShape;
    const forwardX = Math.sin(directionYaw);
    const forwardZ = Math.cos(directionYaw);

    const origin = resolvedAbility.targetType === 'ground' ? targetPoint : sourcePosition;

    mesh.position.set(origin.x, origin.y + 0.05, origin.z);
    mesh.rotation.y = 0;

    this.updatePreviewRangeIndicator(this.isAbilityInRange(resolvedAbility, targetPoint));
    if (shape !== 'single' && shape.type !== 'circle') {
      this.setAimModeHint(directionMode);
    } else {
      this.setAimModeHintVisible(false);
    }

    if (shape !== 'single') {
      if (shape.type === 'cone') {
        const halfAngleRad = (shape.angleDeg * Math.PI) / 360;
        mesh.rotation.y = Math.PI / 2 - directionYaw - halfAngleRad;
      } else if (shape.type === 'line') {
        mesh.rotation.y = directionYaw;
        mesh.position.x += forwardX * (shape.length / 2);
        mesh.position.z += forwardZ * (shape.length / 2);
      }
    }

    mesh.setEnabled(true);
  }

  private updatePreviewRangeIndicator(inRange: boolean): void {
    const changed = this.previewInRange !== inRange;
    if (changed && this.previewMaterial) {
      if (inRange) {
        this.previewMaterial.diffuseColor = new Color3(0.9, 0.1, 0.1);
        this.previewMaterial.emissiveColor = new Color3(0.4, 0.05, 0.05);
      } else {
        this.previewMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
        this.previewMaterial.emissiveColor = new Color3(0.05, 0.05, 0.05);
      }
    }

    this.previewInRange = inRange;
    this.setRangeHintVisible(!inRange);
  }

  private isAbilityInRange(
    ability: AbilityDefinition,
    targetPoint: { x: number; y: number; z: number }
  ): boolean {
    if (ability.targetType === 'self') {
      return true;
    }
    if (ability.targetType === 'enemy' || ability.targetType === 'ally') {
      const target = this.getCurrentTargetEntity();
      if (!target) {
        return false;
      }
      return this.isPointInRange(ability, target.getPosition());
    }

    if (ability.targetType === 'ground') {
      return this.isPointInRange(ability, targetPoint);
    }

    if (ability.directionMode === 'cursor') {
      return this.isPointInRange(ability, targetPoint);
    }

    return true;
  }

  private isPointInRange(
    ability: AbilityDefinition,
    point: { x: number; y: number; z: number }
  ): boolean {
    const localPlayer = this.world.getLocalPlayer();
    if (!localPlayer) {
      return false;
    }

    const sourcePosition = localPlayer.getPosition();
    const dx = point.x - sourcePosition.x;
    const dz = point.z - sourcePosition.z;
    const distSq = dx * dx + dz * dz;
    const rangeSq = ability.range * ability.range;
    return distSq <= rangeSq;
  }

  private resolveDirectionYaw(
    ability: AbilityDefinition,
    targetPoint: { x: number; y: number; z: number },
    fallbackYaw: number
  ): number {
    const directionMode = this.resolveDirectionMode(ability);
    if (directionMode === 'facing') {
      return fallbackYaw;
    }

    if (directionMode === 'target') {
      const target = this.getCurrentTargetEntity();
      if (!target) {
        return fallbackYaw;
      }
      const localPlayer = this.world.getLocalPlayer();
      if (!localPlayer) {
        return fallbackYaw;
      }
      const sourcePosition = localPlayer.getPosition();
      const targetPosition = target.getPosition();
      const dx = targetPosition.x - sourcePosition.x;
      const dz = targetPosition.z - sourcePosition.z;
      return this.yawFromVector(dx, dz, fallbackYaw);
    }

    const localPlayer = this.world.getLocalPlayer();
    if (!localPlayer) {
      return fallbackYaw;
    }
    const sourcePosition = localPlayer.getPosition();
    const dx = targetPoint.x - sourcePosition.x;
    const dz = targetPoint.z - sourcePosition.z;
    return this.yawFromVector(dx, dz, fallbackYaw);
  }

  private resolveDirectionMode(ability: AbilityDefinition): 'facing' | 'cursor' | 'target' {
    if (ability.directionMode) {
      return ability.directionMode;
    }
    if (ability.targetType === 'enemy' || ability.targetType === 'ally') {
      return 'target';
    }
    return 'facing';
  }

  private yawFromVector(dx: number, dz: number, fallbackYaw: number): number {
    const lenSq = dx * dx + dz * dz;
    if (lenSq <= 0.000_001) {
      return fallbackYaw;
    }
    return Math.atan2(dx, dz);
  }

  private resolveTargetEntityId(ability: AbilityDefinition): string | undefined {
    if (ability.targetType !== 'enemy' && ability.targetType !== 'ally') {
      return undefined;
    }
    return this.world.getCurrentTargetId() ?? undefined;
  }

  private getCurrentTargetEntity(): MobEntity | undefined {
    const targetId = this.world.getCurrentTargetId();
    if (!targetId) {
      return undefined;
    }
    return this.world.getMobById(targetId);
  }

  private ensureRangeHint(): TextBlock | undefined {
    if (this.rangeHint) {
      return this.rangeHint;
    }

    const uiLayer = this.world.getUiLayer();
    if (!uiLayer) {
      return undefined;
    }

    const hint = new TextBlock('groundTargetingOutOfRange');
    hint.text = 'Out of range';
    hint.color = '#6e6e6e';
    hint.alpha = 0.85;
    hint.fontSize = 14;
    hint.fontFamily = 'Segoe UI, system-ui, sans-serif';
    hint.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    hint.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    hint.paddingBottom = '140px';
    hint.shadowColor = '#000000';
    hint.shadowBlur = 2;
    hint.shadowOffsetX = 1;
    hint.shadowOffsetY = 1;
    hint.isVisible = false;

    uiLayer.addControl(hint);
    this.rangeHint = hint;
    return hint;
  }

  private setRangeHintVisible(visible: boolean): void {
    const hint = this.ensureRangeHint();
    if (!hint) {
      return;
    }
    hint.isVisible = visible;
  }

  private ensureAimModeHint(): TextBlock | undefined {
    if (this.aimModeHint) {
      return this.aimModeHint;
    }

    const uiLayer = this.world.getUiLayer();
    if (!uiLayer) {
      return undefined;
    }

    const hint = new TextBlock('groundTargetingAimMode');
    hint.text = 'Aim: Facing';
    hint.color = '#b5b5b5';
    hint.alpha = 0.85;
    hint.fontSize = 12;
    hint.fontFamily = 'Segoe UI, system-ui, sans-serif';
    hint.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    hint.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    hint.paddingBottom = '165px';
    hint.shadowColor = '#000000';
    hint.shadowBlur = 2;
    hint.shadowOffsetX = 1;
    hint.shadowOffsetY = 1;
    hint.isVisible = false;

    uiLayer.addControl(hint);
    this.aimModeHint = hint;
    return hint;
  }

  private setAimModeHint(mode: 'facing' | 'cursor' | 'target'): void {
    const hint = this.ensureAimModeHint();
    if (!hint) {
      return;
    }

    const label = mode === 'cursor' ? 'Cursor' : mode === 'target' ? 'Target' : 'Facing';
    hint.text = `Aim: ${label}`;
    hint.isVisible = true;
  }

  private setAimModeHintVisible(visible: boolean): void {
    const hint = this.ensureAimModeHint();
    if (!hint) {
      return;
    }
    hint.isVisible = visible;
  }

  private setPreviewVisible(visible: boolean): void {
    if (!this.previewMesh) {
      return;
    }
    this.previewMesh.setEnabled(visible);
    if (!visible) {
      this.setRangeHintVisible(false);
      this.setAimModeHintVisible(false);
    }
  }

  private disposePreviewMesh(): void {
    if (this.previewMesh) {
      this.previewMesh.dispose();
      this.previewMesh = undefined;
    }
    this.previewAbilityId = undefined;
  }

  dispose(): void {
    this.disposePreviewMesh();
    if (this.previewMaterial) {
      this.previewMaterial.dispose();
      this.previewMaterial = undefined;
    }
    if (this.rangeHint) {
      this.world.getUiLayer()?.removeControl(this.rangeHint);
      this.rangeHint = undefined;
    }
    if (this.aimModeHint) {
      this.world.getUiLayer()?.removeControl(this.aimModeHint);
      this.aimModeHint = undefined;
    }
  }
}
