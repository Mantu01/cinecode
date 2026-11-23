import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { CubeTexture } from "../model-3d/environment/cubeMap.js";
import type { MultiCameraClip } from "../core/types/clips.js";
import {
  evaluateMultiCamera,
  type CameraViewState,
  type MultiCameraFrameState,
} from "../core/clips/multi-camera.js";

import { evictOldestWithDispose } from "./pool.js";

export interface MultiCameraRenderOptions {
  readonly frame: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly environment?: CubeTexture;
}

export interface MultiCameraPreviewOptions extends MultiCameraRenderOptions {
  readonly tileWidth?: number;
  readonly tileHeight?: number;
  readonly columns?: number;
  readonly gap?: number;
  readonly background?: string;
  readonly labels?: boolean;
  readonly maxCameras?: number;
}

const MULTI_CAMERA_MODEL_CACHE_MAX = 8;
const modelCache = new Map<string, import("../model-3d/renderer.js").Model3dRenderer>();

export function clearMultiCameraCache(): void {
  for (const renderer of modelCache.values()) {
    try {
      renderer.dispose();
    } catch {
      // Note: best-effort disposal
    }
  }
  modelCache.clear();
}

async function getRenderer(src: string): Promise<import("../model-3d/renderer.js").Model3dRenderer> {
  const cached = modelCache.get(src);
  if (cached) return cached;
  evictOldestWithDispose(modelCache, MULTI_CAMERA_MODEL_CACHE_MAX);
  const { Model3dRenderer } = await import("../model-3d/renderer.js");
  const renderer = new Model3dRenderer();
  await renderer.loadModel(src);
  modelCache.set(src, renderer);
  return renderer;
}

export async function renderMultiCameraView(
  clip: MultiCameraClip,
  view: CameraViewState,
  options: MultiCameraRenderOptions,
): Promise<Canvas> {
  const renderer = await getRenderer(clip.src);
  return renderer.renderFrame(options.frame, options.fps, {
    src: clip.src,
    width: options.width,
    height: options.height,
    camera: { near: 0.1, far: 1000 },
    viewMatrix: view.viewMatrix,
    projectionMatrix: view.projectionMatrix,
    lighting: clip.lighting,
    environment: options.environment,
  });
}

function cropDirectionRange(direction: MultiCameraClip["wipeDirection"]): { horizontal: boolean; reverse: boolean } {
  switch (direction) {
    case "right":
      return { horizontal: true, reverse: true };
    case "up":
      return { horizontal: false, reverse: true };
    case "down":
      return { horizontal: false, reverse: false };
    default:
      return { horizontal: true, reverse: false };
  }
}

export function compositeCameraTransition(
  state: MultiCameraFrameState,
  fromCanvas: Canvas,
  toCanvas: Canvas,
  width: number,
  height: number,
  direction: MultiCameraClip["wipeDirection"] = "left",
): Canvas {
  const output = createCanvas(width, height);
  const ctx = output.getContext("2d");
  ctx.drawImage(fromCanvas, 0, 0, width, height);

  if (state.transitionType === "dissolve") {
    ctx.globalAlpha = state.transitionProgress;
    ctx.drawImage(toCanvas, 0, 0, width, height);
    ctx.globalAlpha = 1;
    return output;
  }

  if (state.transitionType === "wipe") {
    const { horizontal, reverse } = cropDirectionRange(direction);
    const span = horizontal ? width : height;
    const edge = Math.round(span * state.transitionProgress);
    ctx.save();
    ctx.beginPath();
    if (horizontal) {
      const x = reverse ? span - edge : 0;
      ctx.rect(x, 0, edge, height);
    } else {
      const y = reverse ? span - edge : 0;
      ctx.rect(0, y, width, edge);
    }
    ctx.clip();
    ctx.drawImage(toCanvas, 0, 0, width, height);
    ctx.restore();
    return output;
  }

  ctx.drawImage(toCanvas, 0, 0, width, height);
  return output;
}

export async function renderMultiCameraFrame(
  clip: MultiCameraClip,
  timeSeconds: number,
  options: MultiCameraRenderOptions,
): Promise<Canvas> {
  const state = evaluateMultiCamera(clip, timeSeconds, {
    aspect: options.width / Math.max(1, options.height),
  });
  const toCanvas = await renderMultiCameraView(clip, state.to, options);
  if (!state.from || state.transitionType === "cut") {
    return toCanvas;
  }
  const fromCanvas = await renderMultiCameraView(clip, state.from, options);
  return compositeCameraTransition(
    state,
    fromCanvas,
    toCanvas,
    options.width,
    options.height,
    clip.wipeDirection,
  );
}

export async function renderMultiCameraPreview(
  clip: MultiCameraClip,
  timeSeconds: number,
  options: MultiCameraPreviewOptions,
): Promise<Canvas> {
  const ids = Object.keys(clip.cameras);
  const limited = options.maxCameras !== undefined ? ids.slice(0, Math.max(1, options.maxCameras)) : ids;
  const columns = Math.max(1, options.columns ?? Math.ceil(Math.sqrt(limited.length || 1)));
  const rows = Math.max(1, Math.ceil(limited.length / columns));
  const tileWidth = Math.max(1, options.tileWidth ?? Math.round(options.width / columns));
  const tileHeight = Math.max(1, options.tileHeight ?? Math.round(tileWidth * 0.5625));
  const gap = Math.max(0, options.gap ?? 4);
  const width = columns * tileWidth + gap * (columns + 1);
  const height = rows * tileHeight + gap * (rows + 1);
  const output = createCanvas(width, height);
  const ctx = output.getContext("2d");
  ctx.fillStyle = options.background ?? "#000000";
  ctx.fillRect(0, 0, width, height);

  const state = evaluateMultiCamera(clip, timeSeconds, { aspect: tileWidth / tileHeight });
  for (let index = 0; index < limited.length; index += 1) {
    const cameraId = limited[index]!;
    const camera = clip.cameras[cameraId];
    if (!camera) continue;
    const tile = await renderTile(clip, cameraId, tileWidth, tileHeight, options);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + column * (tileWidth + gap);
    const y = gap + row * (tileHeight + gap);
    ctx.drawImage(tile, x, y, tileWidth, tileHeight);
    if (options.labels ?? true) {
      drawLabel(ctx, cameraId, x, y, cameraId === state.activeCameraId);
    }
  }

  return output;
}

async function renderTile(
  clip: MultiCameraClip,
  cameraId: string,
  width: number,
  height: number,
  options: MultiCameraPreviewOptions,
): Promise<Canvas> {
  const camera = clip.cameras[cameraId];
  if (!camera) return createCanvas(width, height);
  const state = camera.getState();
  const aspect = width / Math.max(1, height);
  if (Math.abs(state.aspect - aspect) > 1e-6) camera.setAspect(aspect);
  const tileClip: MultiCameraClip = { ...clip, switches: [] };
  return renderMultiCameraView(
    tileClip,
    {
      cameraId,
      position: state.position,
      target: state.target,
      orientation: state.orientation,
      viewMatrix: camera.getViewMatrix(),
      projectionMatrix: camera.getProjectionMatrix(),
    },
    {
      frame: options.frame,
      fps: options.fps,
      width,
      height,
      environment: options.environment,
    },
  );
}

function drawLabel(ctx: SKRSContext2D, label: string, x: number, y: number, active: boolean): void {
  const padding = 6;
  const fontSize = 14;
  ctx.save();
  ctx.font = `${active ? "bold" : "normal"} ${fontSize}px sans-serif`;
  const textWidth = ctx.measureText(label).width;
  ctx.fillStyle = active ? "rgba(255, 196, 0, 0.85)" : "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(x + padding, y + padding, textWidth + padding * 2, fontSize + padding);
  ctx.fillStyle = active ? "#000000" : "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + padding * 2, y + padding + (fontSize + padding) / 2);
  ctx.restore();
}
