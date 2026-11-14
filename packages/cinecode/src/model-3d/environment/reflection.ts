import type { Canvas, ImageData } from "@napi-rs/canvas";
import type { CubeFace, CubeTexture } from "./cubeMap.js";
import { rotateVectorEuler } from "./sh.js";

export type EnvironmentSample = readonly [number, number, number];

export interface EnvironmentOptions {
  readonly rotationX?: number;
  readonly rotationY?: number;
  readonly rotationZ?: number;
  readonly exposure?: number;
  readonly tint?: readonly [number, number, number];
}

interface FaceSelector {
  readonly face: CubeFace;
  readonly u: number;
  readonly v: number;
}

function selectFace(direction: readonly [number, number, number]): FaceSelector {
  const [x, y, z] = direction;
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  const absZ = Math.abs(z);

  if (absX >= absY && absX >= absZ) {
    if (x >= 0) return { face: "posX", u: (-z / absX + 1) * 0.5, v: (-y / absX + 1) * 0.5 };
    return { face: "negX", u: (z / absX + 1) * 0.5, v: (-y / absX + 1) * 0.5 };
  }
  if (absY >= absZ) {
    if (y >= 0) return { face: "posY", u: (x / absY + 1) * 0.5, v: (z / absY + 1) * 0.5 };
    return { face: "negY", u: (x / absY + 1) * 0.5, v: (-z / absY + 1) * 0.5 };
  }
  if (z >= 0) return { face: "posZ", u: (x / absZ + 1) * 0.5, v: (-y / absZ + 1) * 0.5 };
  return { face: "negZ", u: (-x / absZ + 1) * 0.5, v: (-y / absZ + 1) * 0.5 };
}

const faceDataCache = new WeakMap<Canvas, ImageData>();

function faceData(canvas: Canvas): ImageData {
  const cached = faceDataCache.get(canvas);
  if (cached) return cached;
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  faceDataCache.set(canvas, data);
  return data;
}

export function sampleEnvMap(
  cubeTex: CubeTexture,
  direction: readonly [number, number, number],
  mipLevel = 0,
  options?: EnvironmentOptions,
): EnvironmentSample {
  let dir = direction;
  if (options && (options.rotationX || options.rotationY || options.rotationZ)) {
    dir = rotateVectorEuler(
      direction,
      -(options.rotationX ?? 0),
      -(options.rotationY ?? 0),
      -(options.rotationZ ?? 0),
    );
  }
  const selector = selectFace(dir);
  const face = cubeTex.faces.get(selector.face);
  if (!face) return [0, 0, 0];
  const data = faceData(face);
  const step = Math.max(1, 2 ** Math.round(mipLevel));
  const x = Math.min(face.width - 1, Math.max(0, Math.floor(selector.u * face.width)));
  const y = Math.min(face.height - 1, Math.max(0, Math.floor(selector.v * face.height)));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let sy = y; sy < Math.min(face.height, y + step); sy += 1) {
    for (let sx = x; sx < Math.min(face.width, x + step); sx += 1) {
      const index = (sy * face.width + sx) * 4;
      r += data.data[index]!;
      g += data.data[index + 1]!;
      b += data.data[index + 2]!;
      count += 1;
    }
  }
  if (count === 0) return [0, 0, 0];

  const exposureMult = options?.exposure !== undefined ? Math.pow(2, options.exposure) : 1;
  const tint = options?.tint ?? [1, 1, 1];
  return [
    Math.min(1, (r / count / 255) * exposureMult * tint[0]),
    Math.min(1, (g / count / 255) * exposureMult * tint[1]),
    Math.min(1, (b / count / 255) * exposureMult * tint[2]),
  ];
}
