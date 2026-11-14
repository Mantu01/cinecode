import type { Rgba, Gradient, GradientStop, LinearGradient, RadialGradient, ConicGradient } from "./types.js";
import { parseColor } from "./parse.js";

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function rgbToOklab(rgba: Rgba): [number, number, number] {
  const lr = srgbToLinear(rgba.r / 255);
  const lg = srgbToLinear(rgba.g / 255);
  const lb = srgbToLinear(rgba.b / 255);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459282 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l3 = Math.cbrt(l);
  const m3 = Math.cbrt(m);
  const s3 = Math.cbrt(s);
  return [
    0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3,
    1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3,
    0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3,
  ];
}

function oklabToRgb(lab: [number, number, number], alpha: number): Rgba {
  const [L, A, B] = lab;
  const l3 = L + 0.3963377774 * A + 0.2158037573 * B;
  const m3 = L - 0.1055613458 * A - 0.0638541728 * B;
  const s3 = L - 0.0894841775 * A - 1.291485548 * B;
  const l = l3 ** 3;
  const m = m3 ** 3;
  const s = s3 ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return {
    r: Math.round(Math.max(0, Math.min(255, linearToSrgb(r) * 255))),
    g: Math.round(Math.max(0, Math.min(255, linearToSrgb(g) * 255))),
    b: Math.round(Math.max(0, Math.min(255, linearToSrgb(b) * 255))),
    a: alpha,
  };
}

export function mixColors(from: string | Rgba, to: string | Rgba, t: number): Rgba {
  const f = typeof from === "string" ? parseColor(from) : from;
  const tColor = typeof to === "string" ? parseColor(to) : to;
  const labA = rgbToOklab(f);
  const labB = rgbToOklab(tColor);
  const mixed: [number, number, number] = [
    labA[0] + (labB[0] - labA[0]) * t,
    labA[1] + (labB[1] - labA[1]) * t,
    labA[2] + (labB[2] - labA[2]) * t,
  ];
  const alpha = f.a + (tColor.a - f.a) * t;
  return oklabToRgb(mixed, alpha);
}

export function lighten(color: string | Rgba, amount: number): Rgba {
  const c = typeof color === "string" ? parseColor(color) : color;
  return { ...c, r: Math.min(255, c.r + amount * 255), g: Math.min(255, c.g + amount * 255), b: Math.min(255, c.b + amount * 255) };
}

export function darken(color: string | Rgba, amount: number): Rgba {
  const c = typeof color === "string" ? parseColor(color) : color;
  return { ...c, r: Math.max(0, c.r - amount * 255), g: Math.max(0, c.g - amount * 255), b: Math.max(0, c.b - amount * 255) };
}

export function alpha(color: string | Rgba, a: number): Rgba {
  const c = typeof color === "string" ? parseColor(color) : color;
  return { ...c, a: Math.max(0, Math.min(1, a)) };
}

export function interpolateGradient(from: Gradient, to: Gradient, t: number): Gradient {
  if (from.type !== to.type) return t < 0.5 ? from : to;
  const stops = from.stops.map((stop, i) => {
    const toStop = to.stops[i] ?? to.stops[to.stops.length - 1]!;
    return { offset: stop.offset + (toStop.offset - stop.offset) * t, color: mixColors(stop.color, toStop.color, t) };
  }) as GradientStop[];
  if (from.type === "linear") {
    const f = from as LinearGradient;
    const t2 = to as LinearGradient;
    return { ...f, angle: f.angle + (t2.angle - f.angle) * t, stops };
  }
  if (from.type === "radial") {
    const f = from as RadialGradient;
    const t2 = to as RadialGradient;
    return { ...f, centerX: f.centerX + (t2.centerX - f.centerX) * t, centerY: f.centerY + (t2.centerY - f.centerY) * t, radius: f.radius + (t2.radius - f.radius) * t, stops };
  }
  const f = from as ConicGradient;
  const t2 = to as ConicGradient;
  return { ...f, angle: f.angle + (t2.angle - f.angle) * t, centerX: f.centerX + (t2.centerX - f.centerX) * t, centerY: f.centerY + (t2.centerY - f.centerY) * t, stops };
}