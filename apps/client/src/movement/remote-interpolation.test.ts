import { describe, expect, it } from 'vitest';
import { RemoteInterpolationController } from './remote-interpolation';

const sample = (timeMs: number, x: number, z: number, yaw = 0) => ({
  timeMs,
  x,
  y: 0,
  z,
  facingYaw: yaw,
});

describe('RemoteInterpolationController', () => {
  it('returns undefined when disabled', () => {
    const controller = new RemoteInterpolationController(0, 1000);
    controller.setEnabled(false);
    controller.addSample(sample(0, 0, 0));

    const result = controller.getRenderSample(100);
    expect(result).toBeUndefined();
  });

  it('interpolates between samples', () => {
    const controller = new RemoteInterpolationController(0, 1000);
    controller.addSample(sample(0, 0, 0, 0));
    controller.addSample(sample(100, 10, 0, Math.PI));

    const result = controller.getRenderSample(50);
    expect(result).toBeDefined();
    expect(result?.x).toBeCloseTo(5);
    expect(result?.z).toBeCloseTo(0);
    expect(result?.facingYaw).toBeCloseTo(Math.PI / 2);
  });

  it('drops samples outside retention window', () => {
    const controller = new RemoteInterpolationController(0, 10);
    controller.addSample(sample(0, 0, 0));

    const result = controller.getRenderSample(20);
    expect(result).toBeUndefined();
  });

  it('respects interpolation delay', () => {
    const controller = new RemoteInterpolationController(50, 1000);
    controller.addSample(sample(0, 0, 0));
    controller.addSample(sample(100, 10, 0));

    const result = controller.getRenderSample(100);
    expect(result?.x).toBeCloseTo(5);
  });

  it('returns the latest sample when render time is beyond range', () => {
    const controller = new RemoteInterpolationController(0, 1000);
    controller.addSample(sample(0, 0, 0));
    controller.addSample(sample(100, 10, 0));

    const result = controller.getRenderSample(1000);
    expect(result?.x).toBeCloseTo(10);
  });
});
