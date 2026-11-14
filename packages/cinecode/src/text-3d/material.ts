export interface Text3DMaterial {
  readonly frontColor: string;
  readonly sideColor: string;
  readonly backColor: string;
  readonly emissive?: number;
}

function parseHex(value: string): [number, number, number] {
  const hex = value.startsWith("#") ? value.slice(1) : value;
  if (hex.length === 3) {
    return [
      parseInt(hex[0]! + hex[0]!, 16),
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
    ];
  }
  if (hex.length >= 6) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return [255, 255, 255];
}

function toHex(rgb: readonly [number, number, number]): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

export function shadeColor(color: string, factor: number): string {
  const [r, g, b] = parseHex(color);
  return toHex([r * factor, g * factor, b * factor]);
}

export function createTextStyle3d(
  frontColor = "#ffffff",
  sideColor?: string,
  backColor?: string,
): Text3DMaterial {
  return {
    frontColor,
    sideColor: sideColor ?? shadeColor(frontColor, 0.62),
    backColor: backColor ?? shadeColor(frontColor, 0.38),
    emissive: 0,
  };
}
