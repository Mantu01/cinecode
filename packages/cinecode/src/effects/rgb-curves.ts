import type { EffectInput, EffectProcessor } from "./engine.js";
import { defineEffect, getData, putData } from "./engine.js";
import { registerEffect } from "../extensions/index.js";

export interface CurvePoint {
  readonly x: number;
  readonly y: number;
}

export interface ColorCurves {
  red?: CurvePoint[];
  green?: CurvePoint[];
  blue?: CurvePoint[];
  master?: CurvePoint[];
}

const DEFAULT_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.5 },
  { x: 1, y: 1 },
];

function buildLookupTable(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let prev = points[0]!;
    let next = points[points.length - 1]!;
    for (let j = 0; j < points.length - 1; j++) {
      if (x >= points[j]!.x && x <= points[j + 1]!.x) {
        prev = points[j]!;
        next = points[j + 1]!;
        break;
      }
    }
    const t = next.x !== prev.x ? (x - prev.x) / (next.x - prev.x) : 0;
    lut[i] = Math.round((prev.y + (next.y - prev.y) * t) * 255);
  }
  return lut;
}

export function applyColorCurves(input: EffectInput, curves: ColorCurves): void {
  const data = getData(input);

  const master = curves.master ?? DEFAULT_CURVE;
  const redLut = buildLookupTable(curves.red ?? master);
  const greenLut = buildLookupTable(curves.green ?? master);
  const blueLut = buildLookupTable(curves.blue ?? master);

  for (let i = 0; i < data.length; i += 4) {
    data[i]     = redLut[data[i]!]!;
    data[i + 1] = greenLut[data[i + 1]!]!;
    data[i + 2] = blueLut[data[i + 2]!]!;
  }
  putData(input, data);
}

export const rgbCurvesEffect: EffectProcessor = defineEffect({
  name: "rgb-curves",
  params: {},
  process: (input, params) => {
    const curves: ColorCurves = {};
    if (params.red) curves.red = parseCurvePoints(params.red as number[]);
    if (params.green) curves.green = parseCurvePoints(params.green as number[]);
    if (params.blue) curves.blue = parseCurvePoints(params.blue as number[]);
    if (params.master) curves.master = parseCurvePoints(params.master as number[]);
    applyColorCurves(input, curves);
  },
});

function parseCurvePoints(flat: number[]): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    points.push({ x: flat[i]!, y: flat[i + 1]! });
  }
  return points.sort((a, b) => a.x - b.x);
}

registerEffect(rgbCurvesEffect);
