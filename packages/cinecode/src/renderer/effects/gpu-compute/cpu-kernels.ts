export interface KernelBudget {
  readonly width: number;
  readonly height: number;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function gaussianWeights(radius: number, sigma: number): Float32Array {
  const size = Math.max(1, Math.ceil(radius * 2) | 1);
  const half = Math.floor(size / 2);
  const weights = new Float32Array(size);
  const safeSigma = sigma > 0 ? sigma : Math.max(0.0001, radius / 3);
  let total = 0;
  for (let i = 0; i < size; i += 1) {
    const offset = i - half;
    const weight = Math.exp(-(offset * offset) / (2 * safeSigma * safeSigma));
    weights[i] = weight;
    total += weight;
  }
  if (total > 0) {
    for (let i = 0; i < size; i += 1) weights[i] = weights[i]! / total;
  }
  return weights;
}

export function separableBlur(pixels: Uint8ClampedArray, width: number, height: number, radius: number, sigma: number): void {
  if (radius <= 0 || width < 1 || height < 1) return;
  const weights = gaussianWeights(radius, sigma);
  const half = Math.floor(weights.length / 2);
  const temp = new Float32Array(pixels.length);
  const channels = 4;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * channels;
      for (let c = 0; c < channels; c += 1) {
        let sum = 0;
        for (let k = 0; k < weights.length; k += 1) {
          const sampleX = Math.min(width - 1, Math.max(0, x + k - half));
          sum += pixels[(y * width + sampleX) * channels + c]! * weights[k]!;
        }
        temp[target + c] = sum;
      }
    }
  }

  const result = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * channels;
      for (let c = 0; c < channels; c += 1) {
        let sum = 0;
        for (let k = 0; k < weights.length; k += 1) {
          const sampleY = Math.min(height - 1, Math.max(0, y + k - half));
          sum += temp[(sampleY * width + x) * channels + c]!;
        }
        result[target + c] = clampByte(sum);
      }
    }
  }
  pixels.set(result);
}

export function bilateralDenoise(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  sigmaColor: number,
  sigmaSpace: number,
): void {
  if (radius <= 0 || width < 1 || height < 1) return;
  const source = new Uint8ClampedArray(pixels);
  const spatial = Math.max(0.0001, sigmaSpace);
  const range = Math.max(0.0001, sigmaColor);
  const radiusInt = Math.max(1, Math.round(radius));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      const centerLuma = source[target]! * 0.299 + source[target + 1]! * 0.587 + source[target + 2]! * 0.114;
      let weightSum = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = -radiusInt; dy <= radiusInt; dy += 1) {
        const sampleY = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -radiusInt; dx <= radiusInt; dx += 1) {
          const sampleX = Math.min(width - 1, Math.max(0, x + dx));
          const index = (sampleY * width + sampleX) * 4;
          const luma = source[index]! * 0.299 + source[index + 1]! * 0.587 + source[index + 2]! * 0.114;
          const spatialWeight = Math.exp(-(dx * dx + dy * dy) / (2 * spatial * spatial));
          const rangeWeight = Math.exp(-((luma - centerLuma) * (luma - centerLuma)) / (2 * range * range));
          const weight = spatialWeight * rangeWeight;
          weightSum += weight;
          r += source[index]! * weight;
          g += source[index + 1]! * weight;
          b += source[index + 2]! * weight;
          a += source[index + 3]! * weight;
        }
      }
      if (weightSum > 0) {
        pixels[target] = clampByte(r / weightSum);
        pixels[target + 1] = clampByte(g / weightSum);
        pixels[target + 2] = clampByte(b / weightSum);
        pixels[target + 3] = clampByte(a / weightSum);
      }
    }
  }
}

export interface BloomUniforms {
  readonly threshold: number;
  readonly strength: number;
  readonly radius: number;
  readonly sigma: number;
}

export function applyBloom(pixels: Uint8ClampedArray, width: number, height: number, uniforms: BloomUniforms): void {
  const { threshold, strength, radius, sigma } = uniforms;
  if (strength <= 0) return;
  const bright = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (luma <= threshold) continue;
    const scale = (luma - threshold) / Math.max(0.0001, 1 - threshold);
    bright[i] = r * scale;
    bright[i + 1] = g * scale;
    bright[i + 2] = b * scale;
    bright[i + 3] = pixels[i + 3]!;
  }
  separableBlur(bright, width, height, radius, sigma);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = clampByte(pixels[i]! + bright[i]! * strength);
    pixels[i + 1] = clampByte(pixels[i + 1]! + bright[i + 1]! * strength);
    pixels[i + 2] = clampByte(pixels[i + 2]! + bright[i + 2]! * strength);
  }
}

export interface ColorGradingUniforms {
  readonly lift?: readonly [number, number, number];
  readonly gamma?: readonly [number, number, number];
  readonly gain?: readonly [number, number, number];
  readonly saturation?: number;
  readonly lut?: Uint8ClampedArray;
  readonly lutSize?: number;
}

function sampleLut(lut: Uint8ClampedArray, size: number, r: number, g: number, b: number, channel: number): number {
  const scale = size - 1;
  const x = Math.round(Math.min(1, Math.max(0, r)) * scale);
  const y = Math.round(Math.min(1, Math.max(0, g)) * scale);
  const z = Math.round(Math.min(1, Math.max(0, b)) * scale);
  const index = ((z * size + y) * size + x) * 4 + channel;
  return lut[index] ?? lut[index - channel] ?? 0;
}

export function applyColorGrading(pixels: Uint8ClampedArray, width: number, height: number, uniforms: ColorGradingUniforms): void {
  const lift = uniforms.lift ?? [0, 0, 0];
  const gamma = uniforms.gamma ?? [1, 1, 1];
  const gain = uniforms.gain ?? [1, 1, 1];
  const saturation = uniforms.saturation ?? 1;
  const lut = uniforms.lut;
  const lutSize = uniforms.lutSize ?? 0;
  const channelLut = lut !== undefined && lutSize > 1;

  for (let i = 0; i < pixels.length; i += 4) {
    const r0 = pixels[i]! / 255;
    const g0 = pixels[i + 1]! / 255;
    const b0 = pixels[i + 2]! / 255;

    let r = channelLut ? sampleLut(lut, lutSize, r0, g0, b0, 0) / 255 : r0;
    let g = channelLut ? sampleLut(lut, lutSize, r0, g0, b0, 1) / 255 : g0;
    let b = channelLut ? sampleLut(lut, lutSize, r0, g0, b0, 2) / 255 : b0;

    r = Math.pow(Math.max(0, r * gain[0]! + lift[0]!), 1 / Math.max(0.0001, gamma[0]!));
    g = Math.pow(Math.max(0, g * gain[1]! + lift[1]!), 1 / Math.max(0.0001, gamma[1]!));
    b = Math.pow(Math.max(0, b * gain[2]! + lift[2]!), 1 / Math.max(0.0001, gamma[2]!));

    if (saturation !== 1) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = luma + (r - luma) * saturation;
      g = luma + (g - luma) * saturation;
      b = luma + (b - luma) * saturation;
    }

    pixels[i] = clampByte(r * 255);
    pixels[i + 1] = clampByte(g * 255);
    pixels[i + 2] = clampByte(b * 255);
  }
  void width;
  void height;
}

export const CPU_SHADER_KERNELS = ["bloom", "blur", "color-grading", "denoise"] as const;
export type CpuShaderKernel = (typeof CPU_SHADER_KERNELS)[number];

export function isCpuShaderKernel(name: string): name is CpuShaderKernel {
  return (CPU_SHADER_KERNELS as readonly string[]).includes(name);
}

export function applyCpuShaderKernel(
  name: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  uniforms: Record<string, unknown>,
): void {
  switch (name) {
    case "blur":
      separableBlur(
        pixels,
        width,
        height,
        Number(uniforms.radius ?? 5),
        Number(uniforms.sigma ?? Math.max(0.0001, Number(uniforms.radius ?? 5) / 3)),
      );
      return;
    case "bloom":
      applyBloom(pixels, width, height, {
        threshold: Number(uniforms.threshold ?? 0.7),
        strength: Number(uniforms.strength ?? 1),
        radius: Number(uniforms.radius ?? 8),
        sigma: Number(uniforms.sigma ?? 8 / 3),
      });
      return;
    case "color-grading":
      applyColorGrading(pixels, width, height, uniforms as ColorGradingUniforms);
      return;
    case "denoise":
      bilateralDenoise(
        pixels,
        width,
        height,
        Number(uniforms.radius ?? 2),
        Number(uniforms.sigmaColor ?? 24),
        Number(uniforms.sigmaSpace ?? 2),
      );
      return;
    default:
      throw new Error(`[CC2103] Unknown compute kernel "${name}"`);
  }
}
