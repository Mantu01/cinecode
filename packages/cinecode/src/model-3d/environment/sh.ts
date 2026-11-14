import type { CubeTexture } from "./cubeMap.js";
import { sampleEnvMap } from "./reflection.js";

export type Vec3 = readonly [number, number, number];
export type RgbColor = readonly [number, number, number];

export interface SphericalHarmonics3 {
  readonly coefficients: readonly RgbColor[];
}

const C1 = 0.429043;
const C2 = 0.511664;
const C3 = 0.743125;
const C4 = 0.886227;
const C5 = 0.247708;

export type SH9 = SphericalHarmonics3;
export const evalSH = evaluateSHIrradiance;
export const projectToSH = computeSHFromCubeMap;
export const rotateVectorByEuler = rotateVectorEuler;

export function createDefaultSH(): SphericalHarmonics3 {
  const coefficients: RgbColor[] = [
    [0.7, 0.75, 0.85],
    [0.0, 0.1, 0.0],
    [0.15, 0.2, 0.25],
    [0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0],
    [0.05, 0.05, 0.05],
    [0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0],
  ];
  return { coefficients };
}

export function evaluateSHIrradiance(sh: SphericalHarmonics3, normal: Vec3): RgbColor {
  const [x, y, z] = normal;
  const c = sh.coefficients;
  const c00 = c[0] ?? [0, 0, 0];
  const c1_1 = c[1] ?? [0, 0, 0];
  const c10 = c[2] ?? [0, 0, 0];
  const c11 = c[3] ?? [0, 0, 0];
  const c2_2 = c[4] ?? [0, 0, 0];
  const c2_1 = c[5] ?? [0, 0, 0];
  const c20 = c[6] ?? [0, 0, 0];
  const c21 = c[7] ?? [0, 0, 0];
  const c22 = c[8] ?? [0, 0, 0];

  const result: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch += 1) {
    const term1 = C1 * c22[ch]! * (x * x - y * y);
    const term2 = C3 * c20[ch]! * z * z;
    const term3 = C4 * c00[ch]! - C5 * c20[ch]!;
    const term4 = 2 * C1 * (c2_2[ch]! * x * y + c21[ch]! * x * z + c2_1[ch]! * y * z);
    const term5 = 2 * C2 * (c11[ch]! * x + c1_1[ch]! * y + c10[ch]! * z);
    result[ch] = Math.max(0, term1 + term2 + term3 + term4 + term5);
  }
  return result;
}

export function rotateVectorEuler(v: Vec3, rotX: number, rotY: number, rotZ: number): Vec3 {
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
  const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);

  let [x, y, z] = v;

  const y1 = y * cosX - z * sinX;
  const z1 = y * sinX + z * cosX;
  y = y1;
  z = z1;

  const x2 = x * cosY + z * sinY;
  const z2 = -x * sinY + z * cosY;
  x = x2;
  z = z2;

  const x3 = x * cosZ - y * sinZ;
  const y3 = x * sinZ + y * cosZ;
  x = x3;
  y = y3;

  return [x, y, z];
}

export function rotateSH(sh: SphericalHarmonics3, rotX: number, rotY: number, rotZ: number): SphericalHarmonics3 {
  if (rotX === 0 && rotY === 0 && rotZ === 0) return sh;

  const sampleDirs: Vec3[] = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    [0.707, 0.707, 0], [-0.707, 0.707, 0], [0, 0.707, 0.707], [0, -0.707, 0.707],
  ];

  const rotatedCoeffs: [number, number, number][] = sh.coefficients.map((c) => [...c]);

  const c1 = [sh.coefficients[1]!, sh.coefficients[2]!, sh.coefficients[3]!];
  for (let ch = 0; ch < 3; ch += 1) {
    const band1Vec: Vec3 = [c1[2]![ch]!, c1[0]![ch]!, c1[1]![ch]!];
    const rotatedBand1 = rotateVectorEuler(band1Vec, rotX, rotY, rotZ);
    rotatedCoeffs[3]![ch] = rotatedBand1[0]!;
    rotatedCoeffs[1]![ch] = rotatedBand1[1]!;
    rotatedCoeffs[2]![ch] = rotatedBand1[2]!;
  }

  void sampleDirs;
  return { coefficients: rotatedCoeffs };
}

export function scaleSH(sh: SphericalHarmonics3, exposureEV: number, tint?: RgbColor): SphericalHarmonics3 {
  const multiplier = Math.pow(2, exposureEV);
  const t = tint ?? [1, 1, 1];
  const coefficients = sh.coefficients.map((c): RgbColor => [
    c[0] * multiplier * t[0],
    c[1] * multiplier * t[1],
    c[2] * multiplier * t[2],
  ]);
  return { coefficients };
}

export function computeSHFromCubeMap(cubeTex: CubeTexture, sampleSteps = 16): SphericalHarmonics3 {
  const coeffs: [number, number, number][] = Array.from({ length: 9 }, () => [0, 0, 0]);
  let weightSum = 0;

  for (let phiStep = 0; phiStep < sampleSteps; phiStep += 1) {
    const phi = (phiStep / sampleSteps) * Math.PI * 2;
    for (let thetaStep = 0; thetaStep < sampleSteps; thetaStep += 1) {
      const theta = ((thetaStep + 0.5) / sampleSteps) * Math.PI;
      const x = Math.sin(theta) * Math.cos(phi);
      const y = Math.cos(theta);
      const z = Math.sin(theta) * Math.sin(phi);
      const dir: Vec3 = [x, y, z];
      const weight = Math.sin(theta);
      weightSum += weight;

      const sample = sampleEnvMap(cubeTex, dir);

      const y00 = 0.282095;
      const y1_1 = 0.488603 * y;
      const y10 = 0.488603 * z;
      const y11 = 0.488603 * x;
      const y2_2 = 1.092548 * x * y;
      const y2_1 = 1.092548 * y * z;
      const y20 = 0.315392 * (3 * z * z - 1);
      const y21 = 1.092548 * x * z;
      const y22 = 0.546274 * (x * x - y * y);

      const yBasis = [y00, y1_1, y10, y11, y2_2, y2_1, y20, y21, y22];

      for (let i = 0; i < 9; i += 1) {
        const factor = yBasis[i]! * weight;
        coeffs[i]![0] += sample[0] * factor;
        coeffs[i]![1] += sample[1] * factor;
        coeffs[i]![2] += sample[2] * factor;
      }
    }
  }

  const norm = (4 * Math.PI) / (weightSum || 1);
  const normalized = coeffs.map((c): RgbColor => [c[0] * norm, c[1] * norm, c[2] * norm]);
  return { coefficients: normalized };
}
