import type { Canvas } from "@napi-rs/canvas";

export type BackendType = "webgpu" | "webgl2" | "cpu";

export interface BackendCapabilities {
  readonly gpuAvailable: boolean;
  readonly adapterType: BackendType;
  readonly maxTextureDimension2D: number;
  readonly computeShaderSupport: boolean;
}

export interface RenderSurface {
  readonly capabilities: BackendCapabilities;
  readonly width: number;
  readonly height: number;
  initialize(width: number, height: number): Promise<void>;
  clear(color?: string): void;
  drawPixels(data: Uint8ClampedArray | Buffer, x: number, y: number, width: number, height: number): void;
  applyComputeShader(shaderName: string, uniforms: Record<string, unknown>, textures?: RenderSurface[]): Promise<void>;
  readPixels(): Promise<Uint8ClampedArray>;
  toBuffer(mimeType?: string): Promise<Buffer>;
  dispose(): void;
  toCanvas(): Canvas;
}

export class BackendUnavailableError extends Error {
  readonly backend: BackendType;

  constructor(backend: BackendType, message?: string) {
    super(message ?? `[CC2101] Render backend "${backend}" is not available on this host`);
    this.name = "BackendUnavailableError";
    this.backend = backend;
  }
}

export const CPU_CAPABILITIES: BackendCapabilities = {
  gpuAvailable: false,
  adapterType: "cpu",
  maxTextureDimension2D: 16384,
  computeShaderSupport: false,
};

export const WEBGPU_CAPABILITIES: BackendCapabilities = {
  gpuAvailable: true,
  adapterType: "webgpu",
  maxTextureDimension2D: 8192,
  computeShaderSupport: true,
};

export function assertSurfaceSize(width: number, height: number, capabilities: BackendCapabilities): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new RangeError(`Render surface size must be finite, got ${width}x${height}`);
  }
  const roundedWidth = Math.round(width);
  const roundedHeight = Math.round(height);
  if (roundedWidth < 1 || roundedHeight < 1) {
    throw new RangeError(`Render surface size must be positive, got ${width}x${height}`);
  }
  const limit = capabilities.maxTextureDimension2D;
  if (roundedWidth > limit || roundedHeight > limit) {
    throw new RangeError(
      `[CC2102] Render surface ${roundedWidth}x${roundedHeight} exceeds the ${limit}px limit of the "${capabilities.adapterType}" backend`,
    );
  }
}
