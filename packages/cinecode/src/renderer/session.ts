import { createCanvas, createContext } from "./composite/engine.js";
import { ByteBoundedCache, unregisterByteCache, type CacheStats } from "./pool.js";
import type { Canvas, SKRSContext2D, ImageData } from "@napi-rs/canvas";
import type { ExtractedFrame } from "../media/frames.js";
import type { CubeTexture } from "../model-3d/environment/cubeMap.js";
import type { MediaCache } from "../media/cache.js";
import { getProcessCacheRegistry, releaseSessionCaches } from "./cache-registry.js";
import { clearMultiCameraCache } from "./multi-camera.js";

export function canvasBytes(canvas: Canvas): number {
  return canvas.width * canvas.height * 4;
}

export function canvasPairBytes(pair: [Canvas, Canvas]): number {
  return canvasBytes(pair[0]) + canvasBytes(pair[1]);
}

export interface FrameSurfaceState {
  readonly composition: object;
  readonly frame: number;
  readonly rects: readonly any[];
  readonly canvas: Canvas;
}

export interface RenderSession {
  readonly id: string;
  isDisposed: boolean;
  lastFrameSurface: FrameSurfaceState | null;
  consecutiveFullRedraws: number;

  readonly imageCache: ByteBoundedCache<string, Canvas>;
  readonly rgbaBufferCache: ByteBoundedCache<string, Uint8ClampedArray>;
  readonly videoFrameCache: ByteBoundedCache<string, ExtractedFrame>;
  readonly videoFrameOrigin: Map<string, string>;
  readonly drawBufferCache: ByteBoundedCache<string, [Canvas, Canvas]>;
  readonly renderTargetCache: ByteBoundedCache<string, Canvas>;
  readonly groupCanvasCache: ByteBoundedCache<string, Canvas>;
  readonly transitionCanvasCache: ByteBoundedCache<string, [Canvas, Canvas]>;
  readonly transparentCanvasCache: ByteBoundedCache<string, Canvas>;
  readonly particleCanvasCache: ByteBoundedCache<string, Canvas>;
  readonly noiseTextureCache: ByteBoundedCache<string, Canvas>;
  readonly skyboxCache: Map<string, Promise<CubeTexture>>;
  readonly videoFrameCanvasPool: ByteBoundedCache<string, Canvas>;
  readonly model3dRendererCache: Map<string, any>;
  readonly chromaKeyCanvasCache: ByteBoundedCache<string, Canvas>;
  readonly scaledSurfaceCache: ByteBoundedCache<string, Canvas>;
  readonly matteCanvasPool: Map<string, Canvas>;
  readonly tempCanvasPool: Canvas[];
  readonly imageDataPool: Map<string, ImageData>;
  readonly indexCache: WeakMap<object, any>;

  mediaCache: MediaCache | null;
  disableLocalVideoDecode: boolean;

  getRenderTarget(width: number, height: number): Canvas;
  getDrawBuffers(width: number, height: number): [Canvas, Canvas];
  getGroupCanvas(width: number, height: number): Canvas;
  getTransitionBuffers(width: number, height: number): [Canvas, Canvas];
  getTransparentCanvas(width: number, height: number): Canvas;
  getParticleCanvas(width: number, height: number): Canvas;
  getNoiseTexture(width: number, height: number): Canvas;
  getChromaKeyCanvas(width: number, height: number): Canvas;
  getScaledSurface(width: number, height: number): Canvas;
  getTempCanvas(width: number, height: number): Canvas;
  getImageData(ctx: SKRSContext2D, width: number, height: number): ImageData;
  clearTempCanvases(): void;

  getCacheStats(): readonly CacheStats[];
  dispose(): void;
}

let liveSessionCount = 0;

export function getLiveSessionCount(): number {
  return liveSessionCount;
}

export function resetLiveSessionCount(): void {
  liveSessionCount = 0;
}

let sessionCounter = 0;

export function createRenderSession(id?: string): RenderSession {
  const isJob = id !== "fallback";
  if (isJob) liveSessionCount++;
  const sessionId = id ?? `session-${++sessionCounter}`;

  const registry = getProcessCacheRegistry();
  const globalService = registry.getService();
  const totalMax = globalService.maxBytes;

  const imageLimit = Math.max(16 * 1024 * 1024, Math.floor(totalMax * 0.20));
  const videoLimit = Math.max(32 * 1024 * 1024, Math.floor(totalMax * 0.35));
  const rgbaLimit = Math.max(8 * 1024 * 1024, Math.floor(totalMax * 0.10));
  const canvasLimit = Math.max(32 * 1024 * 1024, Math.floor(totalMax * 0.25));

  const imageCache = new ByteBoundedCache<string, Canvas>(`${sessionId}:images`, imageLimit, canvasBytes, undefined, globalService);
  const rgbaBufferCache = new ByteBoundedCache<string, Uint8ClampedArray>(`${sessionId}:rgba`, rgbaLimit, (arr) => arr.byteLength, undefined, globalService);
  const videoFrameCache = new ByteBoundedCache<string, ExtractedFrame>(`${sessionId}:video-frames`, videoLimit, (f) => f.buffer.byteLength, undefined, globalService);
  const videoFrameOrigin = new Map<string, string>();
  const drawBufferCache = new ByteBoundedCache<string, [Canvas, Canvas]>(`${sessionId}:draw-buffers`, canvasLimit, canvasPairBytes, undefined, globalService);
  const renderTargetCache = new ByteBoundedCache<string, Canvas>(`${sessionId}:render-targets`, canvasLimit, canvasBytes, undefined, globalService);
  const groupCanvasCache = new ByteBoundedCache<string, Canvas>(`${sessionId}:group-canvases`, canvasLimit, canvasBytes, undefined, globalService);
  const transitionCanvasCache = new ByteBoundedCache<string, [Canvas, Canvas]>(`${sessionId}:transition-buffers`, canvasLimit, canvasPairBytes, undefined, globalService);
  const transparentCanvasCache = new ByteBoundedCache<string, Canvas>(`${sessionId}:transparent-canvases`, canvasLimit, canvasBytes, undefined, globalService);
  const particleCanvasCache = new ByteBoundedCache<string, Canvas>(`${sessionId}:particle-canvases`, canvasLimit, canvasBytes, undefined, globalService);
  const noiseTextureCache = new ByteBoundedCache<string, Canvas>(`${sessionId}:noise-textures`, canvasLimit, canvasBytes, undefined, globalService);
  const skyboxCache = new Map<string, Promise<CubeTexture>>();
  const videoFrameCanvasPool = new ByteBoundedCache<string, Canvas>(`${sessionId}:video-canvas-pool`, canvasLimit, canvasBytes, undefined, globalService);
  const model3dRendererCache = new Map<string, any>();
  const chromaKeyCanvasCache = new ByteBoundedCache<string, Canvas>(`${sessionId}:chromakey`, canvasLimit, canvasBytes, undefined, globalService);
  const scaledSurfaceCache = new ByteBoundedCache<string, Canvas>(`${sessionId}:scaled-surfaces`, canvasLimit, canvasBytes, undefined, globalService);
  const matteCanvasPool = new Map<string, Canvas>();
  const tempCanvasPool: Canvas[] = [];
  const imageDataPool = new Map<string, ImageData>();
  const indexCache = new WeakMap<object, any>();

  const allCaches = [
    imageCache,
    rgbaBufferCache,
    videoFrameCache,
    drawBufferCache,
    renderTargetCache,
    groupCanvasCache,
    transitionCanvasCache,
    transparentCanvasCache,
    particleCanvasCache,
    noiseTextureCache,
    videoFrameCanvasPool,
    chromaKeyCanvasCache,
    scaledSurfaceCache,
  ];

  const session: RenderSession = {
    id: sessionId,
    isDisposed: false,
    lastFrameSurface: null,
    consecutiveFullRedraws: 0,

    imageCache,
    rgbaBufferCache,
    videoFrameCache,
    videoFrameOrigin,
    drawBufferCache,
    renderTargetCache,
    groupCanvasCache,
    transitionCanvasCache,
    transparentCanvasCache,
    particleCanvasCache,
    noiseTextureCache,
    skyboxCache,
    videoFrameCanvasPool,
    model3dRendererCache,
    chromaKeyCanvasCache,
    scaledSurfaceCache,
    matteCanvasPool,
    tempCanvasPool,
    imageDataPool,
    indexCache,

    mediaCache: null,
    disableLocalVideoDecode: false,

    getRenderTarget(width, height) {
      const key = `${width}x${height}`;
      let c = renderTargetCache.get(key);
      if (!c) {
        c = createCanvas(width, height);
        renderTargetCache.set(key, c);
      }
      return c;
    },

    getDrawBuffers(width, height) {
      const key = `${width}x${height}`;
      let pair = drawBufferCache.get(key);
      if (!pair) {
        pair = [createCanvas(width, height), createCanvas(width, height)];
        drawBufferCache.set(key, pair);
      }
      return pair;
    },

    getGroupCanvas(width, height) {
      const key = `${width}x${height}`;
      let c = groupCanvasCache.get(key);
      if (!c) {
        c = createCanvas(width, height);
        groupCanvasCache.set(key, c);
      }
      return c;
    },

    getTransitionBuffers(width, height) {
      const key = `${width}x${height}`;
      let pair = transitionCanvasCache.get(key);
      if (!pair) {
        pair = [createCanvas(width, height), createCanvas(width, height)];
        transitionCanvasCache.set(key, pair);
      }
      return pair;
    },

    getTransparentCanvas(width, height) {
      const key = `${width}x${height}`;
      let canvas = transparentCanvasCache.get(key);
      if (!canvas) {
        canvas = createCanvas(width, height);
        transparentCanvasCache.set(key, canvas);
      }
      const ctx = createContext(canvas);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.restore();
      return canvas;
    },

    getParticleCanvas(width, height) {
      const key = `${width}x${height}`;
      let c = particleCanvasCache.get(key);
      if (!c) {
        c = createCanvas(width, height);
        particleCanvasCache.set(key, c);
      }
      return c;
    },

    getNoiseTexture(width, height) {
      const key = `${width}x${height}`;
      let c = noiseTextureCache.get(key);
      if (!c) {
        c = createCanvas(width, height);
        noiseTextureCache.set(key, c);
      }
      return c;
    },

    getChromaKeyCanvas(width, height) {
      const key = `${width}x${height}`;
      let c = chromaKeyCanvasCache.get(key);
      if (!c) {
        c = createCanvas(width, height);
        chromaKeyCanvasCache.set(key, c);
      }
      return c;
    },

    getScaledSurface(width, height) {
      const key = `${width}x${height}`;
      let canvas = scaledSurfaceCache.get(key);
      if (!canvas) {
        canvas = createCanvas(width, height);
        scaledSurfaceCache.set(key, canvas);
      }
      return canvas;
    },

    getTempCanvas(width, height) {
      const canvas = tempCanvasPool.pop() ?? createCanvas(width, height);
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },

    getImageData(ctx, width, height) {
      const key = `${width}x${height}`;
      let imgData = imageDataPool.get(key);
      if (!imgData) {
        imgData = ctx.createImageData(width, height);
        imageDataPool.set(key, imgData);
      }
      return imgData;
    },

    clearTempCanvases() {
      tempCanvasPool.length = 0;
    },

    getCacheStats() {
      return allCaches.map((c) => c.stats());
    },

    dispose() {
      if (this.isDisposed) return;
      this.isDisposed = true;
      if (isJob) liveSessionCount = Math.max(0, liveSessionCount - 1);
      this.lastFrameSurface = null;
      for (const c of allCaches) {
        c.clear();
        unregisterByteCache(c);
      }
      for (const renderer of model3dRendererCache.values()) {
        try {
          renderer?.dispose?.();
        } catch {
          // Note: best-effort disposal
        }
      }
      model3dRendererCache.clear();
      videoFrameOrigin.clear();
      skyboxCache.clear();
      matteCanvasPool.clear();
      tempCanvasPool.length = 0;
      imageDataPool.clear();
      clearMultiCameraCache();
      releaseSessionCaches(sessionId);
      this.mediaCache = null;
    },
  };

  return session;
}

let fallbackSession: RenderSession | null = null;

export function getFallbackSession(): RenderSession {
  if (!fallbackSession || fallbackSession.isDisposed) {
    fallbackSession = createRenderSession("fallback");
  }
  return fallbackSession;
}
