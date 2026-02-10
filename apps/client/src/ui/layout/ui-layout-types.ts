/**
 * Anchor point used to resolve widget offsets into actual screen positions.
 */
export type UiAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

/**
 * Viewport dimensions captured alongside layout data.
 */
export interface UiViewport {
  width: number;
  height: number;
}

/**
 * Per-widget layout data stored inside a layout preset.
 */
export interface UiWidgetLayout {
  anchor: UiAnchor;
  offsetX: number;
  offsetY: number;
  width?: number;
  height?: number;
  visible?: boolean;
  zIndex?: number;
  lastViewport?: UiViewport;
}

/**
 * A named layout preset containing multiple widget entries.
 */
export interface UiLayout {
  id: string;
  name: string;
  lastViewport: UiViewport;
  widgets: Record<string, UiWidgetLayout>;
  updatedAt: number;
}

/**
 * Persisted layout store state (localStorage in Phase 1).
 */
export interface UiLayoutStore {
  schemaVersion: number;
  activeLayoutId: string;
  layouts: UiLayout[];
}

/**
 * Snapshot used by React to render the active layout.
 */
export interface UiLayoutSnapshot {
  activeLayoutId: string;
  activeLayout: UiLayout;
  /**
   * All known layouts in the manager.
   */
  layouts: UiLayout[];
  /**
   * Current viewport used for layout resolution.
   */
  viewport: UiViewport;
  /**
   * Whether UI dragging is locked.
   */
  uiLocked: boolean;
}

/**
 * Partial update applied to a widget layout.
 */
export type UiWidgetLayoutPatch = Partial<UiWidgetLayout>;
