export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface PointCloudPoint {
  x: number;
  y: number;
  z: number;
  r?: number;
  g?: number;
  b?: number;
  a?: number;
  intensity?: number;
  classification?: number;
}

export interface PointCloudBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface PointCloudData {
  positions: Float32Array;
  colors?: Float32Array;
  intensities?: Float32Array;
  classifications?: Uint16Array;
  count: number;
  bounds: PointCloudBounds;
}

export type ColorPaletteName = "viridis" | "plasma" | "turbo" | "inferno" | "coolwarm";

export interface ClippingPlane {
  normal: [number, number, number];
  distance: number;
}

export interface PointCloudRenderOptions {
  pointSize?: number;
  sizeAttenuation?: boolean;
  minPointSize?: number;
  maxPointSize?: number;
  palette?: ColorPaletteName;
  paletteRange?: [number, number];
  opacity?: number;
  clipPlanes?: ClippingPlane[];
  clipBounds?: {
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
    minZ?: number;
    maxZ?: number;
  };
  fov?: number;
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
  cameraUp?: [number, number, number];
  near?: number;
  far?: number;
}
