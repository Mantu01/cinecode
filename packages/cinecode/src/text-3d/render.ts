import type { SKRSContext2D } from "@napi-rs/canvas";
import type { MeshData } from "./mesh.js";
import { shadeColor, type Text3DMaterial } from "./material.js";

export interface Text3dRenderOptions {
  readonly x?: number;
  readonly y?: number;
  readonly scale?: number;
  readonly rotationY?: number;
  readonly rotationX?: number;
  readonly lightDirection?: readonly [number, number, number];
  readonly opacity?: number;
}

interface Triangle {
  readonly points: readonly [number, number][];
  readonly depth: number;
  readonly color: string;
}

export function renderTextMesh(
  ctx: SKRSContext2D,
  mesh: MeshData,
  material: Text3DMaterial,
  options: Text3dRenderOptions = {},
): void {
  const scale = options.scale ?? 1;
  const centerX = options.x ?? 0;
  const centerY = options.y ?? 0;
  const rotationY = (options.rotationY ?? 0) * (Math.PI / 180);
  const rotationX = (options.rotationX ?? 0) * (Math.PI / 180);
  const light = normalize(options.lightDirection ?? [0.3, -0.4, -1]);
  const opacity = options.opacity ?? 1;

  const originX = mesh.width / 2;
  const originY = mesh.height / 2;
  const originZ = mesh.height * 0.02;

  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);

  const project = (index: number): [number, number, number] => {
    const x = (mesh.vertices[index * 3]! - originX);
    const y = (mesh.vertices[index * 3 + 1]! - originY);
    const z = (mesh.vertices[index * 3 + 2]! - originZ);
    const rx = x * cosY + z * sinY;
    const rz = -x * sinY + z * cosY;
    const ry = y * cosX - rz * sinX;
    const depth = y * sinX + rz * cosX;
    return [centerX + rx * scale, centerY + ry * scale, depth];
  };

  const triangles: Triangle[] = [];
  const addGroup = (indices: Uint32Array, baseColor: string): void => {
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i]!;
      const ib = indices[i + 1]!;
      const ic = indices[i + 2]!;
      const a = project(ia);
      const b = project(ib);
      const c = project(ic);
      const nx = mesh.normals[ia * 3]!;
      const ny = mesh.normals[ia * 3 + 1]!;
      const nz = mesh.normals[ia * 3 + 2]!;
      const transformedX = nx * cosY + nz * sinY;
      const transformedZ = -nx * sinY + nz * cosY;
      const transformedY = ny * cosX - transformedZ * sinX;
      const diffuse = Math.max(0.25, -(transformedX * light[0] + transformedY * light[1] + transformedZ * light[2]));
      triangles.push({
        points: [
          [a[0], a[1]],
          [b[0], b[1]],
          [c[0], c[1]],
        ],
        depth: (a[2] + b[2] + c[2]) / 3,
        color: shadeColor(baseColor, 0.55 + diffuse * 0.75),
      });
    }
  };

  addGroup(mesh.backFaceIndices, material.backColor);
  addGroup(mesh.sideWallIndices, material.sideColor);
  addGroup(mesh.frontFaceIndices, material.frontColor);
  triangles.sort((left, right) => right.depth - left.depth);

  ctx.save();
  ctx.globalAlpha = opacity;
  for (const triangle of triangles) {
    ctx.beginPath();
    ctx.moveTo(triangle.points[0]![0], triangle.points[0]![1]);
    ctx.lineTo(triangle.points[1]![0], triangle.points[1]![1]);
    ctx.lineTo(triangle.points[2]![0], triangle.points[2]![1]);
    ctx.closePath();
    ctx.fillStyle = triangle.color;
    ctx.fill();
  }
  ctx.restore();
}

export function projectMeshBounds(
  mesh: MeshData,
  options: Text3dRenderOptions = {},
): { readonly width: number; readonly height: number } {
  const scale = options.scale ?? 1;
  return { width: mesh.width * scale, height: mesh.height * scale };
}

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
