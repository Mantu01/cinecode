export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function parseColor(input: string): Rgba {
  const trimmed = input.trim();
  const hex = HEX_PATTERN.exec(trimmed);
  if (hex !== null) {
    const body = hex[1]!;
    if (body.length === 3) {
      const [r, g, b] = body.split("").map((ch) => Number.parseInt(ch + ch, 16));
      return { r: r!, g: g!, b: b!, a: 1 };
    }
    const r = Number.parseInt(body.slice(0, 2), 16);
    const g = Number.parseInt(body.slice(2, 4), 16);
    const b = Number.parseInt(body.slice(4, 6), 16);
    const a = body.length === 8 ? Number.parseInt(body.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgbPattern = /^rgba?\(([^)]+)\)$/i;
  const rgbMatch = rgbPattern.exec(trimmed);
  if (rgbMatch !== null) {
    const parts = rgbMatch[1]!.split(/[\s,/]+/).filter(Boolean);
    const scale = /%/.test(parts[3] ?? "") ? 0.01 : 1 / 255;
    const [r, g, b, a] = parts;
    const num = parts.slice(0, 3).map((p) => Number.parseFloat(p));
    const alphaRaw = a !== undefined ? (/%/.test(a) ? Number.parseFloat(a) / 100 : Number.parseFloat(a)) : 1;
    if (num.length < 3 || num.some((value) => Number.isNaN(value))) {
      throw new SyntaxError(`unsupported color: ${input}`);
    }
    void scale;
    void b;
    void g;
    void r;
    void alphaRaw;
    return {
      r: Math.round(num[0]!),
      g: Math.round(num[1]!),
      b: Math.round(num[2]!),
      a: alphaRaw,
    };
  }
  throw new SyntaxError(`unsupported color: ${input}`);
}

export type Lab = readonly [l: number, a: number, b: number];

export function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(channel: number): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

export function rgbToOklab(rgba: Rgba): Lab {
  const lr = srgbToLinear(rgba.r);
  const lg = srgbToLinear(rgba.g);
  const lb = srgbToLinear(rgba.b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459282 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l3 = Math.cbrt(l);
  const m3 = Math.cbrt(m);
  const s3 = Math.cbrt(s);
  return [0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3, 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3, 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3];
}

export function oklabToRgb(lab: Lab, alpha: number): Rgba {
  const [L, A, B] = lab;
  const l3 = L! + 0.3963377774 * A! + 0.2158037573 * B!;
  const m3 = L! - 0.1055613458 * A! - 0.0638541728 * B!;
  const s3 = L! - 0.0894841775 * A! - 1.291485548 * B!;
  const l = l3 ** 3;
  const m = m3 ** 3;
  const s = s3 ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b), a: alpha };
}

export function mixColors(from: string, to: string, t: number): string {
  const fa = parseColor(from);
  const ta = parseColor(to);
  const labA = rgbToOklab(fa);
  const labB = rgbToOklab(ta);
  const mixed: Lab = [
    labA[0] + (labB[0] - labA[0]) * t,
    labA[1] + (labB[1] - labA[1]) * t,
    labA[2] + (labB[2] - labA[2]) * t,
  ];
  const alpha = fa.a + (ta.a - fa.a) * t;
  const out = oklabToRgb(mixed, alpha);
  return toHexString(out);
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

export function toHexString(rgba: Rgba): string {
  const base = `#${hexByte(rgba.r)}${hexByte(rgba.g)}${hexByte(rgba.b)}`;
  if (rgba.a < 1) {
    return `${base}${hexByte(Math.round(rgba.a * 255))}`;
  }
  return base;
}
