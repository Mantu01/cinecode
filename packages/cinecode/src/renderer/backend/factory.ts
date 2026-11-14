import { CpuSurface } from "./cpu.js";
import { WebGpuSurface, probeWebGpu } from "./webgpu.js";
import {
  CPU_CAPABILITIES,
  WEBGPU_CAPABILITIES,
  type BackendCapabilities,
  type BackendType,
  type RenderSurface,
} from "./types.js";

export interface BackendSelection {
  readonly type: BackendType;
  readonly capabilities: BackendCapabilities;
}

export interface BackendFactoryOptions {
  readonly preferred?: BackendType;
  readonly allowGpu?: boolean;
}

let cachedSelection: BackendSelection | null = null;
let forcedType: BackendType | null = null;

function probeWebGl2(): boolean {
  const globals = globalThis as unknown as {
    OffscreenCanvas?: new (width: number, height: number) => { getContext(name: string): unknown };
  };
  if (!globals.OffscreenCanvas) return false;
  try {
    const canvas = new globals.OffscreenCanvas(1, 1);
    return canvas.getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export async function detectBackend(options: BackendFactoryOptions = {}): Promise<BackendSelection> {
  const preferred = forcedType ?? options.preferred;
  if (preferred === "cpu") return { type: "cpu", capabilities: CPU_CAPABILITIES };
  if (preferred === "webgl2" && !probeWebGl2()) {
    return { type: "cpu", capabilities: CPU_CAPABILITIES };
  }
  if (preferred === "webgpu") {
    if (options.allowGpu === false) return { type: "cpu", capabilities: CPU_CAPABILITIES };
    return (await probeWebGpu())
      ? { type: "webgpu", capabilities: WEBGPU_CAPABILITIES }
      : { type: "cpu", capabilities: CPU_CAPABILITIES };
  }
  if (cachedSelection) return cachedSelection;
  const selection: BackendSelection = options.allowGpu === false
    ? { type: "cpu", capabilities: CPU_CAPABILITIES }
    : (await probeWebGpu())
      ? { type: "webgpu", capabilities: WEBGPU_CAPABILITIES }
      : { type: "cpu", capabilities: CPU_CAPABILITIES };
  cachedSelection = selection;
  return selection;
}

function instantiate(selection: BackendSelection): RenderSurface {
  return selection.type === "webgpu" ? new WebGpuSurface() : new CpuSurface();
}

export async function getBestAvailableBackend(options: BackendFactoryOptions = {}): Promise<RenderSurface> {
  return instantiate(await detectBackend(options));
}

export async function forceBackend(type: "webgpu" | "cpu"): Promise<RenderSurface> {
  forcedType = type;
  const surface = instantiate({ type, capabilities: type === "webgpu" ? WEBGPU_CAPABILITIES : CPU_CAPABILITIES });
  return surface;
}

export function getForcedBackend(): BackendType | null {
  return forcedType;
}

export function resetBackendDetection(): void {
  cachedSelection = null;
  forcedType = null;
}

export async function describeBackends(): Promise<readonly BackendSelection[]> {
  const webgpu = await detectBackend({ preferred: "webgpu" });
  const webgl2Available = probeWebGl2();
  return [
    webgpu,
    {
      type: "webgl2",
      capabilities: webgl2Available
        ? { gpuAvailable: true, adapterType: "webgl2", maxTextureDimension2D: 16384, computeShaderSupport: false }
        : { gpuAvailable: false, adapterType: "webgl2", maxTextureDimension2D: 0, computeShaderSupport: false },
    },
    { type: "cpu", capabilities: CPU_CAPABILITIES },
  ];
}
