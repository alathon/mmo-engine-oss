import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Control } from "@babylonjs/gui/2D/controls/control";
import type { UiLayer } from "../ui/uiLayer";

const DEFAULT_POOL_SIZE = 32;
const DAMAGE_COLOR = "#ff4d4d";
const HEAL_COLOR = "#4dff88";
const BASE_FONT_SIZE = 20;
const CRIT_FONT_SIZE = 26;
const OUTLINE_WIDTH = 3;
const OUTLINE_COLOR = "black";
const MAX_SPAWNS_PER_FRAME = 20;
const MAX_ACTIVE_PER_ENTITY = 5;
const CRIT_PULSE_MS = 260;
const CRIT_PULSE_SCALE = 0.55;
const BASE_OFFSET_Y = -80;
const RISE_PIXELS = 30;
const DURATION_MS = 1500;
const FADE_START_RATIO = 0.65;

interface CombatTextInstance {
  control: TextBlock;
  active: boolean;
  ageMs: number;
  durationMs: number;
  risePixels: number;
  baseOffsetY: number;
  mesh?: AbstractMesh;
  entityKey?: string;
  pulseMs: number;
  pulseScale: number;
}

export class CombatTextSystem {
  private readonly pool: CombatTextInstance[];
  private readonly activeIndices: number[] = [];
  private readonly activeCounts = new Map<string, number>();
  private readonly uiLayer: UiLayer;
  private spawnCountThisFrame = 0;

  constructor(uiLayer: UiLayer, poolSize: number = DEFAULT_POOL_SIZE) {
    this.uiLayer = uiLayer;
    this.pool = new Array<CombatTextInstance>(poolSize);

    for (let i = 0; i < poolSize; i += 1) {
      const control = this.createTextBlock(i);
      this.uiLayer.addControl(control);
      this.pool[i] = {
        control,
        active: false,
        ageMs: 0,
        durationMs: DURATION_MS,
        risePixels: RISE_PIXELS,
        baseOffsetY: BASE_OFFSET_Y,
        pulseMs: 0,
        pulseScale: 0,
      };
    }
  }

  beginFrame(): void {
    this.spawnCountThisFrame = 0;
  }

  spawnDamage(
    mesh: AbstractMesh,
    damage: number,
    isCrit = false,
    entityId?: string,
  ): void {
    if (!Number.isFinite(damage) || damage <= 0) {
      return;
    }

    this.spawnText({
      mesh,
      entityId,
      text: `-${Math.round(damage)}`,
      color: DAMAGE_COLOR,
      fontSize: isCrit ? CRIT_FONT_SIZE : BASE_FONT_SIZE,
      fontWeight: isCrit ? "bold" : "normal",
      pulseMs: isCrit ? CRIT_PULSE_MS : 0,
      pulseScale: isCrit ? CRIT_PULSE_SCALE : 0,
    });
  }

  spawnHealing(mesh: AbstractMesh, healing: number, entityId?: string): void {
    if (!Number.isFinite(healing) || healing <= 0) {
      return;
    }

    this.spawnText({
      mesh,
      entityId,
      text: `+${Math.round(healing)}`,
      color: HEAL_COLOR,
      fontSize: BASE_FONT_SIZE,
      fontWeight: "normal",
      pulseMs: 0,
      pulseScale: 0,
    });
  }

  update(deltaTimeMs: number): void {
    if (this.activeIndices.length === 0) {
      return;
    }

    const indices = this.activeIndices;
    for (let i = indices.length - 1; i >= 0; i -= 1) {
      const index = indices[i];
      const instance = this.pool[index];
      if (!instance.active) {
        this.removeActiveIndex(i);
        continue;
      }

      if (instance.mesh && instance.mesh.isDisposed()) {
        this.releaseInstance(instance);
        this.removeActiveIndex(i);
        continue;
      }

      instance.ageMs += deltaTimeMs;
      const t = Math.min(1, instance.ageMs / instance.durationMs);
      instance.control.linkOffsetY =
        instance.baseOffsetY - instance.risePixels * t;

      if (instance.pulseMs > 0 && instance.ageMs <= instance.pulseMs) {
        const pulseT = instance.ageMs / instance.pulseMs;
        const scale = 1 + instance.pulseScale * Math.sin(Math.PI * pulseT);
        instance.control.scaleX = scale;
        instance.control.scaleY = scale;
      } else {
        instance.control.scaleX = 1;
        instance.control.scaleY = 1;
      }

      if (t >= FADE_START_RATIO) {
        const fadeT = (t - FADE_START_RATIO) / (1 - FADE_START_RATIO);
        instance.control.alpha = Math.max(0, 1 - fadeT);
      }

      if (instance.ageMs >= instance.durationMs) {
        this.releaseInstance(instance);
        this.removeActiveIndex(i);
      }
    }
  }

  clear(): void {
    if (this.activeIndices.length === 0) {
      return;
    }

    for (let i = this.activeIndices.length - 1; i >= 0; i -= 1) {
      const index = this.activeIndices[i];
      const instance = this.pool[index];
      if (instance.active) {
        this.releaseInstance(instance);
      }
    }

    this.activeIndices.length = 0;
    this.activeCounts.clear();
  }

  dispose(): void {
    this.clear();
    for (const instance of this.pool) {
      this.uiLayer.removeControl(instance.control);
      instance.control.dispose();
    }
  }

  private createTextBlock(index: number): TextBlock {
    const text = new TextBlock(`combatText_${index}`);
    text.text = "";
    text.color = DAMAGE_COLOR;
    text.fontSize = BASE_FONT_SIZE;
    text.fontFamily = "Segoe UI, system-ui, sans-serif";
    text.outlineWidth = OUTLINE_WIDTH;
    text.outlineColor = OUTLINE_COLOR;
    text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    text.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    text.isVisible = false;
    text.isHitTestVisible = false;
    return text;
  }

  private findAvailable(): number {
    for (let i = 0; i < this.pool.length; i += 1) {
      if (!this.pool[i].active) {
        return i;
      }
    }
    return -1;
  }

  private spawnText(options: {
    mesh: AbstractMesh;
    text: string;
    color: string;
    fontSize: number;
    fontWeight: "normal" | "bold";
    pulseMs: number;
    pulseScale: number;
    entityId?: string;
  }): void {
    if (this.spawnCountThisFrame >= MAX_SPAWNS_PER_FRAME) {
      return;
    }

    let entityCount = 0;
    if (options.entityId) {
      entityCount = this.activeCounts.get(options.entityId) ?? 0;
      if (entityCount >= MAX_ACTIVE_PER_ENTITY) {
        return;
      }
    }

    const index = this.findAvailable();
    if (index === -1) {
      return;
    }

    const instance = this.pool[index];
    instance.active = true;
    instance.ageMs = 0;
    instance.durationMs = DURATION_MS;
    instance.risePixels = RISE_PIXELS;
    instance.baseOffsetY = BASE_OFFSET_Y;
    instance.mesh = options.mesh;
    instance.entityKey = options.entityId;
    instance.pulseMs = options.pulseMs;
    instance.pulseScale = options.pulseScale;

    const control = instance.control;
    control.text = options.text;
    control.color = options.color;
    control.fontSize = options.fontSize;
    control.fontWeight = options.fontWeight;
    control.alpha = 1;
    control.scaleX = 1;
    control.scaleY = 1;
    control.isVisible = true;
    control.linkWithMesh(options.mesh);
    control.linkOffsetY = instance.baseOffsetY;

    if (options.entityId) {
      this.activeCounts.set(options.entityId, entityCount + 1);
    }

    this.spawnCountThisFrame += 1;
    this.activeIndices.push(index);
  }

  private releaseInstance(instance: CombatTextInstance): void {
    instance.active = false;
    instance.mesh = undefined;
    if (instance.entityKey) {
      const count = this.activeCounts.get(instance.entityKey);
      if (count !== undefined) {
        const nextCount = count - 1;
        if (nextCount <= 0) {
          this.activeCounts.delete(instance.entityKey);
        } else {
          this.activeCounts.set(instance.entityKey, nextCount);
        }
      }
      instance.entityKey = undefined;
    }
    instance.pulseMs = 0;
    instance.pulseScale = 0;
    instance.control.isVisible = false;
    instance.control.alpha = 1;
    instance.control.scaleX = 1;
    instance.control.scaleY = 1;
    instance.control.fontWeight = "normal";
  }

  private removeActiveIndex(activeIndex: number): void {
    const lastIndex = this.activeIndices.length - 1;
    if (activeIndex !== lastIndex) {
      this.activeIndices[activeIndex] = this.activeIndices[lastIndex];
    }
    this.activeIndices.pop();
  }
}
