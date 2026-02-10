import type { UiViewport } from "./uiLayoutTypes";

/**
 * Reads the current browser viewport size.
 */
export const readViewport = (): UiViewport => {
  if (typeof window === "undefined") {
    return { width: 0, height: 0 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
};
