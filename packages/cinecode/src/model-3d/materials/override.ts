import type { MaterialSlotOverride, PBRMaterial, RgbaColor, RgbColor } from "./types.js";

function parseColorToRgba(value: string | RgbaColor | RgbColor | undefined): RgbaColor | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    if (value.length >= 4) return [value[0]!, value[1]!, value[2]!, value[3]!];
    if (value.length === 3) return [value[0]!, value[1]!, value[2]!, 1];
    return undefined;
  }
  if (typeof value === "string") {
    const hex = value.startsWith("#") ? value.slice(1) : value;
    if (hex.length === 3) {
      return [
        parseInt(hex[0]! + hex[0]!, 16) / 255,
        parseInt(hex[1]! + hex[1]!, 16) / 255,
        parseInt(hex[2]! + hex[2]!, 16) / 255,
        1,
      ];
    }
    if (hex.length >= 6) {
      const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
        a,
      ];
    }
  }
  return undefined;
}

function parseColorToRgb(value: string | RgbColor | RgbaColor | undefined): RgbColor | undefined {
  const rgba = parseColorToRgba(value);
  if (!rgba) return undefined;
  return [rgba[0], rgba[1], rgba[2]];
}

export function matchesMaterialOverride(
  override: MaterialSlotOverride,
  index: number | undefined,
  name: string | undefined,
): boolean {
  if (override.materialIndex !== undefined && index !== undefined && override.materialIndex === index) {
    return true;
  }
  if (override.target !== undefined) {
    if (typeof override.target === "number" && index !== undefined && override.target === index) {
      return true;
    }
    if (typeof override.target === "string" && name && name.toLowerCase() === override.target.toLowerCase()) {
      return true;
    }
  }
  if (override.materialName !== undefined && name) {
    return name.toLowerCase() === override.materialName.toLowerCase();
  }
  return false;
}

export function applyMaterialOverride(
  material: PBRMaterial,
  override: MaterialSlotOverride,
): PBRMaterial {
  const baseColor = parseColorToRgba(override.baseColor);
  const emissiveColor = parseColorToRgb(override.emissiveColor);
  const intensity = override.emissiveIntensity ?? 1;

  let baseColorFactor = material.baseColorFactor;
  if (baseColor) {
    baseColorFactor = [
      baseColor[0],
      baseColor[1],
      baseColor[2],
      override.alpha !== undefined ? override.alpha : baseColor[3],
    ];
  } else if (override.alpha !== undefined && baseColorFactor) {
    baseColorFactor = [baseColorFactor[0], baseColorFactor[1], baseColorFactor[2], override.alpha];
  }

  let emissiveFactor = material.emissiveFactor;
  if (emissiveColor) {
    emissiveFactor = [emissiveColor[0] * intensity, emissiveColor[1] * intensity, emissiveColor[2] * intensity];
  } else if (override.emissiveIntensity !== undefined && emissiveFactor) {
    emissiveFactor = [
      emissiveFactor[0] * override.emissiveIntensity,
      emissiveFactor[1] * override.emissiveIntensity,
      emissiveFactor[2] * override.emissiveIntensity,
    ];
  }

  return {
    ...material,
    baseColorFactor,
    roughnessFactor: override.roughness !== undefined ? Math.max(0, Math.min(1, override.roughness)) : material.roughnessFactor,
    metallicFactor: override.metallic !== undefined ? Math.max(0, Math.min(1, override.metallic)) : material.metallicFactor,
    emissiveFactor,
    emissiveIntensity: override.emissiveIntensity ?? material.emissiveIntensity,
    normalScale: override.normalScale ?? material.normalScale,
    alpha: override.alpha ?? material.alpha,
    alphaMode: override.alphaMode ?? material.alphaMode,
    transmission: override.transmission ?? material.transmission,
    ior: override.ior ?? material.ior,
  };
}

export function resolveMaterialOverrides(
  material: PBRMaterial,
  index: number | undefined,
  overrides?: readonly MaterialSlotOverride[],
): PBRMaterial {
  if (!overrides || overrides.length === 0) return material;
  let resolved = material;
  for (const override of overrides) {
    if (matchesMaterialOverride(override, index, material.name)) {
      resolved = applyMaterialOverride(resolved, override);
    }
  }
  return resolved;
}
