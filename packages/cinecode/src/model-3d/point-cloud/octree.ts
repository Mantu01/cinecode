export interface FrustumPlane {
  normal: [number, number, number];
  distance: number;
}

export interface OctreeNode {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  halfSize: [number, number, number];
  children?: OctreeNode[];
  indices?: number[];
}

export class PointCloudOctree {
  public root: OctreeNode;
  private readonly maxDepth: number;
  private readonly maxPerNode: number;

  constructor(
    positions: Float32Array,
    bounds: { min: [number, number, number]; max: [number, number, number] },
    maxDepth = 8,
    maxPerNode = 1024,
  ) {
    this.maxDepth = maxDepth;
    this.maxPerNode = maxPerNode;
    const count = positions.length / 3;
    const allIndices: number[] = new Array(count);
    for (let i = 0; i < count; i++) allIndices[i] = i;
    this.root = this.buildNode(positions, bounds.min, bounds.max, allIndices, 0);
  }

  private buildNode(
    positions: Float32Array,
    min: [number, number, number],
    max: [number, number, number],
    indices: number[],
    depth: number,
  ): OctreeNode {
    const center: [number, number, number] = [
      (min[0] + max[0]) * 0.5,
      (min[1] + max[1]) * 0.5,
      (min[2] + max[2]) * 0.5,
    ];
    const halfSize: [number, number, number] = [
      (max[0] - min[0]) * 0.5,
      (max[1] - min[1]) * 0.5,
      (max[2] - min[2]) * 0.5,
    ];

    if (depth >= this.maxDepth || indices.length <= this.maxPerNode) {
      return { min, max, center, halfSize, indices };
    }

    const childIndices: number[][] = Array.from({ length: 8 }, () => []);
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i]!;
      const px = positions[idx * 3]!;
      const py = positions[idx * 3 + 1]!;
      const pz = positions[idx * 3 + 2]!;
      const octant =
        (px >= center[0] ? 1 : 0) |
        (py >= center[1] ? 2 : 0) |
        (pz >= center[2] ? 4 : 0);
      childIndices[octant]!.push(idx);
    }

    const children: OctreeNode[] = [];
    for (let o = 0; o < 8; o++) {
      const bucket = childIndices[o];
      if (!bucket || bucket.length === 0) continue;
      const cMin: [number, number, number] = [
        o & 1 ? center[0] : min[0],
        o & 2 ? center[1] : min[1],
        o & 4 ? center[2] : min[2],
      ];
      const cMax: [number, number, number] = [
        o & 1 ? max[0] : center[0],
        o & 2 ? max[1] : center[1],
        o & 4 ? max[2] : center[2],
      ];
      children.push(this.buildNode(positions, cMin, cMax, bucket, depth + 1));
    }

    return { min, max, center, halfSize, children };
  }

  public queryFrustum(
    planes: FrustumPlane[],
    positions: Float32Array,
    outIndices: number[] = [],
  ): number[] {
    this.traverseFrustum(this.root, planes, positions, outIndices);
    return outIndices;
  }

  private traverseFrustum(
    node: OctreeNode,
    planes: FrustumPlane[],
    positions: Float32Array,
    out: number[],
  ): void {
    const test = this.boxInFrustum(node.min, node.max, planes);
    if (test === "outside") return;

    if (test === "inside") {
      this.collectAll(node, out);
      return;
    }

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child) this.traverseFrustum(child, planes, positions, out);
      }
    } else if (node.indices) {
      for (let i = 0; i < node.indices.length; i++) {
        const idx = node.indices[i]!;
        const px = positions[idx * 3]!;
        const py = positions[idx * 3 + 1]!;
        const pz = positions[idx * 3 + 2]!;
        if (this.pointInFrustum(px, py, pz, planes)) {
          out.push(idx);
        }
      }
    }
  }

  private collectAll(node: OctreeNode, out: number[]): void {
    if (node.indices) {
      for (let i = 0; i < node.indices.length; i++) {
        const idx = node.indices[i];
        if (idx !== undefined) out.push(idx);
      }
    }
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child) this.collectAll(child, out);
      }
    }
  }

  private boxInFrustum(
    min: [number, number, number],
    max: [number, number, number],
    planes: FrustumPlane[],
  ): "outside" | "inside" | "intersect" {
    let allInside = true;
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i]!;
      const nx = p.normal[0];
      const ny = p.normal[1];
      const nz = p.normal[2];
      const d = p.distance;

      const px = nx >= 0 ? max[0] : min[0];
      const py = ny >= 0 ? max[1] : min[1];
      const pz = nz >= 0 ? max[2] : min[2];

      if (nx * px + ny * py + nz * pz + d < 0) {
        return "outside";
      }

      const qx = nx >= 0 ? min[0] : max[0];
      const qy = ny >= 0 ? min[1] : max[1];
      const qz = nz >= 0 ? min[2] : max[2];

      if (nx * qx + ny * qy + nz * qz + d < 0) {
        allInside = false;
      }
    }
    return allInside ? "inside" : "intersect";
  }

  private pointInFrustum(px: number, py: number, pz: number, planes: FrustumPlane[]): boolean {
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i]!;
      if (p.normal[0] * px + p.normal[1] * py + p.normal[2] * pz + p.distance < 0) {
        return false;
      }
    }
    return true;
  }
}
