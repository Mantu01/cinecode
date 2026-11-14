import { createCanvas, createContext } from "../composite/engine.js";
import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import { applyCpuShaderKernel } from "../effects/gpu-compute/cpu-kernels.js";
import {
  CPU_CAPABILITIES,
  assertSurfaceSize,
  type BackendCapabilities,
  type RenderSurface,
} from "./types.js";

export class CpuSurface implements RenderSurface {
  readonly capabilities: BackendCapabilities = CPU_CAPABILITIES;
  private canvas: Canvas | null = null;
  private ctx: SKRSContext2D | null = null;
  private surfaceWidth = 0;
  private surfaceHeight = 0;

  get width(): number {
    return this.surfaceWidth;
  }

  get height(): number {
    return this.surfaceHeight;
  }

  async initialize(width: number, height: number): Promise<void> {
    assertSurfaceSize(width, height, this.capabilities);
    this.surfaceWidth = Math.round(width);
    this.surfaceHeight = Math.round(height);
    if (!this.canvas || this.canvas.width !== this.surfaceWidth || this.canvas.height !== this.surfaceHeight) {
      this.canvas = createCanvas(this.surfaceWidth, this.surfaceHeight);
      this.ctx = createContext(this.canvas);
    }
  }

  private requireContext(): { canvas: Canvas; ctx: SKRSContext2D } {
    if (!this.canvas || !this.ctx) {
      throw new Error("[CC2105] CPU render surface used before initialize()");
    }
    return { canvas: this.canvas, ctx: this.ctx };
  }

  clear(color?: string): void {
    const { ctx } = this.requireContext();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.surfaceWidth, this.surfaceHeight);
    if (color) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, this.surfaceWidth, this.surfaceHeight);
    }
    ctx.restore();
  }

  drawPixels(data: Uint8ClampedArray | Buffer, x: number, y: number, width: number, height: number): void {
    const { ctx } = this.requireContext();
    const expected = width * height * 4;
    if (data.length !== expected) {
      throw new RangeError(`[CC2106] drawPixels expected ${expected} bytes for ${width}x${height}, got ${data.length}`);
    }
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(data);
    ctx.putImageData(imageData, Math.round(x), Math.round(y));
  }

  async applyComputeShader(
    shaderName: string,
    uniforms: Record<string, unknown>,
    _textures?: RenderSurface[],
  ): Promise<void> {
    const { ctx } = this.requireContext();
    const imageData = ctx.getImageData(0, 0, this.surfaceWidth, this.surfaceHeight);
    applyCpuShaderKernel(shaderName, imageData.data, this.surfaceWidth, this.surfaceHeight, uniforms);
    ctx.putImageData(imageData, 0, 0);
  }

  async readPixels(): Promise<Uint8ClampedArray> {
    const { ctx } = this.requireContext();
    return ctx.getImageData(0, 0, this.surfaceWidth, this.surfaceHeight).data;
  }

  async toBuffer(mimeType: string = "image/png"): Promise<Buffer> {
    const { canvas } = this.requireContext();
    return canvas.toBuffer(mimeType as "image/png");
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
    this.surfaceWidth = 0;
    this.surfaceHeight = 0;
  }

  toCanvas(): Canvas {
    return this.requireContext().canvas;
  }
}

export function createCpuSurface(width = 1, height = 1): CpuSurface {
  const surface = new CpuSurface();
  if (width > 0 && height > 0) {
    surface.initialize(Math.max(1, width), Math.max(1, height)).catch(() => undefined);
  }
  return surface;
}
