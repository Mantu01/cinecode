import type { Canvas, ImageData } from "@napi-rs/canvas";
import type { DecodedMetallicRoughness, DecodedNormalMap } from "./types.js";

export function decodeMetallicRoughnessTexture(
  imageData: ImageData,
): DecodedMetallicRoughness {
  const { width, height, data } = imageData;
  const metallic = new Float32Array(width * height);
  const roughness = new Float32Array(width * height);
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    metallic[pixel] = data[i]! / 255;
    roughness[pixel] = data[i + 1]! / 255;
  }
  return { metallic, roughness, width, height };
}

export function decodeNormalMap(imageData: ImageData): DecodedNormalMap {
  const { width, height, data } = imageData;
  const normals = new Float32Array(width * height * 3);
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    const x = (data[i]! / 255) * 2 - 1;
    const y = (data[i + 1]! / 255) * 2 - 1;
    const z = (data[i + 2]! / 255) * 2 - 1;
    const length = Math.hypot(x, y, z) || 1;
    normals[pixel * 3] = x / length;
    normals[pixel * 3 + 1] = y / length;
    normals[pixel * 3 + 2] = z / length;
  }
  return { normals, width, height };
}

export function decodeCanvasNormalMap(canvas: Canvas): DecodedNormalMap {
  const ctx = canvas.getContext("2d");
  return decodeNormalMap(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

export function decodeCanvasMetallicRoughness(canvas: Canvas): DecodedMetallicRoughness {
  const ctx = canvas.getContext("2d");
  return decodeMetallicRoughnessTexture(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

function wrap(value: number, max: number): number {
  if (value < 0) return 0;
  if (value > max - 1) return max - 1;
  return value;
}

export function sampleChannelAt(
  channel: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const x = wrap(u * (width - 1), width);
  const y = wrap(v * (height - 1), height);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = channel[y0 * width + x0]! * (1 - fx) + channel[y0 * width + x1]! * fx;
  const bottom = channel[y1 * width + x0]! * (1 - fx) + channel[y1 * width + x1]! * fx;
  return top * (1 - fy) + bottom * fy;
}

export function sampleTextureAt(
  texture: { readonly width: number; readonly height: number },
  channel: Float32Array,
  u: number,
  v: number,
): number {
  return sampleChannelAt(channel, texture.width, texture.height, u, v);
}

function sampleVectorChannel(
  data: Float32Array,
  width: number,
  height: number,
  offset: number,
  u: number,
  v: number,
): number {
  const x = wrap(u * (width - 1), width);
  const y = wrap(v * (height - 1), height);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = data[(y0 * width + x0) * 3 + offset]! * (1 - fx) + data[(y0 * width + x1) * 3 + offset]! * fx;
  const bottom = data[(y1 * width + x0) * 3 + offset]! * (1 - fx) + data[(y1 * width + x1) * 3 + offset]! * fx;
  return top * (1 - fy) + bottom * fy;
}

export function sampleNormalAt(
  decoded: DecodedNormalMap,
  u: number,
  v: number,
  scale = 1,
): readonly [number, number, number] {
  const x = sampleVectorChannel(decoded.normals, decoded.width, decoded.height, 0, u, v) * scale;
  const y = sampleVectorChannel(decoded.normals, decoded.width, decoded.height, 1, u, v) * scale;
  const z = sampleVectorChannel(decoded.normals, decoded.width, decoded.height, 2, u, v);
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}
