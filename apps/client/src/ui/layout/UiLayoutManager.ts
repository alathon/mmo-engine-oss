import {
  DEFAULT_LAYOUT_ID,
  DEFAULT_WIDGET_LAYOUT,
  UI_LAYOUT_SCHEMA_VERSION,
  createDefaultLayout,
} from "./uiLayoutDefaults";
import {
  buildLayoutStorageKey,
  migrateLayoutStore,
  parseLayoutStore,
  serializeLayoutStore,
} from "./uiLayoutStorage";
import type {
  UiLayout,
  UiLayoutSnapshot,
  UiLayoutStore,
  UiViewport,
  UiWidgetLayout,
  UiWidgetLayoutPatch,
} from "./uiLayoutTypes";
import { readViewport } from "./uiLayoutViewport";

type Listener = () => void;

export type UiLayoutImportMode = "merge" | "replace";

export interface UiLayoutActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Configuration options for the UiLayoutManager.
 */
export interface UiLayoutManagerOptions {
  initialLayouts?: UiLayout[];
  activeLayoutId?: string;
  viewport?: UiViewport;
}

function cloneLayout(layout: UiLayout): UiLayout {
  return {
    ...layout,
    lastViewport: { ...layout.lastViewport },
    widgets: Object.fromEntries(
      Object.entries(layout.widgets).map(([widgetId, widget]) => [
        widgetId,
        {
          ...widget,
          lastViewport: widget.lastViewport
            ? { ...widget.lastViewport }
            : undefined,
        },
      ]),
    ),
  };
}

/**
 * In-memory layout manager used by React UI overlays.
 * Provides subscribe/getSnapshot for useSyncExternalStore.
 */
export class UiLayoutManager {
  private listeners = new Set<Listener>();
  private layouts = new Map<string, UiLayout>();
  private activeLayoutId: string;
  private snapshot: UiLayoutSnapshot;
  private defaultLayout: UiLayout;
  private baseDefaultLayout: UiLayout;
  private viewport: UiViewport;
  private uiLocked = true;
  private storageKey: string = buildLayoutStorageKey();
  private storage?: Storage;

  constructor(options: UiLayoutManagerOptions = {}) {
    this.viewport = options.viewport ?? readViewport();
    this.baseDefaultLayout = createDefaultLayout({ viewport: this.viewport });

    const initialLayouts = options.initialLayouts ?? [
      cloneLayout(this.baseDefaultLayout),
    ];

    initialLayouts.forEach((layout) => {
      this.layouts.set(layout.id, layout);
    });

    if (!this.layouts.has(DEFAULT_LAYOUT_ID)) {
      this.layouts.set(DEFAULT_LAYOUT_ID, cloneLayout(this.baseDefaultLayout));
    }

    this.activeLayoutId =
      options.activeLayoutId ?? initialLayouts[0]?.id ?? DEFAULT_LAYOUT_ID;

    this.defaultLayout =
      this.layouts.get(DEFAULT_LAYOUT_ID) ??
      cloneLayout(this.baseDefaultLayout);

    const activeLayout =
      this.layouts.get(this.activeLayoutId) ?? this.defaultLayout;

    this.snapshot = this.buildSnapshot(activeLayout);
    this.bindViewportListener();
  }

  /**
   * Subscribe to layout changes. Returns an unsubscribe handler.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Snapshot used by React for rendering.
   */
  getSnapshot(): UiLayoutSnapshot {
    return this.snapshot;
  }

  /**
   * Returns the widget layout for the active layout, falling back to default.
   */
  getWidgetLayout(widgetId: string): UiWidgetLayout {
    return (
      this.snapshot.activeLayout.widgets[widgetId] ??
      this.defaultLayout.widgets[widgetId] ??
      DEFAULT_WIDGET_LAYOUT
    );
  }

  /**
   * Returns the default widget layout (if defined in the default preset).
   */
  getDefaultWidgetLayout(widgetId: string): UiWidgetLayout | undefined {
    return this.defaultLayout.widgets[widgetId];
  }

  /**
   * Returns whether UI dragging is locked.
   */
  isUiLocked(): boolean {
    return this.uiLocked;
  }

  /**
   * Toggles the UI lock state and returns the new state.
   */
  toggleUiLocked(): boolean {
    this.uiLocked = !this.uiLocked;
    this.snapshot = this.buildSnapshot(this.snapshot.activeLayout);
    this.emit();
    return this.uiLocked;
  }

  /**
   * Explicitly sets the UI lock state.
   */
  setUiLocked(locked: boolean): void {
    if (this.uiLocked === locked) {
      return;
    }
    this.uiLocked = locked;
    this.snapshot = this.buildSnapshot(this.snapshot.activeLayout);
    this.emit();
  }

  /**
   * Returns all known layouts in insertion order.
   */
  getLayouts(): UiLayout[] {
    return Array.from(this.layouts.values());
  }

  /**
   * Updates the active layout selection.
   */
  setActiveLayoutId(layoutId: string): void {
    if (this.activeLayoutId === layoutId) {
      return;
    }

    const nextLayout = this.layouts.get(layoutId);
    if (!nextLayout) {
      return;
    }

    this.activeLayoutId = layoutId;
    this.snapshot = this.buildSnapshot(nextLayout);
    this.emit();
  }

  /**
   * Applies a partial update to a widget layout in the active preset.
   */
  updateWidgetLayout(widgetId: string, patch: UiWidgetLayoutPatch): void {
    const activeLayout = this.snapshot.activeLayout;
    const currentWidget = this.getWidgetLayout(widgetId);
    const nextWidget = mergeWidgetLayout(currentWidget, patch);

    if (
      (patch.offsetX !== undefined || patch.offsetY !== undefined) &&
      !patch.lastViewport
    ) {
      nextWidget.lastViewport = this.viewport;
    }

    if (areWidgetLayoutsEqual(currentWidget, nextWidget)) {
      return;
    }

    const updatedAt = Date.now();
    const nextLayout: UiLayout = {
      ...activeLayout,
      widgets: {
        ...activeLayout.widgets,
        [widgetId]: nextWidget,
      },
      lastViewport: this.viewport,
      updatedAt,
    };

    this.layouts.set(nextLayout.id, nextLayout);
    this.snapshot = this.buildSnapshot(nextLayout);

    this.emit();
  }

  /**
   * Initializes localStorage integration and loads stored layouts.
   */
  initializeStorage(playerId?: string): UiLayoutActionResult {
    const storage = resolveStorage();
    if (!storage) {
      return { ok: false, error: "localStorage is not available." };
    }

    this.storage = storage;

    const nextKey = buildLayoutStorageKey(playerId);
    const tempKey = buildLayoutStorageKey();

    if (playerId && nextKey !== tempKey && !storage.getItem(nextKey)) {
      const tempPayload = storage.getItem(tempKey);
      if (tempPayload) {
        storage.setItem(nextKey, tempPayload);
        storage.removeItem(tempKey);
      }
    }

    this.storageKey = nextKey;
    return this.loadFromStorage();
  }

  /**
   * Saves the current layout store to localStorage.
   */
  saveToStorage(): UiLayoutActionResult {
    const storage = this.storage ?? resolveStorage();
    if (!storage) {
      return { ok: false, error: "localStorage is not available." };
    }

    this.storage = storage;

    try {
      const store = this.buildStore();
      storage.setItem(this.storageKey, serializeLayoutStore(store));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: "Failed to save layout data." };
    }
  }

  /**
   * Exports the layout store as a JSON string.
   */
  exportStore(): string {
    return serializeLayoutStore(this.buildStore());
  }

  /**
   * Imports layout data from JSON, optionally merging with current layouts.
   */
  importFromJson(
    raw: string,
    mode: UiLayoutImportMode = "replace",
  ): UiLayoutActionResult {
    const parsed = parseLayoutStore(raw);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    const migrated = migrateLayoutStore(parsed.store);
    if (!migrated) {
      return {
        ok: false,
        error: `Unsupported layout schema version ${parsed.store.schemaVersion}.`,
      };
    }

    this.applyStore(migrated, mode);
    return { ok: true };
  }

  /**
   * Resets the active layout back to the default template.
   */
  resetToDefaultLayout(): void {
    const freshDefault = createDefaultLayout({ viewport: this.viewport });
    this.baseDefaultLayout = freshDefault;
    this.layouts.set(DEFAULT_LAYOUT_ID, cloneLayout(freshDefault));
    this.defaultLayout = this.layouts.get(DEFAULT_LAYOUT_ID) ?? freshDefault;
    this.activeLayoutId = DEFAULT_LAYOUT_ID;
    this.snapshot = this.buildSnapshot(this.defaultLayout);
    this.emit();
  }

  private loadFromStorage(): UiLayoutActionResult {
    if (!this.storage) {
      return { ok: false, error: "localStorage is not available." };
    }

    const raw = this.storage.getItem(this.storageKey);
    if (!raw) {
      return { ok: true };
    }

    const parsed = parseLayoutStore(raw);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    const migrated = migrateLayoutStore(parsed.store);
    if (!migrated) {
      return {
        ok: false,
        error: `Unsupported layout schema version ${parsed.store.schemaVersion}.`,
      };
    }

    this.applyStore(migrated, "replace");
    return { ok: true };
  }

  private applyStore(store: UiLayoutStore, mode: UiLayoutImportMode): void {
    if (mode === "replace") {
      this.layouts = new Map();
    }

    store.layouts.forEach((layout) => {
      this.layouts.set(layout.id, normalizeLayout(layout, this.viewport));
    });

    if (!this.layouts.has(DEFAULT_LAYOUT_ID)) {
      this.layouts.set(DEFAULT_LAYOUT_ID, cloneLayout(this.baseDefaultLayout));
    }

    this.defaultLayout =
      this.layouts.get(DEFAULT_LAYOUT_ID) ??
      cloneLayout(this.baseDefaultLayout);

    const nextActiveId =
      this.layouts.get(store.activeLayoutId)?.id ??
      this.layouts.get(this.activeLayoutId)?.id ??
      DEFAULT_LAYOUT_ID;

    this.activeLayoutId = nextActiveId;

    const activeLayout =
      this.layouts.get(this.activeLayoutId) ?? this.defaultLayout;

    this.snapshot = this.buildSnapshot(activeLayout);
    this.emit();
  }

  private buildStore(): UiLayoutStore {
    return {
      schemaVersion: UI_LAYOUT_SCHEMA_VERSION,
      activeLayoutId: this.activeLayoutId,
      layouts: Array.from(this.layouts.values()),
    };
  }

  private buildSnapshot(activeLayout: UiLayout): UiLayoutSnapshot {
    return {
      activeLayoutId: this.activeLayoutId,
      activeLayout,
      layouts: Array.from(this.layouts.values()),
      viewport: this.viewport,
      uiLocked: this.uiLocked,
    };
  }

  private bindViewportListener(): void {
    if (typeof window === "undefined") {
      return;
    }

    window.addEventListener("resize", this.handleViewportResize);
  }

  private handleViewportResize = (): void => {
    this.viewport = readViewport();
    this.snapshot = this.buildSnapshot(this.snapshot.activeLayout);
    this.emit();
  };

  private emit(): void {
    this.listeners.forEach((listener) => {
      listener();
    });
  }
}

/**
 * Factory helper for creating a manager instance.
 */
export const createUiLayoutManager = (
  options?: UiLayoutManagerOptions,
): UiLayoutManager => new UiLayoutManager(options);

/**
 * Default singleton used by UI components.
 */
export const uiLayoutManager = new UiLayoutManager();

/**
 * Shallow merge for widget layout patches.
 */
const mergeWidgetLayout = (
  base: UiWidgetLayout,
  patch: UiWidgetLayoutPatch,
): UiWidgetLayout => ({
  ...base,
  ...patch,
});

/**
 * Equality check used to avoid unnecessary emits.
 */
const areWidgetLayoutsEqual = (
  left: UiWidgetLayout,
  right: UiWidgetLayout,
): boolean =>
  left.anchor === right.anchor &&
  left.offsetX === right.offsetX &&
  left.offsetY === right.offsetY &&
  left.width === right.width &&
  left.height === right.height &&
  left.visible === right.visible &&
  left.zIndex === right.zIndex &&
  isViewportEqual(left.lastViewport, right.lastViewport);

/**
 * Equality check for stored viewports.
 */
const isViewportEqual = (left?: UiViewport, right?: UiViewport): boolean => {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.width === right.width && left.height === right.height;
};

const resolveStorage = (): Storage | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch (error) {
    return undefined;
  }
};

const normalizeLayout = (layout: UiLayout, viewport: UiViewport): UiLayout => {
  return {
    ...layout,
    lastViewport: isViewport(layout.lastViewport)
      ? layout.lastViewport
      : viewport,
    widgets:
      layout.widgets &&
      typeof layout.widgets === "object" &&
      !Array.isArray(layout.widgets)
        ? layout.widgets
        : {},
  };
};

const isViewport = (value: unknown): value is UiViewport => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const width = Reflect.get(value, "width");
  const height = Reflect.get(value, "height");

  return (
    typeof width === "number" &&
    Number.isFinite(width) &&
    typeof height === "number" &&
    Number.isFinite(height)
  );
};
