import type { UiLayout, UiViewport, UiWidgetLayout } from "./ui-layout-types";
import {
  DEFAULT_HOTBAR_SLOT_COUNT,
  computeHotbarLayoutMetrics,
} from "../widgets/hotbars/hotbar-controller";

/**
 * Current schema version for persisted layout data.
 */
export const UI_LAYOUT_SCHEMA_VERSION = 1;
/**
 * Stable ID for the shipped default layout.
 */
export const DEFAULT_LAYOUT_ID = "default";
/**
 * Human-readable name for the default layout.
 */
export const DEFAULT_LAYOUT_NAME = "Default";

/**
 * Minimal fallback layout used when a widget has no entry.
 */
export const DEFAULT_WIDGET_LAYOUT: UiWidgetLayout = {
  anchor: "top-left",
  offsetX: 0,
  offsetY: 0,
};

/**
 * Creates the default layout preset with known widget positions.
 */
export const createDefaultLayout = (options?: {
  viewport?: UiViewport;
  now?: number;
}): UiLayout => {
  const viewport = options?.viewport ?? { width: 1920, height: 1080 };
  const now = options?.now ?? Date.now();
  const hotbarMetrics = computeHotbarLayoutMetrics(
    viewport.width,
    viewport.height,
    DEFAULT_HOTBAR_SLOT_COUNT,
  );
  const hotbarOffsetX = (viewport.width - hotbarMetrics.width) * 0.5;
  const hotbarOffsetY = hotbarMetrics.bottomOffset;

  return {
    id: DEFAULT_LAYOUT_ID,
    name: DEFAULT_LAYOUT_NAME,
    lastViewport: viewport,
    widgets: {
      "hud.performance": {
        anchor: "top-left",
        offsetX: 12,
        offsetY: 12,
        lastViewport: viewport,
      },
      "hud.chat": {
        anchor: "bottom-left",
        offsetX: 20,
        offsetY: 20,
        width: 400,
        height: 300,
        lastViewport: viewport,
      },
      "hud.connectionStatus": {
        anchor: "top-right",
        offsetX: 20,
        offsetY: 20,
        width: 180,
        height: 32,
        lastViewport: viewport,
      },
      "hud.navmeshTuning": {
        anchor: "top-right",
        offsetX: 20,
        offsetY: 70,
        width: 300,
        height: 380,
        lastViewport: viewport,
      },
      "hud.hotbar": {
        anchor: "bottom-left",
        offsetX: hotbarOffsetX,
        offsetY: hotbarOffsetY,
        width: hotbarMetrics.width,
        height: hotbarMetrics.height,
        lastViewport: viewport,
      },
    },
    updatedAt: now,
  };
};
