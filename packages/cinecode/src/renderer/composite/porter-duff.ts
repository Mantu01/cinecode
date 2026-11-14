export type AlphaMode = "premultiplied" | "straight";

export type PorterDuffOperator =
  | "source-over"
  | "destination-over"
  | "source-in"
  | "destination-in"
  | "source-out"
  | "destination-out"
  | "source-atop"
  | "destination-atop"
  | "xor"
  | "clear"
  | "add";

export interface BufferCompositeOptions {
  readonly operator?: PorterDuffOperator;
  readonly sourceAlpha?: AlphaMode;
  readonly destinationAlpha?: AlphaMode;
  readonly outputAlpha?: AlphaMode;
}

export function premultiplyAlpha(buffer: Uint8ClampedArray): void {
  for (let index = 0; index + 3 < buffer.length; index += 4) {
    const alpha = buffer[index + 3] ?? 0;
    if (alpha === 255) continue;
    if (alpha === 0) {
      buffer[index] = 0;
      buffer[index + 1] = 0;
      buffer[index + 2] = 0;
      continue;
    }
    const scale = alpha / 255;
    buffer[index] = (buffer[index] ?? 0) * scale;
    buffer[index + 1] = (buffer[index + 1] ?? 0) * scale;
    buffer[index + 2] = (buffer[index + 2] ?? 0) * scale;
  }
}

export function unpremultiplyAlpha(buffer: Uint8ClampedArray): void {
  for (let index = 0; index + 3 < buffer.length; index += 4) {
    const alpha = buffer[index + 3] ?? 0;
    if (alpha === 255) continue;
    if (alpha === 0) {
      buffer[index] = 0;
      buffer[index + 1] = 0;
      buffer[index + 2] = 0;
      continue;
    }
    const scale = 255 / alpha;
    buffer[index] = (buffer[index] ?? 0) * scale;
    buffer[index + 1] = (buffer[index + 1] ?? 0) * scale;
    buffer[index + 2] = (buffer[index + 2] ?? 0) * scale;
  }
}

export function convertAlphaMode(buffer: Uint8ClampedArray, from: AlphaMode, to: AlphaMode): void {
  if (from === to) return;
  if (from === "straight" && to === "premultiplied") premultiplyAlpha(buffer);
  else unpremultiplyAlpha(buffer);
}

export interface PorterDuffChannels {
  readonly source: readonly [number, number, number, number];
  readonly destination: readonly [number, number, number, number];
}

export function porterDuffPixel(
  operator: PorterDuffOperator,
  source: readonly [number, number, number, number],
  destination: readonly [number, number, number, number],
): [number, number, number, number] {
  const [sr, sg, sb, sa] = source;
  const [dr, dg, db, da] = destination;
  switch (operator) {
    case "source-over":
      return [sr + dr * (1 - sa), sg + dg * (1 - sa), sb + db * (1 - sa), sa + da * (1 - sa)];
    case "destination-over":
      return [dr + sr * (1 - da), dg + sg * (1 - da), db + sb * (1 - da), da + sa * (1 - da)];
    case "source-in":
      return [sr * da, sg * da, sb * da, sa * da];
    case "destination-in":
      return [dr * sa, dg * sa, db * sa, da * sa];
    case "source-out":
      return [sr * (1 - da), sg * (1 - da), sb * (1 - da), sa * (1 - da)];
    case "destination-out":
      return [dr * (1 - sa), dg * (1 - sa), db * (1 - sa), da * (1 - sa)];
    case "source-atop":
      return [sr * da + dr * (1 - sa), sg * da + dg * (1 - sa), sb * da + db * (1 - sa), da];
    case "destination-atop":
      return [dr * sa + sr * (1 - da), dg * sa + sg * (1 - da), db * sa + sb * (1 - da), sa];
    case "xor":
      return [
        sr * (1 - da) + dr * (1 - sa),
        sg * (1 - da) + dg * (1 - sa),
        sb * (1 - da) + db * (1 - sa),
        sa * (1 - da) + da * (1 - sa),
      ];
    case "clear":
      return [0, 0, 0, 0];
    case "add":
      return [
        Math.min(1, sr + dr),
        Math.min(1, sg + dg),
        Math.min(1, sb + db),
        Math.min(1, sa + da),
      ];
  }
}

export function compositeBuffers(
  source: Uint8ClampedArray,
  destination: Uint8ClampedArray,
  options: BufferCompositeOptions = {},
): Uint8ClampedArray {
  const operator = options.operator ?? "source-over";
  const sourceAlpha = options.sourceAlpha ?? "premultiplied";
  const destinationAlpha = options.destinationAlpha ?? "premultiplied";
  const outputAlpha = options.outputAlpha ?? destinationAlpha;
  const length = Math.min(source.length, destination.length);
  for (let index = 0; index + 3 < length; index += 4) {
    const sa = (source[index + 3] ?? 0) / 255;
    const da = (destination[index + 3] ?? 0) / 255;
    const straightToSource = sourceAlpha === "premultiplied" ? 1 : sa;
    const straightToDestination = destinationAlpha === "premultiplied" ? 1 : da;
    const src: [number, number, number, number] = [
      ((source[index] ?? 0) / 255) * straightToSource,
      ((source[index + 1] ?? 0) / 255) * straightToSource,
      ((source[index + 2] ?? 0) / 255) * straightToSource,
      sa,
    ];
    const dst: [number, number, number, number] = [
      ((destination[index] ?? 0) / 255) * straightToDestination,
      ((destination[index + 1] ?? 0) / 255) * straightToDestination,
      ((destination[index + 2] ?? 0) / 255) * straightToDestination,
      da,
    ];
    const [r, g, b, a] = porterDuffPixel(operator, src, dst);
    const outAlpha = Math.min(1, Math.max(0, a));
    const straightToOutput = outputAlpha === "premultiplied" ? 1 : outAlpha > 1e-6 ? 1 / outAlpha : 0;
    destination[index] = Math.round(Math.min(1, Math.max(0, r * straightToOutput)) * 255);
    destination[index + 1] = Math.round(Math.min(1, Math.max(0, g * straightToOutput)) * 255);
    destination[index + 2] = Math.round(Math.min(1, Math.max(0, b * straightToOutput)) * 255);
    destination[index + 3] = Math.round(outAlpha * 255);
  }
  return destination;
}

export function applyBufferOpacity(buffer: Uint8ClampedArray, opacity: number, alphaMode: AlphaMode = "premultiplied"): void {
  const clamped = Math.min(1, Math.max(0, opacity));
  if (clamped === 1) return;
  for (let index = 0; index + 3 < buffer.length; index += 4) {
    const alpha = buffer[index + 3] ?? 0;
    if (alpha === 0) continue;
    if (alphaMode === "premultiplied") {
      buffer[index] = (buffer[index] ?? 0) * clamped;
      buffer[index + 1] = (buffer[index + 1] ?? 0) * clamped;
      buffer[index + 2] = (buffer[index + 2] ?? 0) * clamped;
    }
    buffer[index + 3] = alpha * clamped;
  }
}

export function canvasOperationForPorterDuff(operator: PorterDuffOperator) {
  switch (operator) {
    case "source-over":
    case "destination-over":
    case "source-in":
    case "destination-in":
    case "source-out":
    case "destination-out":
    case "source-atop":
    case "destination-atop":
    case "xor":
      return operator;
    case "add":
      return "lighter";
    case "clear":
      return "destination-out";
  }
}
