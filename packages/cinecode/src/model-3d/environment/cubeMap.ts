import { Canvas, loadImage } from "@napi-rs/canvas";

export type CubeFace = "posX" | "negX" | "posY" | "negY" | "posZ" | "negZ";

export interface CubeTexture {
  readonly faces: ReadonlyMap<CubeFace, Canvas>;
  readonly size: number;
}

export interface CubeFacePaths {
  readonly posX: string;
  readonly negX: string;
  readonly posY: string;
  readonly negY: string;
  readonly posZ: string;
  readonly negZ: string;
}

const FACE_ORDER: readonly CubeFace[] = ["posX", "negX", "posY", "negY", "posZ", "negZ"];

export async function loadCubeMap(faces: CubeFacePaths): Promise<CubeTexture> {
  const loaded = new Map<CubeFace, Canvas>();
  let size = 0;
  for (const face of FACE_ORDER) {
    const image = await loadImage(faces[face]);
    size = Math.max(size, image.width, image.height);
    const canvas = new Canvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    loaded.set(face, canvas);
  }
  if (size === 0) throw new Error("Cube map faces could not be loaded");
  return { faces: loaded, size };
}

export async function loadEquirectangular(src: string, faceSize = 512): Promise<CubeTexture> {
  const image = await loadImage(src);
  const source = new Canvas(image.width, image.height);
  const sourceCtx = source.getContext("2d");
  sourceCtx.drawImage(image, 0, 0);
  const sourceData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const faces = new Map<CubeFace, Canvas>();

  for (const face of FACE_ORDER) {
    const canvas = new Canvas(faceSize, faceSize);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(faceSize, faceSize);
    for (let y = 0; y < faceSize; y += 1) {
      for (let x = 0; x < faceSize; x += 1) {
        const u = (x + 0.5) / faceSize;
        const v = (y + 0.5) / faceSize;
        const direction = faceDirection(face, u, v);
        const longitude = Math.atan2(direction[0], direction[2]);
        const latitude = Math.asin(Math.max(-1, Math.min(1, direction[1])));
        const sampleU = longitude / (Math.PI * 2) + 0.5;
        const sampleV = latitude / Math.PI + 0.5;
        const sx = Math.min(source.width - 1, Math.max(0, Math.floor(sampleU * source.width)));
        const sy = Math.min(source.height - 1, Math.max(0, Math.floor((1 - sampleV) * source.height)));
        const sourceIndex = (sy * source.width + sx) * 4;
        const targetIndex = (y * faceSize + x) * 4;
        imageData.data[targetIndex] = sourceData.data[sourceIndex]!;
        imageData.data[targetIndex + 1] = sourceData.data[sourceIndex + 1]!;
        imageData.data[targetIndex + 2] = sourceData.data[sourceIndex + 2]!;
        imageData.data[targetIndex + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    faces.set(face, canvas);
  }

  return { faces, size: faceSize };
}

function faceDirection(face: CubeFace, u: number, v: number): [number, number, number] {
  const a = u * 2 - 1;
  const b = v * 2 - 1;
  switch (face) {
    case "posX":
      return [1, -b, -a];
    case "negX":
      return [-1, -b, a];
    case "posY":
      return [a, 1, b];
    case "negY":
      return [a, -1, -b];
    case "posZ":
      return [a, -b, 1];
    case "negZ":
      return [-a, -b, -1];
  }
}
