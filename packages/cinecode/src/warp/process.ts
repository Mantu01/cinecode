import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type { WarpGrid } from "./grid.js";
import { invertHomography, applyHomography, projectiveTransform, type Homography } from "./transform.js";

function getCanvasData(canvas: Canvas): { data: Uint8ClampedArray; width: number; height: number } {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: imageData.data, width: canvas.width, height: canvas.height };
}

function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  if (x < -1 || y < -1 || x >= width || y >= height) return [0, 0, 0, 0];
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c += 1) {
    const top = data[i00 + c]! * (1 - fx) + data[i10 + c]! * fx;
    const bottom = data[i01 + c]! * (1 - fx) + data[i11 + c]! * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

export function applyWarp(sourceCanvas: Canvas, grid: WarpGrid, outWidth: number, outHeight: number): Canvas {
  const source = getCanvasData(sourceCanvas);
  const destination = createCanvas(outWidth, outHeight);
  const destCtx = destination.getContext("2d");
  const destImage = destCtx.createImageData(outWidth, outHeight);
  const destData = destImage.data;

  for (const cell of grid.cells) {
    const homography = projectiveTransform(cell.dstPoints, cell.srcPoints);
    warpCell(homography, cell, source, destData, outWidth, outHeight);
  }

  destCtx.putImageData(destImage, 0, 0);
  return destination;
}

function warpCell(
  inverse: Homography,
  cell: { srcPoints: readonly { x: number; y: number }[] },
  source: { data: Uint8ClampedArray; width: number; height: number },
  destData: Uint8ClampedArray,
  outWidth: number,
  outHeight: number,
): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of cell.srcPoints) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const x0 = Math.max(0, Math.floor(minX));
  const x1 = Math.min(outWidth - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(outHeight - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const sourcePoint = applyHomography(x + 0.5, y + 0.5, inverse);
      const [r, g, b, a] = sampleBilinear(source.data, source.width, source.height, sourcePoint.x, sourcePoint.y);
      if (r === 0 && g === 0 && b === 0 && a === 0) continue;
      const index = (y * outWidth + x) * 4;
      destData[index] = r;
      destData[index + 1] = g;
      destData[index + 2] = b;
      destData[index + 3] = a;
    }
  }
}

export function isIdentityWarp(grid: WarpGrid): boolean {
  return grid.cells.every((cell) =>
    cell.srcPoints.every((point, index) =>
      Math.abs(point.x - cell.dstPoints[index]!.x) < 0.01 && Math.abs(point.y - cell.dstPoints[index]!.y) < 0.01,
    ),
  );
}

export { invertHomography, applyHomography, projectiveTransform };
