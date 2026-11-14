export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

export interface ShadowSceneObject {
  readonly triangles: readonly (readonly [Vec3, Vec3, Vec3])[];
}

export interface ShadowBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface ShadowMapOptions {
  readonly resolution?: number;
  readonly groundY?: number;
  readonly softness?: number;
  readonly bounds?: ShadowBounds;
}

export interface ShadowMap {
  readonly data: Uint8Array;
  readonly resolution: number;
  readonly bounds: ShadowBounds;
  readonly groundY: number;
}

export function projectPointToGround(point: Vec3, lightDirection: Vec3, groundY: number): Vec2 {
  const lightY = lightDirection[1];
  if (Math.abs(lightY) < 1e-5) return [point[0], point[2]];
  const t = (point[1] - groundY) / lightY;
  return [point[0] - lightDirection[0] * t, point[2] - lightDirection[2] * t];
}

export function renderShadowMap(
  objects: readonly ShadowSceneObject[],
  lightDirection: Vec3,
  options: ShadowMapOptions = {},
): ShadowMap {
  const resolution = Math.max(32, Math.round(options.resolution ?? 512));
  const groundY = options.groundY ?? 0;
  const data = new Uint8Array(resolution * resolution).fill(255);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const object of objects) {
    for (const triangle of object.triangles) {
      for (const vertex of triangle) {
        const [x, z] = projectPointToGround(vertex, lightDirection, groundY);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
  }

  const bounds = options.bounds ?? (Number.isFinite(minX)
    ? { minX, maxX, minZ, maxZ }
    : { minX: -1, maxX: 1, minZ: -1, maxZ: 1 });
  const spanX = Math.max(1e-4, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1e-4, bounds.maxZ - bounds.minZ);

  const toPixel = (x: number, z: number): Vec2 => [
    ((x - bounds.minX) / spanX) * (resolution - 1),
    ((z - bounds.minZ) / spanZ) * (resolution - 1),
  ];

  for (const object of objects) {
    for (const triangle of object.triangles) {
      const projected = triangle.map((vertex) => toPixel(...projectPointToGround(vertex, lightDirection, groundY)));
      rasterizeTriangle(data, resolution, projected[0]!, projected[1]!, projected[2]!);
    }
  }

  const softness = Math.max(0, options.softness ?? 0.1);
  if (softness > 0) {
    boxBlur(data, resolution, Math.max(0, Math.round(softness * resolution * 0.1)));
  }

  return { data, resolution, bounds, groundY };
}

function rasterizeTriangle(data: Uint8Array, size: number, a: Vec2, b: Vec2, c: Vec2): void {
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections: number[] = [];
    for (const [p1, p2] of [[a, b], [b, c], [c, a]] as const) {
      const y1 = p1[1];
      const y2 = p2[1];
      if (y1 === y2) continue;
      if ((y >= Math.min(y1, y2)) && (y <= Math.max(y1, y2))) {
        const t = (y - y1) / (y2 - y1);
        intersections.push(p1[0] + (p2[0] - p1[0]) * t);
      }
    }
    if (intersections.length < 2) continue;
    const left = Math.max(0, Math.floor(Math.min(...intersections)));
    const right = Math.min(size - 1, Math.ceil(Math.max(...intersections)));
    for (let x = left; x <= right; x += 1) {
      data[y * size + x] = 0;
    }
  }
}

function boxBlur(data: Uint8Array, size: number, radius: number): void {
  if (radius <= 0) return;
  const temp = new Uint8Array(data.length);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = x + k;
        if (sx < 0 || sx >= size) continue;
        sum += data[y * size + sx]!;
        count += 1;
      }
      temp[y * size + x] = Math.round(sum / Math.max(1, count));
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = y + k;
        if (sy < 0 || sy >= size) continue;
        sum += temp[sy * size + x]!;
        count += 1;
      }
      data[y * size + x] = Math.round(sum / Math.max(1, count));
    }
  }
}

export function sampleShadow(shadowMap: ShadowMap, worldX: number, worldZ: number): number {
  const { data, resolution, bounds } = shadowMap;
  const spanX = Math.max(1e-4, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1e-4, bounds.maxZ - bounds.minZ);
  const x = Math.min(resolution - 1, Math.max(0, Math.round(((worldX - bounds.minX) / spanX) * (resolution - 1))));
  const z = Math.min(resolution - 1, Math.max(0, Math.round(((worldZ - bounds.minZ) / spanZ) * (resolution - 1))));
  return data[z * resolution + x]! / 255;
}
