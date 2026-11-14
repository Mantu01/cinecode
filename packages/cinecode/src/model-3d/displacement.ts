import type { SKRSContext2D } from "@napi-rs/canvas";
import type { MeshGeometry } from "./primitives/mesh-builder.js";
import { computeTangents } from "./primitives/mesh-builder.js";

export type HeightmapSampler = (u: number, v: number, time?: number) => number;

export interface WaveOctave {
  amplitude: number;
  wavelength: number;
  speed: number;
  direction: [number, number];
  steepness?: number;
}

export interface DisplacementOptions {
  scale?: number;
  offset?: number;
  time?: number;
  recalculateNormals?: boolean;
  recalculateTangents?: boolean;
}

export interface TessellatedGridOptions {
  width?: number;
  depth?: number;
  segmentsX?: number;
  segmentsZ?: number;
}

export interface TessellatedSphereOptions {
  radius?: number;
  segmentsU?: number;
  segmentsV?: number;
}

export function createTessellatedGrid(options: TessellatedGridOptions = {}): MeshGeometry {
  const width = options.width ?? 10;
  const depth = options.depth ?? 10;
  const segX = options.segmentsX ?? 64;
  const segZ = options.segmentsZ ?? 64;

  const vertexCount = (segX + 1) * (segZ + 1);
  const indexCount = segX * segZ * 6;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);

  let vIdx = 0;
  let uvIdx = 0;

  for (let z = 0; z <= segZ; z++) {
    const vz = (z / segZ - 0.5) * depth;
    const v = z / segZ;
    for (let x = 0; x <= segX; x++) {
      const vx = (x / segX - 0.5) * width;
      const u = x / segX;

      positions[vIdx * 3] = vx;
      positions[vIdx * 3 + 1] = 0;
      positions[vIdx * 3 + 2] = vz;

      normals[vIdx * 3] = 0;
      normals[vIdx * 3 + 1] = 1;
      normals[vIdx * 3 + 2] = 0;

      uvs[uvIdx * 2] = u;
      uvs[uvIdx * 2 + 1] = v;

      vIdx++;
      uvIdx++;
    }
  }

  let iIdx = 0;
  for (let z = 0; z < segZ; z++) {
    for (let x = 0; x < segX; x++) {
      const a = z * (segX + 1) + x;
      const b = (z + 1) * (segX + 1) + x;
      const c = (z + 1) * (segX + 1) + (x + 1);
      const d = z * (segX + 1) + (x + 1);

      indices[iIdx++] = a;
      indices[iIdx++] = b;
      indices[iIdx++] = d;

      indices[iIdx++] = b;
      indices[iIdx++] = c;
      indices[iIdx++] = d;
    }
  }

  const tangents = computeTangents(positions, normals, uvs, indices);
  return { positions, normals, uvs, indices, tangents };
}

export function createTessellatedSphere(options: TessellatedSphereOptions = {}): MeshGeometry {
  const radius = options.radius ?? 5;
  const segU = options.segmentsU ?? 64;
  const segV = options.segmentsV ?? 32;

  const vertexCount = (segU + 1) * (segV + 1);
  const indexCount = segU * segV * 6;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);

  let vIdx = 0;
  for (let y = 0; y <= segV; y++) {
    const v = y / segV;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let x = 0; x <= segU; x++) {
      const u = x / segU;
      const theta = u * Math.PI * 2;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      const nx = -sinPhi * cosTheta;
      const ny = cosPhi;
      const nz = sinPhi * sinTheta;

      positions[vIdx * 3] = nx * radius;
      positions[vIdx * 3 + 1] = ny * radius;
      positions[vIdx * 3 + 2] = nz * radius;

      normals[vIdx * 3] = nx;
      normals[vIdx * 3 + 1] = ny;
      normals[vIdx * 3 + 2] = nz;

      uvs[vIdx * 2] = u;
      uvs[vIdx * 2 + 1] = v;

      vIdx++;
    }
  }

  let iIdx = 0;
  for (let y = 0; y < segV; y++) {
    for (let x = 0; x < segU; x++) {
      const a = y * (segU + 1) + x;
      const b = (y + 1) * (segU + 1) + x;
      const c = (y + 1) * (segU + 1) + (x + 1);
      const d = y * (segU + 1) + (x + 1);

      indices[iIdx++] = a;
      indices[iIdx++] = b;
      indices[iIdx++] = d;

      indices[iIdx++] = b;
      indices[iIdx++] = c;
      indices[iIdx++] = d;
    }
  }

  const tangents = computeTangents(positions, normals, uvs, indices);
  return { positions, normals, uvs, indices, tangents };
}

export function createImageHeightmapSampler(
  image: { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
): HeightmapSampler {
  const { width, height, data } = image;
  return (u: number, v: number): number => {
    const cu = Math.max(0, Math.min(1, u));
    const cv = Math.max(0, Math.min(1, v));
    const px = Math.min(width - 1, Math.floor(cu * (width - 1)));
    const py = Math.min(height - 1, Math.floor(cv * (height - 1)));
    const offset = (py * width + px) * 4;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
}

export function createWaterWaveSampler(octaves: WaveOctave[]): HeightmapSampler {
  return (u: number, v: number, time = 0): number => {
    let elevation = 0;
    for (let i = 0; i < octaves.length; i++) {
      const oct = octaves[i]!;
      const dirLen = Math.hypot(oct.direction[0], oct.direction[1]) || 1;
      const dx = oct.direction[0] / dirLen;
      const dy = oct.direction[1] / dirLen;
      const k = (2 * Math.PI) / oct.wavelength;
      const phase = k * (u * dx + v * dy) + oct.speed * time;
      elevation += oct.amplitude * Math.sin(phase);
    }
    return elevation;
  };
}

export function createPerlinHeightmapSampler(options: {
  scale?: number;
  octaves?: number;
  persistence?: number;
  lacunarity?: number;
} = {}): HeightmapSampler {
  const scale = options.scale ?? 4.0;
  const numOctaves = options.octaves ?? 4;
  const persistence = options.persistence ?? 0.5;
  const lacunarity = options.lacunarity ?? 2.0;

  function hash(x: number, y: number): number {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  function noise2D(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);

    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);

    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  return (u: number, v: number, time = 0): number => {
    let total = 0;
    let frequency = scale;
    let amplitude = 1.0;
    let maxAmp = 0;

    for (let o = 0; o < numOctaves; o++) {
      total += noise2D(u * frequency + time * 0.1, v * frequency + time * 0.1) * amplitude;
      maxAmp += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxAmp;
  };
}

export function displaceMesh(
  geometry: MeshGeometry,
  sampler: HeightmapSampler,
  options: DisplacementOptions = {},
): MeshGeometry {
  const scale = options.scale ?? 1.0;
  const offset = options.offset ?? 0.0;
  const time = options.time ?? 0;
  const recalcNormals = options.recalculateNormals !== false;
  const recalcTangents = options.recalculateTangents !== false;

  const count = geometry.positions.length / 3;
  const outPositions = new Float32Array(geometry.positions.length);
  const outNormals = new Float32Array(geometry.normals.length);
  const outUvs = new Float32Array(geometry.uvs);
  const indices = geometry.indices;

  for (let i = 0; i < count; i++) {
    const u = geometry.uvs[i * 2] ?? 0;
    const v = geometry.uvs[i * 2 + 1] ?? 0;

    const h = sampler(u, v, time) * scale + offset;

    const px = geometry.positions[i * 3] ?? 0;
    const py = geometry.positions[i * 3 + 1] ?? 0;
    const pz = geometry.positions[i * 3 + 2] ?? 0;

    const nx = geometry.normals[i * 3] ?? 0;
    const ny = geometry.normals[i * 3 + 1] ?? 0;
    const nz = geometry.normals[i * 3 + 2] ?? 0;

    outPositions[i * 3] = px + nx * h;
    outPositions[i * 3 + 1] = py + ny * h;
    outPositions[i * 3 + 2] = pz + nz * h;
  }

  if (recalcNormals) {
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i]!;
      const i1 = indices[i + 1]!;
      const i2 = indices[i + 2]!;

      const p0x = outPositions[i0 * 3]!, p0y = outPositions[i0 * 3 + 1]!, p0z = outPositions[i0 * 3 + 2]!;
      const p1x = outPositions[i1 * 3]!, p1y = outPositions[i1 * 3 + 1]!, p1z = outPositions[i1 * 3 + 2]!;
      const p2x = outPositions[i2 * 3]!, p2y = outPositions[i2 * 3 + 1]!, p2z = outPositions[i2 * 3 + 2]!;

      const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
      const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;

      const fnx = e1y * e2z - e1z * e2y;
      const fny = e1z * e2x - e1x * e2z;
      const fnz = e1x * e2y - e1y * e2x;

      outNormals[i0 * 3] = (outNormals[i0 * 3] ?? 0) + fnx;
      outNormals[i0 * 3 + 1] = (outNormals[i0 * 3 + 1] ?? 0) + fny;
      outNormals[i0 * 3 + 2] = (outNormals[i0 * 3 + 2] ?? 0) + fnz;

      outNormals[i1 * 3] = (outNormals[i1 * 3] ?? 0) + fnx;
      outNormals[i1 * 3 + 1] = (outNormals[i1 * 3 + 1] ?? 0) + fny;
      outNormals[i1 * 3 + 2] = (outNormals[i1 * 3 + 2] ?? 0) + fnz;

      outNormals[i2 * 3] = (outNormals[i2 * 3] ?? 0) + fnx;
      outNormals[i2 * 3 + 1] = (outNormals[i2 * 3 + 1] ?? 0) + fny;
      outNormals[i2 * 3 + 2] = (outNormals[i2 * 3 + 2] ?? 0) + fnz;
    }

    for (let i = 0; i < count; i++) {
      const nx = outNormals[i * 3] ?? 0;
      const ny = outNormals[i * 3 + 1] ?? 0;
      const nz = outNormals[i * 3 + 2] ?? 0;
      const len = Math.hypot(nx, ny, nz) || 1;
      outNormals[i * 3] = nx / len;
      outNormals[i * 3 + 1] = ny / len;
      outNormals[i * 3 + 2] = nz / len;
    }
  } else {
    outNormals.set(geometry.normals);
  }

  const outTangents = recalcTangents
    ? computeTangents(outPositions, outNormals, outUvs, indices)
    : new Float32Array(geometry.tangents);

  return {
    positions: outPositions,
    normals: outNormals,
    uvs: outUvs,
    indices,
    tangents: outTangents,
  };
}

export function displaceCanvas(
  sourceCtx: SKRSContext2D | CanvasRenderingContext2D,
  targetCtx: SKRSContext2D | CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  waves: WaveOctave[] = [
    { amplitude: 8, wavelength: 0.1, speed: 2, direction: [1, 0.5] },
    { amplitude: 4, wavelength: 0.05, speed: 3, direction: [-0.3, 1] },
  ],
): void {
  const srcImg = sourceCtx.getImageData(0, 0, width, height);
  const dstImg = targetCtx.createImageData(width, height);
  const src = srcImg.data;
  const dst = dstImg.data;

  const waveSampler = createWaterWaveSampler(waves);

  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const disp = waveSampler(u, v, time);
      const sx = Math.max(0, Math.min(width - 1, Math.round(x + disp)));
      const sy = Math.max(0, Math.min(height - 1, Math.round(y + disp)));

      const srcIdx = (sy * width + sx) * 4;
      const dstIdx = (y * width + x) * 4;

      dst[dstIdx] = src[srcIdx] ?? 0;
      dst[dstIdx + 1] = src[srcIdx + 1] ?? 0;
      dst[dstIdx + 2] = src[srcIdx + 2] ?? 0;
      dst[dstIdx + 3] = src[srcIdx + 3] ?? 255;
    }
  }

  targetCtx.putImageData(dstImg as any, 0, 0);
}
