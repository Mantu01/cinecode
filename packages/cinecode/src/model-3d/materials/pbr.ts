import type { PBRMaterial, PbrContext, PbrLight, RgbColor } from "./types.js";
import { DEFAULT_MATERIAL } from "./types.js";

type Vec3 = readonly [number, number, number];

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v: Vec3, amount: number): Vec3 {
  return [v[0] * amount, v[1] * amount, v[2] * amount];
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function distributionGgx(nDotH: number, roughness: number): number {
  const alpha = roughness * roughness;
  const alphaSquared = alpha * alpha;
  const denominator = nDotH * nDotH * (alphaSquared - 1) + 1;
  return alphaSquared / (Math.PI * denominator * denominator);
}

function geometrySchlickGgx(nDotV: number, roughness: number): number {
  const k = ((roughness + 1) * (roughness + 1)) / 8;
  return nDotV / (nDotV * (1 - k) + k);
}

function fresnelSchlick(hDotV: number, f0: Vec3): Vec3 {
  const factor = Math.pow(1 - hDotV, 5);
  return [
    f0[0] + (1 - f0[0]) * factor,
    f0[1] + (1 - f0[1]) * factor,
    f0[2] + (1 - f0[2]) * factor,
  ];
}

export function pbrShade(
  normal: Vec3,
  viewDirection: Vec3,
  light: PbrLight,
  material: PBRMaterial = DEFAULT_MATERIAL,
  environmentColor?: RgbColor,
): RgbColor {
  const n = normalize(normal);
  const v = normalize(viewDirection);
  const l = normalize(light.direction);
  const h = normalize(add(l, v));

  const base = material.baseColorFactor ?? DEFAULT_MATERIAL.baseColorFactor!;
  const metallic = clamp01(material.metallicFactor ?? DEFAULT_MATERIAL.metallicFactor!);
  const roughness = Math.max(0.04, clamp01(material.roughnessFactor ?? DEFAULT_MATERIAL.roughnessFactor!));
  const emissiveMultiplier = material.emissiveIntensity ?? 1;
  const rawEmissive = material.emissiveFactor ?? [0, 0, 0];
  const emissive: Vec3 = [
    rawEmissive[0] * emissiveMultiplier,
    rawEmissive[1] * emissiveMultiplier,
    rawEmissive[2] * emissiveMultiplier,
  ];

  const nDotL = Math.max(0, dot(n, l));
  const nDotV = Math.max(0.001, dot(n, v));
  const nDotH = Math.max(0, dot(n, h));
  const hDotV = Math.max(0.001, dot(h, v));

  if (nDotL <= 0) {
    return [
      Math.min(255, Math.max(0, emissive[0] * 255)),
      Math.min(255, Math.max(0, emissive[1] * 255)),
      Math.min(255, Math.max(0, emissive[2] * 255)),
    ];
  }

  const dielectricF0 = material.ior !== undefined
    ? Math.pow((material.ior - 1) / (material.ior + 1), 2)
    : 0.04;
  const f0: Vec3 = [
    mix(dielectricF0, base[0], metallic),
    mix(dielectricF0, base[1], metallic),
    mix(dielectricF0, base[2], metallic),
  ];
  const fresnel = fresnelSchlick(hDotV, f0);
  const ndf = distributionGgx(nDotH, roughness);
  const geometry = geometrySchlickGgx(nDotV, roughness) * geometrySchlickGgx(nDotL, roughness);
  const specularDenominator = Math.max(0.001, 4 * nDotV * nDotL);

  const radiance = light.intensity;
  const lightRgb: Vec3 = [
    light.color[0] * radiance,
    light.color[1] * radiance,
    light.color[2] * radiance,
  ];

  const transmission = clamp01(material.transmission ?? 0);
  const diffuseWeight = (1 - metallic) * (1 - transmission) * (nDotL / Math.PI);
  const diffuse: Vec3 = [
    (base[0] * diffuseWeight),
    (base[1] * diffuseWeight),
    (base[2] * diffuseWeight),
  ];

  const specularScale = (ndf * geometry) / specularDenominator;
  const specular: Vec3 = [
    fresnel[0] * specularScale,
    fresnel[1] * specularScale,
    fresnel[2] * specularScale,
  ];

  const reflection: Vec3 = environmentColor
    ? [
        environmentColor[0] * (metallic * 0.6 + 0.05),
        environmentColor[1] * (metallic * 0.6 + 0.05),
        environmentColor[2] * (metallic * 0.6 + 0.05),
      ]
    : [0, 0, 0];

  const result: RgbColor = [
    clamp01((diffuse[0] + specular[0]) * lightRgb[0] + reflection[0] + emissive[0]) * 255,
    clamp01((diffuse[1] + specular[1]) * lightRgb[1] + reflection[1] + emissive[1]) * 255,
    clamp01((diffuse[2] + specular[2]) * lightRgb[2] + reflection[2] + emissive[2]) * 255,
  ];
  return result;
}

export function pbrShadeContext(normal: Vec3, context: PbrContext): RgbColor {
  const environment = context.environment;
  const reflection = environment.ambientIntensity > 0 && environment.specularBoost > 0
    ? environment.ambientColor
    : undefined;
  return pbrShade(normal, context.viewDirection, context.light, context.material, reflection);
}

export function computeVertexColors(
  normals: Float32Array | undefined,
  vertexCount: number,
  context: PbrContext,
): Uint8Array {
  const colors = new Uint8Array(vertexCount * 4);
  const fallbackNormal: Vec3 = [0, 1, 0];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const normal: Vec3 = normals
      ? [normals[vertex * 3]!, normals[vertex * 3 + 1]!, normals[vertex * 3 + 2]!]
      : fallbackNormal;
    const [r, g, b] = pbrShadeContext(normal, context);
    colors[vertex * 4] = Math.round(r);
    colors[vertex * 4 + 1] = Math.round(g);
    colors[vertex * 4 + 2] = Math.round(b);
    colors[vertex * 4 + 3] = 255;
  }
  return colors;
}

export function resolveLight(direction: readonly [number, number, number], color: RgbColor, intensity: number): PbrLight {
  return { direction: normalize(direction), color, intensity };
}
