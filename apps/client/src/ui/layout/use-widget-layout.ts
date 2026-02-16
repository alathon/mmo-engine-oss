import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { DEFAULT_WIDGET_LAYOUT } from "./ui-layout-defaults";
import {
  clampWidgetOffsets,
  resolveOffsetsFromTopLeft,
  resolveTopLeft,
  scaleWidgetOffsets,
} from "./ui-layout-math";
import { UiLayoutManager, uiLayoutManager } from "./ui-layout-manager";
import type { UiWidgetLayout, UiWidgetLayoutPatch } from "./ui-layout-types";

/**
 * Pointer drag handlers returned by useWidgetLayout.
 */
export interface WidgetDragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/**
 * Hook output for UI widgets.
 */
export interface UseWidgetLayoutResult {
  style: CSSProperties;
  dragHandlers: WidgetDragHandlers;
  setLayout: (patch: UiWidgetLayoutPatch) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  width: number;
  height: number;
  dragging: boolean;
}

/**
 * Hook that resolves layout styles and drag handlers for a widget ID.
 */
export const useWidgetLayout = (
  widgetId: string,
  manager: UiLayoutManager = uiLayoutManager,
): UseWidgetLayoutResult => {
  const subscribe = useCallback((listener: () => void) => manager.subscribe(listener), [manager]);
  const getSnapshot = useCallback(() => manager.getSnapshot(), [manager]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const widgetLayout =
    snapshot.activeLayout.widgets[widgetId] ??
    manager.getDefaultWidgetLayout(widgetId) ??
    DEFAULT_WIDGET_LAYOUT;
  const viewport = snapshot.viewport;
  const uiLocked = snapshot.uiLocked;

  const dragState = useRef<DragState>({
    pointerId: -1,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    width: 0,
    height: 0,
    dragging: false,
  });

  const setLayout = useCallback(
    (patch: UiWidgetLayoutPatch) => {
      manager.updateWidgetLayout(widgetId, patch);
    },
    [manager, widgetId],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      if (uiLocked) {
        return;
      }

      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const size = { width: rect.width, height: rect.height };
      const scaled = scaleWidgetOffsets(widgetLayout, viewport);
      const clamped = clampWidgetOffsets({ ...widgetLayout, ...scaled }, viewport, size);
      const topLeft = resolveTopLeft(
        widgetLayout.anchor,
        clamped.offsetX,
        clamped.offsetY,
        viewport,
        size,
      );
      const state = dragState.current;
      state.dragging = true;
      state.pointerId = event.pointerId;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.startLeft = topLeft.left;
      state.startTop = topLeft.top;
      state.width = size.width;
      state.height = size.height;
      event.currentTarget.setPointerCapture(event.pointerId);

      if (
        clamped.offsetX !== widgetLayout.offsetX ||
        clamped.offsetY !== widgetLayout.offsetY ||
        widgetLayout.lastViewport?.width !== viewport.width ||
        widgetLayout.lastViewport?.height !== viewport.height ||
        widgetLayout.width !== size.width ||
        widgetLayout.height !== size.height
      ) {
        manager.updateWidgetLayout(widgetId, {
          offsetX: clamped.offsetX,
          offsetY: clamped.offsetY,
          width: size.width,
          height: size.height,
          lastViewport: viewport,
        });
      }
    },
    [manager, uiLocked, viewport, widgetId, widgetLayout],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragState.current;
      if (!state.dragging || state.pointerId !== event.pointerId) {
        return;
      }

      if (uiLocked) {
        return;
      }

      const nextLeft = state.startLeft + (event.clientX - state.startX);
      const nextTop = state.startTop + (event.clientY - state.startY);
      const nextOffsets = resolveOffsetsFromTopLeft(
        widgetLayout.anchor,
        nextLeft,
        nextTop,
        viewport,
        { width: state.width, height: state.height },
      );
      const clamped = clampWidgetOffsets({ ...widgetLayout, ...nextOffsets }, viewport, {
        width: state.width,
        height: state.height,
      });

      manager.updateWidgetLayout(widgetId, {
        offsetX: clamped.offsetX,
        offsetY: clamped.offsetY,
        width: state.width,
        height: state.height,
        lastViewport: viewport,
      });
    },
    [manager, uiLocked, viewport, widgetId, widgetLayout],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state.dragging || state.pointerId !== event.pointerId) {
      return;
    }

    state.dragging = false;
    state.pointerId = -1;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state.dragging || state.pointerId !== event.pointerId) {
      return;
    }

    state.dragging = false;
    state.pointerId = -1;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const resolvedLayout = useMemo(() => {
    const size = {
      width: widgetLayout.width ?? 0,
      height: widgetLayout.height ?? 0,
    };
    const scaled = scaleWidgetOffsets(widgetLayout, viewport);
    const clamped = clampWidgetOffsets({ ...widgetLayout, ...scaled }, viewport, size);

    return {
      ...widgetLayout,
      offsetX: clamped.offsetX,
      offsetY: clamped.offsetY,
    };
  }, [viewport, widgetLayout]);

  useEffect(() => {
    if (
      resolvedLayout.offsetX === widgetLayout.offsetX &&
      resolvedLayout.offsetY === widgetLayout.offsetY &&
      widgetLayout.lastViewport?.width === viewport.width &&
      widgetLayout.lastViewport?.height === viewport.height
    ) {
      return;
    }

    manager.updateWidgetLayout(widgetId, {
      offsetX: resolvedLayout.offsetX,
      offsetY: resolvedLayout.offsetY,
      lastViewport: viewport,
    });
  }, [manager, resolvedLayout, viewport, widgetId, widgetLayout]);

  const style = useMemo(() => {
    const nextStyle = resolveWidgetStyle(resolvedLayout);
    nextStyle.cursor = uiLocked ? "default" : "move";
    return nextStyle;
  }, [resolvedLayout, uiLocked]);

  return {
    style,
    dragHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    },
    setLayout,
  };
};

/**
 * Converts anchor/offset layout data into CSS positional styles.
 */
const resolveWidgetStyle = (layout: UiWidgetLayout): CSSProperties => {
  const style: CSSProperties = {};

  switch (layout.anchor) {
    case "top-left": {
      style.left = layout.offsetX;
      style.top = layout.offsetY;
      break;
    }
    case "top-right": {
      style.right = layout.offsetX;
      style.top = layout.offsetY;
      break;
    }
    case "bottom-left": {
      style.left = layout.offsetX;
      style.bottom = layout.offsetY;
      break;
    }
    case "bottom-right": {
      style.right = layout.offsetX;
      style.bottom = layout.offsetY;
      break;
    }
    case "center": {
      style.left = `calc(50% + ${layout.offsetX}px)`;
      style.top = `calc(50% + ${layout.offsetY}px)`;
      style.transform = "translate(-50%, -50%)";
      break;
    }
  }

  if (layout.zIndex !== undefined) {
    style.zIndex = layout.zIndex;
  }

  if (layout.visible === false) {
    style.display = "none";
  }

  return style;
};
