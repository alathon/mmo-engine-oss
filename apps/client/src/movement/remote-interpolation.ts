import { lerpAngle } from "../utils/math";
import type { RemotePoseSample } from "./movement-types";

/**
 * Buffers timestamped remote movement samples for interpolation.
 */
export class RemoteMovementBuffer {
  private readonly samples: RemotePoseSample[] = [];

  /**
   * Adds a timestamped sample to the buffer.
   */
  addSample(sample: RemotePoseSample): void {
    this.samples.push(sample);
  }

  /**
   * Returns the number of buffered samples.
   */
  getSampleCount(): number {
    return this.samples.length;
  }

  /**
   * Clears the buffered samples.
   */
  clear(): void {
    this.samples.length = 0;
  }

  /**
   * Returns an interpolated pose for the requested render time.
   */
  getInterpolatedSample(renderTimeMs: number, retentionMs: number): RemotePoseSample | undefined {
    if (this.samples.length === 0) {
      return undefined;
    }

    const cutoffTimeMs = renderTimeMs - retentionMs;
    while (this.samples.length > 0 && this.samples[0].timeMs < cutoffTimeMs) {
      this.samples.shift();
    }

    if (this.samples.length === 0) {
      return undefined;
    }

    let beforeSample = this.samples[0];
    let afterSample = this.samples.at(-1) ?? beforeSample;

    for (const sample of this.samples) {
      if (sample.timeMs <= renderTimeMs) {
        beforeSample = sample;
      }
      if (sample.timeMs >= renderTimeMs) {
        afterSample = sample;
        break;
      }
    }

    const timeSpan = Math.max(1, afterSample.timeMs - beforeSample.timeMs);
    const t = Math.max(0, Math.min(1, (renderTimeMs - beforeSample.timeMs) / timeSpan));
    const x = beforeSample.x + (afterSample.x - beforeSample.x) * t;
    const y = beforeSample.y + (afterSample.y - beforeSample.y) * t;
    const z = beforeSample.z + (afterSample.z - beforeSample.z) * t;
    const yaw = lerpAngle(beforeSample.facingYaw, afterSample.facingYaw, t, 1000);

    return {
      timeMs: renderTimeMs,
      x,
      y,
      z,
      facingYaw: yaw,
    };
  }
}

export class RemoteInterpolationController {
  private readonly buffer = new RemoteMovementBuffer();
  private enabled = true;
  private readonly interpolationDelayMs: number;
  private readonly retentionMs: number;

  constructor(interpolationDelayMs: number, retentionMs: number) {
    this.interpolationDelayMs = interpolationDelayMs;
    this.retentionMs = retentionMs;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.buffer.clear();
    }
  }

  clear(): void {
    this.buffer.clear();
  }

  addSample(sample: RemotePoseSample): void {
    this.buffer.addSample(sample);
  }

  getRenderSample(nowMs: number): RemotePoseSample | undefined {
    if (!this.enabled) {
      return undefined;
    }
    const renderTimeMs = nowMs - this.interpolationDelayMs;
    return this.buffer.getInterpolatedSample(renderTimeMs, this.retentionMs);
  }
}
