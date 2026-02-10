import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Rectangle } from '@babylonjs/gui/2D/controls/rectangle';
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';
import { Control } from '@babylonjs/gui/2D/controls/control';
import type { UiLayer } from '../ui-layer';

// Default speech bubble settings
const DEFAULT_MAX_WIDTH = 150;
const DEFAULT_DISPLAY_TIME = 5000; // 5 seconds before fade starts
const DEFAULT_FADE_TIME = 1000; // 1 second fade out

export interface SpeechBubbleOptions {
  /** Unique identifier for naming UI elements. */
  id: string;
  /** Maximum width in pixels. Defaults to 150. */
  maxWidth?: number;
  /** Time in ms to display before fading. Defaults to 5000. */
  displayTime?: number;
  /** Time in ms for fade out animation. Defaults to 1000. */
  fadeTime?: number;
  /** Vertical offset in screen pixels (negative = above mesh). Defaults to -90. */
  linkOffsetY?: number;
}

/**
 * A speech bubble UI component that displays temporary messages above entities.
 * Automatically fades out after a configurable duration.
 */
export class SpeechBubble {
  private container: Rectangle;
  private textBlock: TextBlock;
  private displayTimeout?: ReturnType<typeof setTimeout>;
  private fadeInterval?: ReturnType<typeof setInterval>;
  private displayTime: number;
  private fadeTime: number;
  private uiLayer: UiLayer;

  constructor(mesh: AbstractMesh, options: SpeechBubbleOptions, uiLayer: UiLayer) {
    const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
    const linkOffsetY = options.linkOffsetY ?? -90;
    this.displayTime = options.displayTime ?? DEFAULT_DISPLAY_TIME;
    this.fadeTime = options.fadeTime ?? DEFAULT_FADE_TIME;
    this.uiLayer = uiLayer;

    // Container bubble
    this.container = new Rectangle(`speechBubble_${options.id}`);
    this.container.width = `${maxWidth}px`;
    this.container.adaptHeightToChildren = true;
    this.container.paddingTop = '6px';
    this.container.paddingBottom = '6px';
    this.container.paddingLeft = '10px';
    this.container.paddingRight = '10px';
    this.container.cornerRadius = 8;
    this.container.color = '#444444';
    this.container.thickness = 1;
    this.container.background = 'rgba(255, 255, 255, 0.95)';
    this.container.isVisible = false;

    this.uiLayer.addControl(this.container);
    this.container.linkWithMesh(mesh);
    this.container.linkOffsetY = linkOffsetY;

    // Text inside the bubble
    this.textBlock = new TextBlock(`speechText_${options.id}`);
    this.textBlock.text = '';
    this.textBlock.color = '#222222';
    this.textBlock.fontSize = 12;
    this.textBlock.fontFamily = 'Segoe UI, system-ui, sans-serif';
    this.textBlock.textWrapping = true;
    this.textBlock.resizeToFit = true;
    this.textBlock.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.textBlock.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;

    this.container.addControl(this.textBlock);
  }

  /**
   * Shows the speech bubble with the given message.
   * The bubble will automatically fade out after the configured display time.
   *
   * @param message - the message to display.
   */
  show(message: string): void {
    // Clear any existing timers
    this.clearTimers();

    // Set message and show bubble
    this.textBlock.text = message;
    this.container.alpha = 1;
    this.container.isVisible = true;

    // Start fade timer
    this.displayTimeout = setTimeout(() => {
      this.fadeOut();
    }, this.displayTime);
  }

  /**
   * Immediately hides the speech bubble without animation.
   */
  hide(): void {
    this.clearTimers();
    this.container.isVisible = false;
    this.container.alpha = 1;
  }

  private clearTimers(): void {
    if (this.displayTimeout) {
      clearTimeout(this.displayTimeout);
      this.displayTimeout = undefined;
    }
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = undefined;
    }
  }

  private fadeOut(): void {
    const fadeSteps = 20;
    const fadeStepTime = this.fadeTime / fadeSteps;
    let currentStep = 0;

    this.fadeInterval = setInterval(() => {
      currentStep++;
      this.container.alpha = 1 - currentStep / fadeSteps;

      if (currentStep >= fadeSteps) {
        this.clearTimers();
        this.container.isVisible = false;
        this.container.alpha = 1;
      }
    }, fadeStepTime);
  }

  dispose(): void {
    this.clearTimers();

    this.uiLayer.removeControl(this.container);
    this.textBlock.dispose();
    this.container.dispose();
  }
}
