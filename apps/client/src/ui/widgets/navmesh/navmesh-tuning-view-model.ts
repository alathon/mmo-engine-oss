import type { NavmeshGenerationSettings } from "@mmo/shared-sim";
import { DEFAULT_NAVMESH_GENERATION_SETTINGS } from "../../../zone/navmesh-generation";

type Listener = () => void;

export interface NavmeshGenerationResult {
  vertices: number;
  polys: number;
  durationMs: number;
}

export interface NavmeshTuningSnapshot {
  settings: NavmeshGenerationSettings;
  defaults: NavmeshGenerationSettings;
  ignoreServerSnaps: boolean;
  busy: boolean;
  lastResult?: NavmeshGenerationResult;
  lastError?: string;
}

export class NavmeshTuningViewModel {
  private listeners = new Set<Listener>();
  private settings: NavmeshGenerationSettings = { ...DEFAULT_NAVMESH_GENERATION_SETTINGS };
  private defaults: NavmeshGenerationSettings = { ...DEFAULT_NAVMESH_GENERATION_SETTINGS };
  private ignoreServerSnaps = false;
  private lastResult?: NavmeshGenerationResult;
  private lastError?: string;
  private busy = false;
  private generator?: (settings: NavmeshGenerationSettings) => Promise<NavmeshGenerationResult>;
  private ignoreServerSnapsHandler?: (enabled: boolean) => void;
  private snapshot: NavmeshTuningSnapshot = this.buildSnapshot();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): NavmeshTuningSnapshot {
    return this.snapshot;
  }

  updateSettings(partial: Partial<NavmeshGenerationSettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.emit();
  }

  setDefaults(settings?: NavmeshGenerationSettings): void {
    const nextDefaults = settings ?? DEFAULT_NAVMESH_GENERATION_SETTINGS;
    this.defaults = { ...DEFAULT_NAVMESH_GENERATION_SETTINGS, ...nextDefaults };
    this.settings = { ...DEFAULT_NAVMESH_GENERATION_SETTINGS, ...nextDefaults };
    this.emit();
  }

  resetToDefaults(): void {
    this.settings = { ...this.defaults };
    this.emit();
  }

  setGenerator(
    generator?: (settings: NavmeshGenerationSettings) => Promise<NavmeshGenerationResult>,
  ): void {
    this.generator = generator;
  }

  setIgnoreServerSnapsHandler(handler?: (enabled: boolean) => void): void {
    this.ignoreServerSnapsHandler = handler;
    this.ignoreServerSnapsHandler?.(this.ignoreServerSnaps);
  }

  setIgnoreServerSnaps(enabled: boolean): void {
    if (this.ignoreServerSnaps === enabled) {
      return;
    }

    this.ignoreServerSnaps = enabled;
    this.ignoreServerSnapsHandler?.(enabled);
    this.emit();
  }

  async generate(): Promise<void> {
    if (!this.generator || this.busy) {
      return;
    }

    this.busy = true;
    this.lastError = undefined;
    this.emit();

    try {
      this.lastResult = await this.generator(this.settings);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private buildSnapshot(): NavmeshTuningSnapshot {
    return {
      settings: this.settings,
      defaults: this.defaults,
      ignoreServerSnaps: this.ignoreServerSnaps,
      busy: this.busy,
      lastResult: this.lastResult,
      lastError: this.lastError,
    };
  }
}
