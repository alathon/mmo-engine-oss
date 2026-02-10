import type { UiViewport } from './ui-layout-types';

/**
 * Reads the current browser viewport size.
 */
export const readViewport = (): UiViewport => {
  if (globalThis.window === undefined) {
    return { width: 0, height: 0 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
};
