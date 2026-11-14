export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

export interface PcssConfig {
  readonly lightRadius?: number;
  readonly shadowMapResolution?: number;
  readonly bias?: number;
  readonly slopeScaleBias?: number;
  readonly nearPlane?: number;
  readonly samples?: number;
}

export interface DepthShadowMap {
  readonly depths: Float32Array;
  readonly resolution: number;
}

export const POISSON_DISK_32: readonly Vec2[] = [
  [-0.613392, 0.617481], [0.170019, -0.040254], [-0.299417, 0.791925], [0.645680, 0.493210],
  [-0.651784, 0.717887], [0.421003, 0.027070], [-0.817194, -0.271096], [-0.705374, -0.668203],
  [0.977050, -0.108615], [0.063326, 0.142369], [0.203528, 0.214331], [-0.667531, 0.326090],
  [-0.098422, -0.295755], [-0.885922, 0.215369], [0.566637, 0.605884], [-0.174411, -0.835928],
  [-0.306005, -0.687483], [0.380908, 0.825828], [0.627958, -0.730302], [0.675575, -0.269168],
  [0.902512, 0.383726], [-0.555526, -0.106052], [-0.480839, -0.457812], [0.123479, -0.666991],
  [0.800539, -0.415668], [0.349694, -0.495755], [-0.073421, -0.606760], [0.468401, -0.175510],
  [-0.297424, -0.134047], [0.036833, -0.872820], [0.441787, 0.407982], [-0.429077, 0.406375],
];

export function createDepthShadowMap(resolution: number): DepthShadowMap {
  const depths = new Float32Array(resolution * resolution).fill(1.0);
  return { depths, resolution };
}

export function sampleDepthShadowMap(map: DepthShadowMap, u: number, v: number): number {
  const res = map.resolution;
  const x = Math.max(0, Math.min(res - 1, Math.floor(u * res)));
  const y = Math.max(0, Math.min(res - 1, Math.floor(v * res)));
  return map.depths[y * res + x] ?? 1.0;
}

export function computeSlopeBias(normal: Vec3, lightDir: Vec3, baseBias = 0.005, slopeScale = 0.01): number {
  const nDotL = Math.max(0.001, normal[0] * lightDir[0] + normal[1] * lightDir[1] + normal[2] * lightDir[2]);
  const tanTheta = Math.sqrt(1 - nDotL * nDotL) / nDotL;
  return baseBias + slopeScale * Math.min(2.0, tanTheta);
}

export function findBlocker(
  map: DepthShadowMap,
  uv: Vec2,
  receiverDepth: number,
  searchRadius: number,
  bias: number,
): { readonly blockerDepth: number; readonly blockerCount: number } {
  let blockerSum = 0;
  let blockerCount = 0;

  for (let i = 0; i < POISSON_DISK_32.length; i += 1) {
    const offset = POISSON_DISK_32[i]!;
    const sampleU = uv[0] + offset[0] * searchRadius;
    const sampleV = uv[1] + offset[1] * searchRadius;
    const depth = sampleDepthShadowMap(map, sampleU, sampleV);
    if (depth < receiverDepth - bias) {
      blockerSum += depth;
      blockerCount += 1;
    }
  }

  return {
    blockerDepth: blockerCount > 0 ? blockerSum / blockerCount : receiverDepth,
    blockerCount,
  };
}

export function pcfFilter(
  map: DepthShadowMap,
  uv: Vec2,
  receiverDepth: number,
  filterRadius: number,
  bias: number,
): number {
  let shadowSum = 0;
  const count = POISSON_DISK_32.length;

  for (let i = 0; i < count; i += 1) {
    const offset = POISSON_DISK_32[i]!;
    const sampleU = uv[0] + offset[0] * filterRadius;
    const sampleV = uv[1] + offset[1] * filterRadius;
    const shadowDepth = sampleDepthShadowMap(map, sampleU, sampleV);
    if (receiverDepth - bias <= shadowDepth) {
      shadowSum += 1.0;
    }
  }

  return shadowSum / count;
}

export const calculatePCSS = calculatePcssShadow;
export const pcssShadowFactor = calculatePcssShadow;
export type PCSSOptions = PcssConfig;
export type PCSSResult = { blockerDepth: number; blockerCount: number };
export type PoissonDiskSample = Vec2;

export function calculatePcssShadow(
  map: DepthShadowMap,
  uv: Vec2,
  receiverDepth: number,
  config: PcssConfig = {},
): number {
  const lightRadius = config.lightRadius ?? 0.05;
  const nearPlane = config.nearPlane ?? 0.1;
  const bias = config.bias ?? 0.003;

  if (receiverDepth <= 0 || receiverDepth >= 1.0) return 1.0;

  const searchRadius = (lightRadius * (receiverDepth - nearPlane)) / receiverDepth;
  const { blockerDepth, blockerCount } = findBlocker(map, uv, receiverDepth, searchRadius, bias);

  if (blockerCount === 0) return 1.0;
  if (blockerDepth >= receiverDepth) return 1.0;

  const penumbraRatio = (receiverDepth - blockerDepth) / blockerDepth;
  const filterRadius = Math.max(0.001, Math.min(0.1, penumbraRatio * lightRadius * (nearPlane / receiverDepth)));

  return pcfFilter(map, uv, receiverDepth, filterRadius, bias);
}
