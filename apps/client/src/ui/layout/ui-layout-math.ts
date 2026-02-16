import type { UiAnchor, UiViewport, UiWidgetLayout } from "./ui-layout-types";

/**
 * Size information for a UI widget used for clamping.
 */
export interface UiWidgetSize {
  width: number;
  height: number;
}

/**
 * Margin in pixels used when clamping widgets to the viewport.
 */
export const UI_LAYOUT_CLAMP_MARGIN_PX = 8;

/**
 * Scales widget offsets based on the last stored viewport size.
 */
export const scaleWidgetOffsets = (
  layout: UiWidgetLayout,
  viewport: UiViewport,
): { offsetX: number; offsetY: number } => {
  const lastViewport = layout.lastViewport;
  if (
    !lastViewport ||
    lastViewport.width <= 0 ||
    lastViewport.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return { offsetX: layout.offsetX, offsetY: layout.offsetY };
  }

  const scaleX = viewport.width / lastViewport.width;
  const scaleY = viewport.height / lastViewport.height;

  return {
    offsetX: layout.offsetX * scaleX,
    offsetY: layout.offsetY * scaleY,
  };
};

/**
 * Clamps widget offsets so the widget stays inside the viewport.
 */
export const clampWidgetOffsets = (
  layout: UiWidgetLayout,
  viewport: UiViewport,
  size: UiWidgetSize,
  margin: number = UI_LAYOUT_CLAMP_MARGIN_PX,
): { offsetX: number; offsetY: number } => {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return { offsetX: layout.offsetX, offsetY: layout.offsetY };
  }

  const width = Math.max(0, size.width);
  const height = Math.max(0, size.height);

  const { left, top } = resolveTopLeft(
    layout.anchor,
    layout.offsetX,
    layout.offsetY,
    viewport,
    size,
  );

  const minLeft = margin;
  const minTop = margin;
  const maxLeft = Math.max(minLeft, viewport.width - width - margin);
  const maxTop = Math.max(minTop, viewport.height - height - margin);

  const clampedLeft = clamp(left, minLeft, maxLeft);
  const clampedTop = clamp(top, minTop, maxTop);

  return resolveOffsetsFromTopLeft(layout.anchor, clampedLeft, clampedTop, viewport, size);
};

/**
 * Computes top-left coordinates from anchor/offset values.
 */
export const resolveTopLeft = (
  anchor: UiAnchor,
  offsetX: number,
  offsetY: number,
  viewport: UiViewport,
  size: UiWidgetSize,
): { left: number; top: number } => {
  switch (anchor) {
    case "top-left": {
      return { left: offsetX, top: offsetY };
    }
    case "top-right": {
      return { left: viewport.width - size.width - offsetX, top: offsetY };
    }
    case "bottom-left": {
      return { left: offsetX, top: viewport.height - size.height - offsetY };
    }
    case "bottom-right": {
      return {
        left: viewport.width - size.width - offsetX,
        top: viewport.height - size.height - offsetY,
      };
    }
    case "center": {
      return {
        left: viewport.width / 2 + offsetX - size.width / 2,
        top: viewport.height / 2 + offsetY - size.height / 2,
      };
    }
  }
};

/**
 * Converts clamped top-left coordinates back into anchor offsets.
 */
export const resolveOffsetsFromTopLeft = (
  anchor: UiAnchor,
  left: number,
  top: number,
  viewport: UiViewport,
  size: UiWidgetSize,
): { offsetX: number; offsetY: number } => {
  switch (anchor) {
    case "top-left": {
      return { offsetX: left, offsetY: top };
    }
    case "top-right": {
      return {
        offsetX: viewport.width - (left + size.width),
        offsetY: top,
      };
    }
    case "bottom-left": {
      return {
        offsetX: left,
        offsetY: viewport.height - (top + size.height),
      };
    }
    case "bottom-right": {
      return {
        offsetX: viewport.width - (left + size.width),
        offsetY: viewport.height - (top + size.height),
      };
    }
    case "center": {
      return {
        offsetX: left + size.width / 2 - viewport.width / 2,
        offsetY: top + size.height / 2 - viewport.height / 2,
      };
    }
  }
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
