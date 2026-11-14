import type { EffectInput } from "../../effects/engine.js";
import { getData, putData } from "../../effects/engine.js";

export interface EffectBatchEntry {
  readonly name: string;
  readonly params: Record<string, unknown>;
  readonly priority?: number;
  readonly apply: (input: EffectInput) => void;
}

export type ColorPassKind = "brightness" | "contrast" | "saturation" | "hue-rotate";

export interface FusedColorPass {
  readonly kind: ColorPassKind;
  readonly amount: number;
}

export interface EffectBatchPlan {
  readonly fused: readonly FusedColorPass[];
  readonly spatial: readonly EffectBatchEntry[];
  readonly allocationsSaved: number;
  readonly fusedNames: readonly string[];
  readonly spatialNames: readonly string[];
}

export interface EffectBatchMetrics {
  readonly batches: number;
  readonly fusedPasses: number;
  readonly allocationsSaved: number;
  readonly durationMs: number;
}

const FUSIBLE_EFFECTS: readonly ColorPassKind[] = ["brightness", "contrast", "saturation", "hue-rotate"];

function isFusible(name: string): name is ColorPassKind {
  return (FUSIBLE_EFFECTS as readonly string[]).includes(name);
}

function numericParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function fusedAmount(kind: ColorPassKind, params: Record<string, unknown>): number {
  switch (kind) {
    case "brightness":
      return numericParam(params, "amount", 0);
    case "contrast":
      return numericParam(params, "amount", 0);
    case "saturation":
      return numericParam(params, "amount", 1);
    case "hue-rotate":
      return numericParam(params, "degrees", 0);
  }
}

const pingPongPools = new Map<string, [Uint8ClampedArray, Uint8ClampedArray]>();

function getPingPongPair(width: number, height: number): [Uint8ClampedArray, Uint8ClampedArray] {
  const key = `${width}x${height}`;
  const bytes = width * height * 4;
  const existing = pingPongPools.get(key);
  if (existing && existing[0].length === bytes) return existing;
  const pair: [Uint8ClampedArray, Uint8ClampedArray] = [new Uint8ClampedArray(bytes), new Uint8ClampedArray(bytes)];
  pingPongPools.set(key, pair);
  return pair;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function applyBrightness(data: Uint8ClampedArray, amount: number): void {
  if (amount === 0) return;
  const factor = 1 + amount;
  for (let index = 0; index < data.length; index += 4) {
    data[index] = clampByte((data[index] ?? 0) * factor);
    data[index + 1] = clampByte((data[index + 1] ?? 0) * factor);
    data[index + 2] = clampByte((data[index + 2] ?? 0) * factor);
  }
}

function applyContrast(data: Uint8ClampedArray, amount: number): void {
  if (amount === 0) return;
  const factor = (259 * (amount * 255 + 255)) / (255 * (259 - amount * 255));
  for (let index = 0; index < data.length; index += 4) {
    data[index] = clampByte(factor * ((data[index] ?? 0) - 128) + 128);
    data[index + 1] = clampByte(factor * ((data[index + 1] ?? 0) - 128) + 128);
    data[index + 2] = clampByte(factor * ((data[index + 2] ?? 0) - 128) + 128);
  }
}

function applySaturation(data: Uint8ClampedArray, amount: number): void {
  if (amount === 1) return;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    const gray = 0.299 * red + 0.587 * green + 0.114 * blue;
    data[index] = clampByte(gray + amount * (red - gray));
    data[index + 1] = clampByte(gray + amount * (green - gray));
    data[index + 2] = clampByte(gray + amount * (blue - gray));
  }
}

function applyHueRotate(data: Uint8ClampedArray, degrees: number): void {
  if (degrees % 360 === 0) return;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rowR = [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928];
  const rowG = [0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283];
  const rowB = [0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072];
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    data[index] = clampByte(red * rowR[0]! + green * rowR[1]! + blue * rowR[2]!);
    data[index + 1] = clampByte(red * rowG[0]! + green * rowG[1]! + blue * rowG[2]!);
    data[index + 2] = clampByte(red * rowB[0]! + green * rowB[1]! + blue * rowB[2]!);
  }
}

function applyFusedPasses(data: Uint8ClampedArray, passes: readonly FusedColorPass[]): void {
  for (const pass of passes) {
    switch (pass.kind) {
      case "brightness":
        applyBrightness(data, pass.amount);
        break;
      case "contrast":
        applyContrast(data, pass.amount);
        break;
      case "saturation":
        applySaturation(data, pass.amount);
        break;
      case "hue-rotate":
        applyHueRotate(data, pass.amount);
        break;
    }
  }
}

export class EffectGraphOptimizer {
  private lastPlan: EffectBatchPlan | null = null;

  plan(entries: readonly EffectBatchEntry[]): EffectBatchPlan {
    const ordered = [...entries].sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
    const fused: FusedColorPass[] = [];
    const fusedNames: string[] = [];
    const spatial: EffectBatchEntry[] = [];

    for (const entry of ordered) {
      if (isFusible(entry.name)) {
        fused.push({ kind: entry.name, amount: fusedAmount(entry.name, entry.params) });
        fusedNames.push(entry.name);
        continue;
      }
      spatial.push(entry);
    }

    const plan: EffectBatchPlan = {
      fused,
      spatial,
      allocationsSaved: Math.max(0, fused.length - 1),
      fusedNames,
      spatialNames: spatial.map((entry) => entry.name),
    };
    this.lastPlan = plan;
    return plan;
  }

  execute(input: EffectInput, entries: readonly EffectBatchEntry[]): EffectBatchMetrics {
    const started = Date.now();
    const plan = this.plan(entries);
    const [bufferA, bufferB] = getPingPongPair(input.width, input.height);

    if (plan.fused.length > 0) {
      const data = getData(input);
      bufferA.set(data);
      applyFusedPasses(bufferA, plan.fused);
      putData(input, bufferA);
    }

    let batches = plan.fused.length > 0 ? 1 : 0;
    for (const entry of plan.spatial) {
      entry.apply(input);
      batches += 1;
    }

    void bufferB;
    return {
      batches,
      fusedPasses: plan.fused.length,
      allocationsSaved: plan.allocationsSaved,
      durationMs: Date.now() - started,
    };
  }

  getLastPlan(): EffectBatchPlan | null {
    return this.lastPlan;
  }
}

export function createEffectGraphOptimizer(): EffectGraphOptimizer {
  return new EffectGraphOptimizer();
}

export function clearFusedBufferCache(): void {
  pingPongPools.clear();
}
