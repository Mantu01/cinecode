import type { SKRSContext2D } from "@napi-rs/canvas";
import type { PointCloudData, PointCloudRenderOptions, ClippingPlane } from "./types.js";
import { samplePalette } from "./palettes.js";
import { PointCloudOctree, type FrustumPlane } from "./octree.js";

type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16) as unknown as Mat4;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] =
        (a[i * 4 + 0] ?? 0) * (b[0 * 4 + j] ?? 0) +
        (a[i * 4 + 1] ?? 0) * (b[1 * 4 + j] ?? 0) +
        (a[i * 4 + 2] ?? 0) * (b[2 * 4 + j] ?? 0) +
        (a[i * 4 + 3] ?? 0) * (b[3 * 4 + j] ?? 0);
    }
  }
  return out;
}

function mat4LookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Mat4 {
  let z0 = eye[0] - target[0];
  let z1 = eye[1] - target[1];
  let z2 = eye[2] - target[2];
  let len = Math.hypot(z0, z1, z2);
  if (len === 0) len = 1;
  z0 /= len; z1 /= len; z2 /= len;

  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  len = Math.hypot(x0, x1, x2);
  if (len === 0) len = 1;
  x0 /= len; x1 /= len; x2 /= len;

  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;

  return [
    x0, y0, z0, 0,
    x1, y1, z1, 0,
    x2, y2, z2, 0,
    -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
    -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
    -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]),
    1,
  ];
}

function mat4Perspective(fovRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fovRad * 0.5);
  const nf = 1.0 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

function extractFrustumPlanes(vp: Mat4): FrustumPlane[] {
  const planes: FrustumPlane[] = [];
  const m = vp;
  const raw: [number, number, number, number][] = [
    [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
    [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
    [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],
    [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
    [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],
    [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],
  ];

  for (let i = 0; i < 6; i++) {
    const r = raw[i];
    if (!r) continue;
    const [x, y, z, w] = r;
    const len = Math.hypot(x, y, z) || 1;
    planes.push({
      normal: [x / len, y / len, z / len],
      distance: w / len,
    });
  }
  return planes;
}

export class PointCloudRenderer {
  private octree?: PointCloudOctree;
  private data?: PointCloudData;

  constructor(data?: PointCloudData) {
    if (data) this.setData(data);
  }

  public setData(data: PointCloudData): void {
    this.data = data;
    this.octree = new PointCloudOctree(data.positions, data.bounds);
  }

  public render(
    ctx: SKRSContext2D | CanvasRenderingContext2D,
    width: number,
    height: number,
    options: PointCloudRenderOptions = {},
  ): { renderedPoints: number } {
    if (!this.data || this.data.count === 0) return { renderedPoints: 0 };

    const eye = options.cameraPosition ?? [0, 0, 5];
    const target = options.cameraTarget ?? [0, 0, 0];
    const up = options.cameraUp ?? [0, 1, 0];
    const fov = (options.fov ?? 45) * (Math.PI / 180);
    const near = options.near ?? 0.1;
    const far = options.far ?? 1000;
    const pointSize = options.pointSize ?? 4;
    const sizeAttenuation = options.sizeAttenuation !== false;
    const minSize = options.minPointSize ?? 1;
    const maxSize = options.maxPointSize ?? 64;
    const opacity = options.opacity ?? 1.0;
    const palette = options.palette ?? "viridis";

    let minInt = 0;
    let maxInt = 1;
    if (options.paletteRange) {
      [minInt, maxInt] = options.paletteRange;
    } else if (this.data.intensities && this.data.intensities.length > 0) {
      minInt = Infinity;
      maxInt = -Infinity;
      for (let i = 0; i < this.data.intensities.length; i++) {
        const v = this.data.intensities[i] ?? 0;
        if (v < minInt) minInt = v;
        if (v > maxInt) maxInt = v;
      }
      if (minInt === maxInt) maxInt = minInt + 1;
    }

    const view = mat4LookAt(eye, target, up);
    const proj = mat4Perspective(fov, width / height, near, far);
    const vp = mat4Multiply(proj, view);
    const frustumPlanes = extractFrustumPlanes(vp);

    const candidateIndices = this.octree
      ? this.octree.queryFrustum(frustumPlanes, this.data.positions)
      : Array.from({ length: this.data.count }, (_, i) => i);

    const positions = this.data.positions;
    const colors = this.data.colors;
    const intensities = this.data.intensities;
    const clipPlanes = options.clipPlanes || [];
    const clipBounds = options.clipBounds;

    const visible: { x: number; y: number; z: number; size: number; r: number; g: number; b: number }[] = [];

    const tanHalfFov = Math.tan(fov * 0.5);
    const projFactor = height / (2.0 * tanHalfFov);

    for (let i = 0; i < candidateIndices.length; i++) {
      const idx = candidateIndices[i]!;
      const px = positions[idx * 3]!;
      const py = positions[idx * 3 + 1]!;
      const pz = positions[idx * 3 + 2]!;

      if (clipBounds) {
        if (clipBounds.minX !== undefined && px < clipBounds.minX) continue;
        if (clipBounds.maxX !== undefined && px > clipBounds.maxX) continue;
        if (clipBounds.minY !== undefined && py < clipBounds.minY) continue;
        if (clipBounds.maxY !== undefined && py > clipBounds.maxY) continue;
        if (clipBounds.minZ !== undefined && pz < clipBounds.minZ) continue;
        if (clipBounds.maxZ !== undefined && pz > clipBounds.maxZ) continue;
      }

      let clipped = false;
      for (let c = 0; c < clipPlanes.length; c++) {
        const cp = clipPlanes[c]!;
        if (cp.normal[0] * px + cp.normal[1] * py + cp.normal[2] * pz + cp.distance < 0) {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;

      const vx = view[0] * px + view[4] * py + view[8] * pz + view[12];
      const vy = view[1] * px + view[5] * py + view[9] * pz + view[13];
      const vz = view[2] * px + view[6] * py + view[10] * pz + view[14];

      const depth = -vz;
      if (depth <= near || depth >= far) continue;

      const clipX = proj[0] * vx + proj[8] * vz;
      const clipY = proj[5] * vy + proj[9] * vz;
      const clipW = -vz;

      const ndcX = clipX / clipW;
      const ndcY = clipY / clipW;

      if (ndcX < -1.2 || ndcX > 1.2 || ndcY < -1.2 || ndcY > 1.2) continue;

      const screenX = (ndcX * 0.5 + 0.5) * width;
      const screenY = (-ndcY * 0.5 + 0.5) * height;

      let sz = pointSize;
      if (sizeAttenuation) {
        sz = (pointSize * projFactor) / depth;
      }
      sz = Math.max(minSize, Math.min(maxSize, sz));

      let r = 255;
      let g = 255;
      let b = 255;

      if (colors) {
        r = Math.round((colors[idx * 3] ?? 1) * 255);
        g = Math.round((colors[idx * 3 + 1] ?? 1) * 255);
        b = Math.round((colors[idx * 3 + 2] ?? 1) * 255);
      } else if (intensities) {
        const val = intensities[idx] ?? 0;
        const norm = (val - minInt) / (maxInt - minInt || 1);
        [r, g, b] = samplePalette(palette, norm);
      }

      visible.push({ x: screenX, y: screenY, z: depth, size: sz, r, g, b });
    }

    visible.sort((a, b) => b.z - a.z);

    const oldAlpha = ctx.globalAlpha;
    ctx.globalAlpha = opacity;

    for (let i = 0; i < visible.length; i++) {
      const p = visible[i]!;
      ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = oldAlpha;
    return { renderedPoints: visible.length };
  }
}
