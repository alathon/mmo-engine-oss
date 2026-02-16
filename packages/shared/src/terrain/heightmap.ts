export interface ProceduralHeightMapOptions {
  size: number;
  seed?: number;
  contrast?: number;
  roughness?: number;
  peakCount?: number;
  peakRadius?: number;
  peakStrength?: number;
}

export function generateProceduralHeightMap(options: ProceduralHeightMapOptions): Uint8Array {
  const size = Math.max(1, Math.floor(options.size));
  const contrast = Math.max(0, options.contrast ?? 1);
  const roughness = Math.max(0, options.roughness ?? 1);
  let peakCount = Math.max(0, Math.floor(options.peakCount ?? 0));
  const peakRadius = Math.max(0, options.peakRadius ?? 0.08);
  const peakStrength = Math.max(0, options.peakStrength ?? 0.3);
  if (peakCount === 0 || peakRadius === 0 || peakStrength === 0) {
    peakCount = 0;
  }
  const data = new Uint8Array(size * size);

  let seed = options.seed ?? 8675309;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const peakXs: number[] = [];
  const peakYs: number[] = [];
  const peakStrengths: number[] = [];
  for (let i = 0; i < peakCount; i += 1) {
    peakXs.push(next());
    peakYs.push(next());
    peakStrengths.push((0.7 + next() * 0.6) * peakStrength);
  }
  const peakFalloffDenom = peakRadius > 0 ? 2 * peakRadius * peakRadius : 1;

  const twoPi = Math.PI * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x / size;
      const ny = y / size;

      let value = 0.5;
      value += 0.26 * Math.sin(nx * twoPi * 1.2);
      value += 0.26 * Math.sin(ny * twoPi * 1.2);
      value += 0.2 * Math.sin((nx + ny) * twoPi * 0.7);
      value += roughness * (0.1 * Math.sin(nx * twoPi * 3.5) * Math.sin(ny * twoPi * 3.5));
      value += roughness * ((next() - 0.5) * 0.05);

      for (let i = 0; i < peakCount; i += 1) {
        const dx = nx - peakXs[i];
        const dy = ny - peakYs[i];
        const dist2 = dx * dx + dy * dy;
        const falloff = Math.exp(-dist2 / peakFalloffDenom);
        value += peakStrengths[i] * falloff;
      }

      value = Math.max(0, Math.min(1, value));
      value = (value - 0.5) * contrast + 0.5;
      value = Math.max(0, Math.min(1, value));

      data[y * size + x] = Math.floor(value * 255);
    }
  }

  return data;
}
