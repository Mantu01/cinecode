import { Canvas } from "@napi-rs/canvas";
import { COMPUTE_SHADERS, getShaderSource } from "../effects/gpu-compute/shaders.js";
import {
  BackendUnavailableError,
  WEBGPU_CAPABILITIES,
  assertSurfaceSize,
  type BackendCapabilities,
  type RenderSurface,
} from "./types.js";

interface GpuLimits {
  readonly maxTextureDimension2D?: number;
}

interface GpuAdapter {
  readonly limits?: GpuLimits;
  requestDevice(): Promise<GpuDevice>;
}

interface GpuShaderModule {
  readonly label?: string;
}

interface GpuBindGroupLayout {
  readonly label?: string;
}

interface GpuComputePipeline {
  getBindGroupLayout(index: number): GpuBindGroupLayout;
}

interface GpuBindGroup {
  readonly label?: string;
}

interface GpuTextureView {
  readonly label?: string;
}

interface GpuSampler {
  readonly label?: string;
}

interface GpuTexture {
  createView(descriptor?: Record<string, unknown>): GpuTextureView;
  destroy(): void;
}

interface GpuBuffer {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface GpuComputePass {
  setPipeline(pipeline: GpuComputePipeline): void;
  setBindGroup(index: number, bindGroup: GpuBindGroup): void;
  dispatchWorkgroups(x: number, y: number, z: number): void;
  end(): void;
}

interface GpuCommandEncoder {
  beginComputePass(): GpuComputePass;
  copyTextureToBuffer(texture: GpuTexture, buffer: GpuBuffer, layout: Record<string, number>): void;
  finish(): GpuCommandBuffer;
}

interface GpuCommandBuffer {
  readonly label?: string;
}

interface GpuQueue {
  writeBuffer(buffer: GpuBuffer, offset: number, data: ArrayBufferView | ArrayBuffer): void;
  writeTexture(
    texture: GpuTexture,
    data: ArrayBufferView | ArrayBuffer,
    dataLayout: Record<string, number>,
    size: Record<string, number>,
  ): void;
  submit(commandBuffers: readonly GpuCommandBuffer[]): void;
}

interface GpuDevice {
  readonly limits?: GpuLimits;
  readonly queue: GpuQueue;
  createShaderModule(descriptor: { code: string; label?: string }): GpuShaderModule;
  createComputePipeline(descriptor: Record<string, unknown>): GpuComputePipeline;
  createBuffer(descriptor: Record<string, unknown>): GpuBuffer;
  createTexture(descriptor: Record<string, unknown>): GpuTexture;
  createBindGroup(descriptor: Record<string, unknown>): GpuBindGroup;
  createCommandEncoder(): GpuCommandEncoder;
  createSampler(descriptor?: Record<string, unknown>): GpuSampler;
  destroy(): void;
}

interface GpuNavigator {
  readonly gpu?: {
    requestAdapter(options?: Record<string, unknown>): Promise<GpuAdapter | null>;
  };
}

const TEXTURE_USAGE_STORAGE = 8;
const TEXTURE_USAGE_COPY_SRC = 1;
const TEXTURE_USAGE_COPY_DST = 2;
const TEXTURE_USAGE_SAMPLED = 4;
const BUFFER_USAGE_COPY_DST = 8;
const BUFFER_USAGE_MAP_READ = 1;
const BUFFER_USAGE_UNIFORM = 64;
const MAP_MODE_READ = 1;
const BYTES_PER_ROW_ALIGNMENT = 256;
const WORKGROUP_SIZE = 8;

type BindResource = GpuTextureView | GpuSampler;

export async function probeWebGpu(): Promise<boolean> {
  const gpu = resolveGpu();
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    return adapter !== null;
  } catch {
    return false;
  }
}

function resolveGpu(): GpuNavigator["gpu"] {
  return (globalThis as unknown as { navigator?: GpuNavigator }).navigator?.gpu;
}

export class WebGpuSurface implements RenderSurface {
  private capabilitiesValue: BackendCapabilities = WEBGPU_CAPABILITIES;
  private device: GpuDevice | null = null;
  private sampler: GpuSampler | null = null;
  private lutTexture: GpuTexture | null = null;
  private texture: GpuTexture | null = null;
  private spareTextures: GpuTexture[] = [];
  private surfaceWidth = 0;
  private surfaceHeight = 0;
  private readonly pipelines = new Map<string, GpuComputePipeline>();
  private readonly modules = new Map<string, GpuShaderModule>();

  get capabilities(): BackendCapabilities {
    return this.capabilitiesValue;
  }

  get width(): number {
    return this.surfaceWidth;
  }

  get height(): number {
    return this.surfaceHeight;
  }

  async initialize(width: number, height: number): Promise<void> {
    assertSurfaceSize(width, height, this.capabilitiesValue);
    const gpu = resolveGpu();
    if (!gpu) {
      throw new BackendUnavailableError("webgpu", "[CC2101] navigator.gpu is not exposed by this Node.js runtime");
    }
    if (!this.device) {
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) {
        throw new BackendUnavailableError("webgpu", "[CC2101] No compatible WebGPU adapter found");
      }
      const device = await adapter.requestDevice();
      this.device = device;
      this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
      this.lutTexture = device.createTexture({
        size: { width: 1, height: 1, depthOrArrayLayers: 1 },
        dimension: "3d",
        format: "rgba8unorm",
        usage: TEXTURE_USAGE_SAMPLED | TEXTURE_USAGE_COPY_DST,
      });
      device.queue.writeTexture(
        this.lutTexture,
        new Uint8Array([0, 0, 0, 255]),
        { bytesPerRow: 4, rowsPerImage: 1 },
        { width: 1, height: 1, depthOrArrayLayers: 1 },
      );
      this.capabilitiesValue = {
        ...WEBGPU_CAPABILITIES,
        maxTextureDimension2D: adapter.limits?.maxTextureDimension2D ?? 8192,
      };
    }
    this.surfaceWidth = Math.round(width);
    this.surfaceHeight = Math.round(height);
    this.allocateTextures();
  }

  private allocateTextures(): void {
    this.texture?.destroy();
    for (const surface of this.spareTextures) surface.destroy();
    this.texture = this.createTexture();
    this.spareTextures = [this.createTexture(), this.createTexture(), this.createTexture()];
  }

  private requireDevice(): GpuDevice {
    if (!this.device) {
      throw new BackendUnavailableError("webgpu", "[CC2107] WebGPU surface used before initialize()");
    }
    return this.device;
  }

  private createTexture(): GpuTexture {
    return this.requireDevice().createTexture({
      size: { width: this.surfaceWidth, height: this.surfaceHeight, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      usage:
        TEXTURE_USAGE_COPY_SRC |
        TEXTURE_USAGE_COPY_DST |
        TEXTURE_USAGE_SAMPLED |
        TEXTURE_USAGE_STORAGE,
    });
  }

  private pipelineFor(key: string): GpuComputePipeline {
    const cached = this.pipelines.get(key);
    if (cached) return cached;
    const descriptor = COMPUTE_SHADERS[key];
    if (!descriptor) throw new Error(`[CC2104] Unknown compute shader "${key}"`);
    const moduleCacheKey = descriptor.name;
    let module = this.modules.get(moduleCacheKey);
    if (!module) {
      module = this.requireDevice().createShaderModule({
        code: getShaderSource(moduleCacheKey),
        label: `cinecode-${moduleCacheKey}`,
      });
      this.modules.set(moduleCacheKey, module);
    }
    const pipeline = this.requireDevice().createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: descriptor.entryPoint },
    });
    this.pipelines.set(key, pipeline);
    return pipeline;
  }

  private runPass(key: string, uniformData: Uint8Array, entries: readonly BindResource[]): void {
    const device = this.requireDevice();
    const pipeline = this.pipelineFor(key);
    const uniformBuffer = device.createBuffer({
      size: Math.max(16, alignTo(uniformData.byteLength, 16)),
      usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        ...entries.map((resource, index) => ({ binding: index + 1, resource })),
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.surfaceWidth / WORKGROUP_SIZE),
      Math.ceil(this.surfaceHeight / WORKGROUP_SIZE),
      1,
    );
    pass.end();
    device.queue.submit([encoder.finish()]);
    uniformBuffer.destroy();
  }

  private rotate(targetIndex: number): void {
    const target = this.spareTextures[targetIndex];
    if (!target) return;
    this.spareTextures[targetIndex] = this.texture!;
    this.texture = target;
  }

  clear(color?: string): void {
    const pixel = parseCssColor(color);
    const data = new Uint8Array(this.surfaceWidth * this.surfaceHeight * 4);
    if (pixel[3] !== 0) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = pixel[0];
        data[i + 1] = pixel[1];
        data[i + 2] = pixel[2];
        data[i + 3] = pixel[3];
      }
    }
    this.uploadFullSurface(data);
  }

  private uploadFullSurface(data: Uint8Array): void {
    this.requireDevice().queue.writeTexture(
      this.texture!,
      data,
      { bytesPerRow: this.surfaceWidth * 4, rowsPerImage: this.surfaceHeight },
      { width: this.surfaceWidth, height: this.surfaceHeight, depthOrArrayLayers: 1 },
    );
  }

  drawPixels(data: Uint8ClampedArray | Buffer, x: number, y: number, width: number, height: number): void {
    const expected = width * height * 4;
    if (data.length !== expected) {
      throw new RangeError(`[CC2106] drawPixels expected ${expected} bytes for ${width}x${height}, got ${data.length}`);
    }
    if (x === 0 && y === 0 && width === this.surfaceWidth && height === this.surfaceHeight) {
      const view = data instanceof Buffer
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.uploadFullSurface(view);
      return;
    }
    throw new Error("[CC2108] Partial uploads require a full surface; read, compose, then draw the complete buffer");
  }

  async applyComputeShader(
    shaderName: string,
    uniforms: Record<string, unknown>,
    _textures?: RenderSurface[],
  ): Promise<void> {
    const [first, second] = this.spareTextures;
    if (!first || !second) {
      throw new BackendUnavailableError("webgpu", "[CC2107] WebGPU surface has no spare textures");
    }

    if (shaderName === "blur") {
      const params = this.writeBlurUniforms(uniforms);
      this.runPass("blur-horizontal", params, [this.texture!.createView(), first.createView()]);
      this.rotate(0);
      this.runPass("blur-vertical", params, [this.texture!.createView(), first.createView()]);
      this.rotate(0);
      return;
    }

    if (shaderName === "bloom") {
      const params = this.writeBloomUniforms(uniforms);
      this.runPass("bloom", params, [this.texture!.createView(), second.createView(), first.createView()]);
      this.runPass("blur-horizontal", params, [first.createView(), second.createView()]);
      this.runPass("blur-vertical", params, [second.createView(), first.createView()]);
      this.runPass("bloom-composite", params, [this.texture!.createView(), first.createView(), second.createView()]);
      this.rotate(1);
      return;
    }

    if (shaderName === "color-grading") {
      const params = this.writeGradeUniforms(uniforms);
      this.runPass("color-grading", params, [
        this.texture!.createView(),
        this.lutTexture!.createView(),
        first.createView(),
        this.sampler!,
      ]);
      this.rotate(0);
      return;
    }

    if (shaderName === "denoise") {
      const params = this.writeDenoiseUniforms(uniforms);
      this.runPass("denoise", params, [this.texture!.createView(), first.createView()]);
      this.rotate(0);
      return;
    }

    throw new Error(`[CC2103] Unknown compute shader "${shaderName}"`);
  }

  private writeBlurUniforms(uniforms: Record<string, unknown>): Uint8Array {
    const radius = Math.max(0, Math.round(Number(uniforms.radius ?? 5)));
    const data = new Uint8Array(16);
    const view = new DataView(data.buffer);
    view.setUint32(0, this.surfaceWidth, true);
    view.setUint32(4, this.surfaceHeight, true);
    view.setInt32(8, radius, true);
    view.setFloat32(12, Number(uniforms.sigma ?? Math.max(0.0001, radius / 3)), true);
    return data;
  }

  private writeBloomUniforms(uniforms: Record<string, unknown>): Uint8Array {
    const radius = Math.max(0, Math.round(Number(uniforms.radius ?? 8)));
    const data = new Uint8Array(32);
    const view = new DataView(data.buffer);
    view.setUint32(0, this.surfaceWidth, true);
    view.setUint32(4, this.surfaceHeight, true);
    view.setFloat32(8, Number(uniforms.threshold ?? 0.7), true);
    view.setFloat32(12, Number(uniforms.strength ?? 1), true);
    view.setInt32(16, radius, true);
    view.setFloat32(20, Number(uniforms.sigma ?? Math.max(0.0001, radius / 3)), true);
    return data;
  }

  private writeGradeUniforms(uniforms: Record<string, unknown>): Uint8Array {
    const data = new Uint8Array(80);
    const view = new DataView(data.buffer);
    view.setUint32(0, this.surfaceWidth, true);
    view.setUint32(4, this.surfaceHeight, true);
    writeVec3(view, 16, uniforms.lift);
    writeVec3(view, 32, uniforms.gamma);
    writeVec3(view, 48, uniforms.gain);
    view.setFloat32(64, Number(uniforms.saturation ?? 1), true);
    view.setUint32(68, uniforms.lut === undefined ? 0 : 1, true);
    return data;
  }

  private writeDenoiseUniforms(uniforms: Record<string, unknown>): Uint8Array {
    const data = new Uint8Array(24);
    const view = new DataView(data.buffer);
    view.setUint32(0, this.surfaceWidth, true);
    view.setUint32(4, this.surfaceHeight, true);
    view.setInt32(8, Math.max(0, Math.round(Number(uniforms.radius ?? 2))), true);
    view.setFloat32(12, Number(uniforms.sigmaColor ?? 24), true);
    view.setFloat32(16, Number(uniforms.sigmaSpace ?? 2), true);
    return data;
  }

  private async copyToCpu(): Promise<Uint8ClampedArray> {
    const device = this.requireDevice();
    const bytesPerRow = alignTo(this.surfaceWidth * 4, BYTES_PER_ROW_ALIGNMENT);
    const buffer = device.createBuffer({
      size: bytesPerRow * this.surfaceHeight,
      usage: BUFFER_USAGE_MAP_READ | BUFFER_USAGE_COPY_DST,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(this.texture!, buffer, {
      bytesPerRow,
      rowsPerImage: this.surfaceHeight,
    });
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(MAP_MODE_READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const output = new Uint8ClampedArray(this.surfaceWidth * this.surfaceHeight * 4);
    for (let y = 0; y < this.surfaceHeight; y += 1) {
      output.set(
        mapped.subarray(y * bytesPerRow, y * bytesPerRow + this.surfaceWidth * 4),
        y * this.surfaceWidth * 4,
      );
    }
    buffer.unmap();
    buffer.destroy();
    return output;
  }

  async readPixels(): Promise<Uint8ClampedArray> {
    return this.copyToCpu();
  }

  async toBuffer(mimeType: string = "image/png"): Promise<Buffer> {
    const pixels = await this.copyToCpu();
    const canvas = new Canvas(this.surfaceWidth, this.surfaceHeight);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(this.surfaceWidth, this.surfaceHeight);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toBuffer(mimeType as "image/png");
  }

  toCanvas(): Canvas {
    throw new BackendUnavailableError("webgpu", "[CC2109] WebGPU surfaces expose pixels through toBuffer()/readPixels()");
  }

  dispose(): void {
    this.texture?.destroy();
    for (const texture of this.spareTextures) texture.destroy();
    this.texture = null;
    this.spareTextures = [];
    this.lutTexture?.destroy();
    this.lutTexture = null;
    this.pipelines.clear();
    this.modules.clear();
    this.device?.destroy();
    this.device = null;
    this.sampler = null;
    this.surfaceWidth = 0;
    this.surfaceHeight = 0;
  }
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function writeVec3(view: DataView, offset: number, value: unknown): void {
  const tuple = Array.isArray(value) ? value : [];
  for (let i = 0; i < 3; i += 1) {
    view.setFloat32(offset + i * 4, Number(tuple[i] ?? 0), true);
  }
}

function parseCssColor(color: string | undefined): [number, number, number, number] {
  if (!color) return [0, 0, 0, 0];
  const hex = color.replace("#", "");
  if ((hex.length === 6 || hex.length === 8) && /^[0-9a-f]+$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
    ];
  }
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const parts = match[1]!.split(",").map((part) => Number.parseFloat(part.trim()));
    return [
      Math.round(parts[0] ?? 0),
      Math.round(parts[1] ?? 0),
      Math.round(parts[2] ?? 0),
      Math.round((parts[3] ?? 1) * 255),
    ];
  }
  return [0, 0, 0, 255];
}

export function createWebGpuSurface(): WebGpuSurface {
  return new WebGpuSurface();
}
