import { buildMesh, computeTangents, type MeshGeometry } from "./mesh-builder.js";
import { createIcosahedron, type IcosahedronOptions } from "./icosahedron.js";
import { createTorusKnot, type TorusKnotOptions } from "./torus-knot.js";
import { createHyperboloid, type HyperboloidOptions } from "./hyperboloid.js";
import { createMobiusStrip, type MobiusStripOptions } from "./mobius-strip.js";
import { createSpirograph, type SpirographOptions } from "./spirograph.js";
import { createVoronoiMesh, type VoronoiMeshOptions } from "./voronoi-mesh.js";

export {
  buildMesh,
  computeTangents,
  type MeshGeometry,
  createIcosahedron,
  type IcosahedronOptions,
  createTorusKnot,
  type TorusKnotOptions,
  createHyperboloid,
  type HyperboloidOptions,
  createMobiusStrip,
  type MobiusStripOptions,
  createSpirograph,
  createSpirograph as createSpirographRibbon,
  type SpirographOptions,
  createVoronoiMesh,
  type VoronoiMeshOptions,
};

export type PrimitiveShape =
  | "icosahedron"
  | "torus-knot"
  | "hyperboloid"
  | "mobius-strip"
  | "spirograph"
  | "voronoi";

export type PrimitiveType = PrimitiveShape;
export type PrimitiveMeshOptions = Record<string, unknown>;

export function createPrimitiveMesh(
  shape: PrimitiveShape | string,
  options: Record<string, unknown> = {},
): MeshGeometry {
  switch (shape) {
    case "icosahedron":
    case "icosphere":
      return createIcosahedron(options as IcosahedronOptions);
    case "torus-knot":
      return createTorusKnot(options as TorusKnotOptions);
    case "hyperboloid":
      return createHyperboloid(options as HyperboloidOptions);
    case "mobius-strip":
    case "mobius":
      return createMobiusStrip(options as MobiusStripOptions);
    case "spirograph":
      return createSpirograph(options as SpirographOptions);
    case "voronoi":
    case "voronoi-mesh":
      return createVoronoiMesh(options as VoronoiMeshOptions);
    default:
      return createIcosahedron(options as IcosahedronOptions);
  }
}
