import type { Canvas } from "@napi-rs/canvas";

export type RgbaColor = readonly [number, number, number, number];
export type RgbColor = readonly [number, number, number];
export type AlphaMode = "OPAQUE" | "MASK" | "BLEND";

export interface MaterialSlotOverride {
  readonly target?: number | string;
  readonly materialIndex?: number;
  readonly materialName?: string;
  readonly baseColor?: string | RgbaColor;
  readonly roughness?: number;
  readonly metallic?: number;
  readonly emissiveColor?: string | RgbColor;
  readonly emissiveIntensity?: number;
  readonly normalScale?: number;
  readonly alpha?: number;
  readonly alphaMode?: AlphaMode;
  readonly transmission?: number;
  readonly ior?: number;
}

export interface PBRMaterial {
  readonly name?: string;
  readonly baseColorTexture?: Canvas;
  readonly baseColorFactor?: RgbaColor;
  readonly metallicTexture?: Canvas;
  readonly metallicFactor?: number;
  readonly roughnessTexture?: Canvas;
  readonly roughnessFactor?: number;
  readonly normalTexture?: Canvas;
  readonly normalScale?: number;
  readonly emissiveTexture?: Canvas;
  readonly emissiveFactor?: RgbColor;
  readonly emissiveIntensity?: number;
  readonly doubleSided?: boolean;
  readonly alpha?: number;
  readonly alphaMode?: AlphaMode;
  readonly transmission?: number;
  readonly ior?: number;
}

export interface PbrLight {
  readonly direction: readonly [number, number, number];
  readonly color: RgbColor;
  readonly intensity: number;
}

export interface PbrEnvironment {
  readonly ambientColor: RgbColor;
  readonly ambientIntensity: number;
  readonly specularBoost: number;
}

export interface PbrContext {
  readonly material: PBRMaterial;
  readonly light: PbrLight;
  readonly environment: PbrEnvironment;
  readonly viewDirection: readonly [number, number, number];
}

export interface DecodedMetallicRoughness {
  readonly metallic: Float32Array;
  readonly roughness: Float32Array;
  readonly width: number;
  readonly height: number;
}

export interface DecodedNormalMap {
  readonly normals: Float32Array;
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_MATERIAL: PBRMaterial = {
  baseColorFactor: [0.8, 0.8, 0.8, 1],
  metallicFactor: 0,
  roughnessFactor: 0.8,
  emissiveFactor: [0, 0, 0],
  normalScale: 1,
  doubleSided: false,
};
