import { createCanvas, type Canvas } from "@napi-rs/canvas";

export interface DepthBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
  readonly near: number;
  readonly far: number;
}

export function createDepthBuffer(width: number, height: number, near = 0.1, far = 1000): DepthBuffer {
  const data = new Float32Array(width * height).fill(far);
  return { width, height, data, near, far };
}

export function linearizeDepth(ndcZ: number, near: number, far: number): number {
  return (2 * near * far) / (far + near - ndcZ * (far - near));
}

export function calculateCoC(
  depth: number,
  focusDistance: number,
  focalLength = 0.05,
  fStop = 2.8,
): number {
  if (depth <= 0) return 0;
  const s = Math.max(focalLength + 0.001, focusDistance);
  const numerator = (focalLength * focalLength) * Math.abs(s - depth);
  const denominator = fStop * (s - focalLength) * depth;
  return denominator > 0 ? numerator / denominator : 0;
}

export function depthBufferToCanvas(buffer: DepthBuffer): Canvas {
  const canvas = createCanvas(buffer.width, buffer.height);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(buffer.width, buffer.height);
  const range = Math.max(1e-4, buffer.far - buffer.near);

  for (let i = 0; i < buffer.data.length; i += 1) {
    const linear = buffer.data[i]!;
    const norm = Math.max(0, Math.min(1, (linear - buffer.near) / range));
    const byte = Math.round(norm * 255);
    const idx = i * 4;
    imgData.data[idx] = byte;
    imgData.data[idx + 1] = byte;
    imgData.data[idx + 2] = byte;
    imgData.data[idx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}
