import type { Mat4 } from "./types.js";

export interface SkinnedMeshResult {
  readonly vertices: Float32Array;
  readonly normals?: Float32Array;
}

function transformPosition(matrix: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
  ];
}

function transformNormal(matrix: Mat4, x: number, y: number, z: number): [number, number, number] {
  const nx = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z;
  const ny = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z;
  const nz = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z;
  const length = Math.hypot(nx, ny, nz);
  if (length === 0) return [0, 0, 0];
  return [nx / length, ny / length, nz / length];
}

export function applySkinning(
  vertices: Float32Array,
  normals: Float32Array | undefined,
  boneIndices: Float32Array,
  boneWeights: Float32Array,
  boneMatrices: readonly Mat4[],
  indexBuffer?: Uint16Array | Uint32Array | null,
): SkinnedMeshResult {
  const vertexCount = Math.floor(vertices.length / 3);
  const outVertices = new Float32Array(vertices.length);
  const outNormals = normals ? new Float32Array(normals.length) : undefined;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const base = vertex * 3;
    const x = vertices[base]!;
    const y = vertices[base + 1]!;
    const z = vertices[base + 2]!;
    let px = 0;
    let py = 0;
    let pz = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let weightSum = 0;

    for (let influence = 0; influence < 4; influence += 1) {
      const weight = boneWeights[vertex * 4 + influence] ?? 0;
      if (weight <= 0) continue;
      const joint = Math.round(boneIndices[vertex * 4 + influence] ?? 0);
      const matrix = boneMatrices[joint];
      if (!matrix) continue;
      const [tx, ty, tz] = transformPosition(matrix, x, y, z);
      px += tx * weight;
      py += ty * weight;
      pz += tz * weight;
      weightSum += weight;

      if (outNormals) {
        const [mx, my, mz] = transformNormal(matrix, normals![base]!, normals![base + 1]!, normals![base + 2]!);
        nx += mx * weight;
        ny += my * weight;
        nz += mz * weight;
      }
    }

    if (weightSum <= 0) {
      outVertices[base] = x;
      outVertices[base + 1] = y;
      outVertices[base + 2] = z;
      if (outNormals) {
        outNormals[base] = normals![base]!;
        outNormals[base + 1] = normals![base + 1]!;
        outNormals[base + 2] = normals![base + 2]!;
      }
      continue;
    }

    outVertices[base] = px / weightSum;
    outVertices[base + 1] = py / weightSum;
    outVertices[base + 2] = pz / weightSum;

    if (outNormals) {
      const length = Math.hypot(nx, ny, nz) || 1;
      outNormals[base] = nx / length;
      outNormals[base + 1] = ny / length;
      outNormals[base + 2] = nz / length;
    }
  }

  void indexBuffer;
  return { vertices: outVertices, normals: outNormals };
}
