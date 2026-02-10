import { createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IngameUiRoot, type IngameUiRootProps } from './ingame-ui-root';

export class ReactUiRoot {
  private root: Root;

  constructor(container: HTMLElement) {
    this.root = createRoot(container);
  }

  mountIngame(props: IngameUiRootProps): void {
    this.root.render(createElement(IngameUiRoot, props));
  }

  unmountIngame(): void {
    this.root.render(createElement(Fragment));
  }

  dispose(): void {
    this.root.unmount();
  }
}

export const createReactUiRoot = (): ReactUiRoot => {
  const container = document.querySelector<HTMLElement>('#ui');
  if (!container) {
    throw new Error('React UI root element (#ui) not found');
  }

  return new ReactUiRoot(container);
};
