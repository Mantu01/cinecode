import type { Canvas } from "@napi-rs/canvas";
import { createTextureCanvas, fbm, hexToRgb, seededRandom } from "./common.js";

export interface ConcreteTextureParams {
  readonly roughness?: number;
  readonly color?: string;
  readonly aggregateSize?: number;
  readonly aggregateDensity?: number;
  readonly crackDensity?: number;
  readonly seed?: number;
  readonly scale?: number;
}

interface Aggregate {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly shade: number;
}

export function generateConcreteTexture(width: number, height: number, params: ConcreteTextureParams = {}): Canvas {
  const base = hexToRgb(params.color ?? "#9a9a96", { r: 154, g: 154, b: 150 });
  const roughness = params.roughness ?? 0.5;
  const aggregateSize = Math.max(1, params.aggregateSize ?? 5);
  const aggregateDensity = Math.max(0, Math.min(1, params.aggregateDensity ?? 0.25));
  const crackDensity = Math.max(0, Math.min(1, params.crackDensity ?? 0.2));
  const seed = params.seed ?? 17;
  const scale = params.scale ?? 0.01;
  const rng = seededRandom(seed);
  const aggregates: Aggregate[] = [];
  const aggregateCount = Math.round((width * height) / 900 * aggregateDensity * 8);
  for (let index = 0; index < aggregateCount; index += 1) {
    aggregates.push({
      x: rng.range(0, width),
      y: rng.range(0, height),
      radius: aggregateSize * rng.range(0.5, 1.6),
      shade: rng.range(0.55, 0.85),
    });
  }

  return createTextureCanvas(width, height, (x, y) => {
    const large = fbm(seed, x * scale * 0.25, y * scale * 0.25, 3);
    const medium = fbm(seed + 101, x * scale * 2, y * scale * 2, 4);
    const fine = fbm(seed + 211, x * scale * 14, y * scale * 14, 2);
    let shading = 0.78 + large * 0.22 + medium * 0.16 * roughness + fine * 0.08 * roughness;

    for (const aggregate of aggregates) {
      const distance = Math.hypot(x - aggregate.x, y - aggregate.y);
      if (distance < aggregate.radius) {
        const contact = 1 - distance / aggregate.radius;
        shading *= 0.72 + contact * aggregate.shade * 0.28;
        break;
      }
    }

    const crackField = Math.abs(fbm(seed + 307, x * scale * 1.6, y * scale * 1.6, 4) - 0.5);
    if (crackField < 0.012 * crackDensity) shading *= 0.55;

    return { r: base.r * shading, g: base.g * shading, b: base.b * shading };
  });
}
