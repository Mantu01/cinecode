import type { EffectInput, EffectProcessor } from "./engine.js";
import { defineEffect, getData, putData } from "./engine.js";
import { loadCubeLut, loadCubeLutSync, parseCubeLut, type CubeLut } from "./lut-cube-parser.js";
import { createError, ErrorCode } from "../errors/index.js";

export type { CubeLut } from "./lut-cube-parser.js";
export { loadCubeLut, loadCubeLutSync, parseCubeLut } from "./lut-cube-parser.js";

export interface Lut3D {
  readonly size: number;
  readonly data: Float32Array;
}

export interface Lut1D {
  readonly size: number;
  readonly data: Float32Array;
}

export type LutInterpolation = "trilinear" | "nearest";

export interface LutApplyOptions {
  readonly intensity?: number;
  readonly interpolation?: LutInterpolation;
  readonly domainMin?: readonly [number, number, number];
  readonly domainMax?: readonly [number, number, number];
}

export interface LutParams {
  file?: string;
  path?: string;
  data?: Float32Array;
  size?: number;
  type?: "1d" | "3d";
  strength?: number;
  intensity?: number;
  interpolation?: LutInterpolation;
  lut?: CubeLut;
}

const cubeCache = new Map<string, CubeLut>();

export async function preloadLut(filePath: string): Promise<CubeLut> {
  const cached = cubeCache.get(filePath);
  if (cached) return cached;
  const lut = await loadCubeLut(filePath);
  cubeCache.set(filePath, lut);
  return lut;
}

export function clearLutCache(): void {
  cubeCache.clear();
}

export function getPreloadedLut(filePath: string): CubeLut | undefined {
  return cubeCache.get(filePath);
}

export async function loadLut(filePath: string): Promise<Lut3D> {
  const lut = await preloadLut(filePath);
  if (lut.type !== "3d") throw createError(ErrorCode.CC6008, { path: filePath });
  return { size: lut.size, data: lut.data };
}

export function cubeLutTo3D(lut: CubeLut): Lut3D {
  if (lut.type !== "3d") throw createError(ErrorCode.CC6008, { path: "LUT" });
  return { size: lut.size, data: lut.data };
}

function domainNormalise(value: number, minimum: number, maximum: number): number {
  return Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
}

function sample1D(
  lut: Pick<CubeLut, "size" | "data">,
  r: number,
  g: number,
  b: number,
  nearest: boolean,
): readonly [number, number, number] {
  const positions = [r, g, b].map((value) => Math.max(0, Math.min(1, value)) * (lut.size - 1));
  const output: number[] = [];
  for (let channel = 0; channel < 3; channel += 1) {
    const position = positions[channel]!;
    if (nearest) {
      const index = Math.round(position);
      output.push(lut.data[index * 3 + channel] ?? 0);
      continue;
    }
    const lower = Math.floor(position);
    const upper = Math.min(lut.size - 1, lower + 1);
    const fraction = position - lower;
    const start = lut.data[lower * 3 + channel] ?? 0;
    const end = lut.data[upper * 3 + channel] ?? start;
    output.push(start + (end - start) * fraction);
  }
  return [output[0] ?? 0, output[1] ?? 0, output[2] ?? 0];
}

function sample3DNearest(
  data: Float32Array,
  size: number,
  r: number,
  g: number,
  b: number,
): readonly [number, number, number] {
  const x = Math.round(r * (size - 1));
  const y = Math.round(g * (size - 1));
  const z = Math.round(b * (size - 1));
  const index = ((z * size + y) * size + x) * 3;
  return [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
}

function sample3DTrilinear(
  data: Float32Array,
  size: number,
  r: number,
  g: number,
  b: number,
): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, r)) * (size - 1);
  const y = Math.max(0, Math.min(1, g)) * (size - 1);
  const z = Math.max(0, Math.min(1, b)) * (size - 1);
  const x0 = Math.max(0, Math.min(size - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(size - 2, Math.floor(y)));
  const z0 = Math.max(0, Math.min(size - 2, Math.floor(z)));
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const at = (xi: number, yi: number, zi: number, channel: number): number =>
    data[((zi * size + yi) * size + xi) * 3 + channel] ?? 0;
  const output: number[] = [];
  for (let channel = 0; channel < 3; channel += 1) {
    const c000 = at(x0, y0, z0, channel);
    const c100 = at(x0 + 1, y0, z0, channel);
    const c010 = at(x0, y0 + 1, z0, channel);
    const c110 = at(x0 + 1, y0 + 1, z0, channel);
    const c001 = at(x0, y0, z0 + 1, channel);
    const c101 = at(x0 + 1, y0, z0 + 1, channel);
    const c011 = at(x0, y0 + 1, z0 + 1, channel);
    const c111 = at(x0 + 1, y0 + 1, z0 + 1, channel);
    const c00 = c000 + (c100 - c000) * fx;
    const c01 = c010 + (c110 - c010) * fx;
    const c10 = c001 + (c101 - c001) * fx;
    const c11 = c011 + (c111 - c011) * fx;
    const c0 = c00 + (c01 - c00) * fy;
    const c1 = c10 + (c11 - c10) * fy;
    output.push(c0 + (c1 - c0) * fz);
  }
  return [output[0] ?? 0, output[1] ?? 0, output[2] ?? 0];
}

export function applyCubeLut(input: EffectInput, lut: CubeLut, options: LutApplyOptions = {}): void {
  const data = getData(input);
  const intensity = Math.max(0, Math.min(1, options.intensity ?? 1));
  const interpolation = options.interpolation ?? "trilinear";
  const nearest = interpolation === "nearest";
  const domainMin = options.domainMin ?? lut.domainMin;
  const domainMax = options.domainMax ?? lut.domainMax;
  const oneDimensional = lut.type === "1d";

  for (let index = 0; index < data.length; index += 4) {
    const r = domainNormalise((data[index] ?? 0) / 255, domainMin[0], domainMax[0]);
    const g = domainNormalise((data[index + 1] ?? 0) / 255, domainMin[1], domainMax[1]);
    const b = domainNormalise((data[index + 2] ?? 0) / 255, domainMin[2], domainMax[2]);
    const mapped = oneDimensional
      ? sample1D(lut, r, g, b, nearest)
      : nearest
        ? sample3DNearest(lut.data, lut.size, r, g, b)
        : sample3DTrilinear(lut.data, lut.size, r, g, b);
    if (intensity >= 1) {
      data[index] = clampByte(mapped[0] * 255);
      data[index + 1] = clampByte(mapped[1] * 255);
      data[index + 2] = clampByte(mapped[2] * 255);
    } else if (intensity > 0) {
      data[index] = clampByte((data[index] ?? 0) + (mapped[0] * 255 - (data[index] ?? 0)) * intensity);
      data[index + 1] = clampByte((data[index + 1] ?? 0) + (mapped[1] * 255 - (data[index + 1] ?? 0)) * intensity);
      data[index + 2] = clampByte((data[index + 2] ?? 0) + (mapped[2] * 255 - (data[index + 2] ?? 0)) * intensity);
    }
  }
  putData(input, data);
}

export function applyLut3D(
  input: EffectInput,
  lut: Lut3D,
  strength = 1,
  interpolation: LutInterpolation = "trilinear",
): void {
  const cube: CubeLut = {
    type: "3d",
    size: lut.size,
    data: lut.data,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
  };
  applyCubeLut(input, cube, { intensity: strength, interpolation });
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function resolveLutFromParams(params: LutParams): CubeLut | null {
  if (params.lut) return params.lut;
  const filePath = params.path || params.file;
  if (filePath) {
    const cached = cubeCache.get(filePath);
    if (cached) return cached;
    try {
      const loaded = loadCubeLutSync(filePath);
      cubeCache.set(filePath, loaded);
      return loaded;
    } catch {
      return null;
    }
  }
  if (params.data) {
    const size = params.size ?? 16;
    return {
      type: params.type ?? "3d",
      size,
      data: params.data,
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
    };
  }
  return null;
}

export const lutEffect: EffectProcessor = defineEffect({
  name: "lut",
  params: {
    strength: { default: 1, type: "number" },
    intensity: { default: 1, type: "number" },
    interpolation: { default: "trilinear", type: "string" },
    file: { default: "", type: "string" },
    path: { default: "", type: "string" },
  },
  process: (input, params) => {
    const lut = resolveLutFromParams(params as LutParams);
    if (!lut) return;
    applyCubeLut(input, lut, {
      intensity: (params.intensity as number | undefined) ?? (params.strength as number | undefined) ?? 1,
      interpolation: (params.interpolation as LutInterpolation | undefined) ?? "trilinear",
    });
  },
});

