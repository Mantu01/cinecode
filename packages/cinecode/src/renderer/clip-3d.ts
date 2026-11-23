import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Composition, Model3dClip, MultiCameraClip, Text3dClip } from "../core/types/index.js";
import type { Rect, ShapeDrawParams } from "./shapes/index.js";
import { createDefaultTransform, applyTransform } from "./shapes/index.js";
import { loadCubeMap, loadEquirectangular, type CubeTexture } from "../model-3d/environment/cubeMap.js";
import { createProceduralSkybox, renderSkybox } from "../model-3d/environment/skybox.js";
import { renderMultiCameraFrame } from "./multi-camera.js";
import { extrudeTextGeometry } from "../text-3d/mesh.js";
import { createTextStyle3d } from "../text-3d/material.js";
import { renderTextMesh } from "../text-3d/render.js";
import { evictOldest, evictOldestWithDispose } from "./pool.js";
import { type RenderSession, getFallbackSession } from "./session.js";
import type { RenderContext } from "./engine-types.js";

const SKYBOX_CACHE_MAX = 8;

export function resolveSkyboxTexture(composition: Composition, session?: RenderSession): Promise<CubeTexture> | null {
  const config = composition.skybox;
  if (!config) return null;
  const s = session ?? getFallbackSession();
  const key = JSON.stringify(config);
  const cached = s.skyboxCache.get(key);
  if (cached) return cached;
  const loading = (async () => {
    if (config.type === "procedural") return createProceduralSkybox();
    if (config.type === "equirectangular" && config.src) return loadEquirectangular(config.src);
    const faces = config.faces;
    if (faces && faces.length >= 6) {
      return loadCubeMap({
        posX: faces[0]!,
        negX: faces[1]!,
        posY: faces[2]!,
        negY: faces[3]!,
        posZ: faces[4]!,
        negZ: faces[5]!,
      });
    }
    return createProceduralSkybox();
  })();
  s.skyboxCache.set(key, loading);
  evictOldest(s.skyboxCache, SKYBOX_CACHE_MAX);
  return loading;
}

export async function applySkybox(
  ctx: SKRSContext2D,
  composition: Composition,
): Promise<CubeTexture | null> {
  const texture = await resolveSkyboxTexture(composition);
  if (!texture) return null;
  renderSkybox(ctx, texture, composition.width, composition.height, {
    exposure: composition.skybox?.exposure,
    yaw: composition.skybox?.yaw,
    pitch: composition.skybox?.pitch,
  });
  return texture;
}

export function model3dCacheKey(src: string, materialOverrides?: unknown): string {
  if (!materialOverrides) return src;
  const hash = typeof materialOverrides === "object" ? JSON.stringify(materialOverrides) : String(materialOverrides);
  return `${src}::${hash}`;
}

export async function drawModel3dClip(
  ctx: SKRSContext2D,
  clip: Model3dClip,
  bounds: Rect,
  params: ShapeDrawParams,
  context: RenderContext,
): Promise<void> {
  const { composition } = context;
  const { Model3dRenderer } = await import("../model-3d/renderer.js");
  const cache = context.session.model3dRendererCache;
  const key = model3dCacheKey(clip.src, clip.materialOverrides);
  let renderer = cache.get(key);
  if (!renderer) {
    evictOldestWithDispose(cache, 8);
    renderer = new Model3dRenderer();
    await renderer.loadModel(clip.src);
    cache.set(key, renderer);
  }

  const camera = clip.camera;
  const environment = await resolveSkyboxTexture(composition, context.session);
  const canvas = await renderer.renderFrame(context.frame, composition.fps, {
    src: clip.src,
    width: clip.width ?? bounds.width,
    height: clip.height ?? bounds.height,
    environment: environment ?? undefined,
    camera:
      camera?.orbit === true
        ? { position: [0, 0, (camera.radius ?? 5) * 2], target: [0, 0, 0] }
        : undefined,
    animation:
      camera?.orbit === true
        ? {
            type: "orbit",
            duration: composition.duration !== undefined ? Number(composition.duration) || 1 : 1,
            orbitRadius: camera.radius ?? 5,
            orbitSpeed: camera.speed ?? 0.5,
          }
        : undefined,
    lighting: clip.lighting,
    skeletal: clip.animation,
    materialOverrides: clip.materialOverrides,
  });

  ctx.save();
  if (params.transform)
    applyTransform(
      ctx,
      { ...createDefaultTransform(), ...params.transform },
      bounds.width,
      bounds.height,
    );
  ctx.drawImage(canvas, 0, 0, bounds.width, bounds.height);
  ctx.restore();
}

export async function drawMultiCameraClip(
  ctx: SKRSContext2D,
  clip: MultiCameraClip,
  bounds: Rect,
  params: ShapeDrawParams,
  context: RenderContext,
): Promise<void> {
  const environment = await resolveSkyboxTexture(context.composition, context.session);
  const canvas = await renderMultiCameraFrame(clip, context.time, {
    frame: context.frame,
    fps: context.conversion.fpsFloat,
    width: Math.max(1, Math.round(clip.width ?? bounds.width)),
    height: Math.max(1, Math.round(clip.height ?? bounds.height)),
    environment: environment ?? undefined,
  });
  ctx.save();
  if (params.transform)
    applyTransform(
      ctx,
      { ...createDefaultTransform(), ...params.transform },
      bounds.width,
      bounds.height,
    );
  ctx.drawImage(canvas, 0, 0, bounds.width, bounds.height);
  ctx.restore();
}

export function drawText3dClip(
  ctx: SKRSContext2D,
  clip: Text3dClip,
  bounds: Rect,
  params: ShapeDrawParams,
): void {
  const mesh = extrudeTextGeometry(
    clip.content,
    {
      fontFamily: clip.fontFamily,
      fontSize: clip.fontSize,
      fontWeight: clip.fontWeight,
      fontStyle: clip.fontStyle,
    },
    {
      depth: clip.extrusionDepth ?? 20,
      bevel: clip.bevel === true,
      bevelDepth: clip.bevelDepth,
      maxWidth: Math.max(64, Math.round(bounds.width)),
    },
  );
  const material = createTextStyle3d(clip.frontColor ?? "#ffffff", clip.sideColor, clip.backColor);
  const scale = Math.min(1, bounds.width / Math.max(1, mesh.width));

  ctx.save();
  applyTransform(
    ctx,
    { ...createDefaultTransform(), ...params.transform },
    bounds.width,
    bounds.height,
  );
  ctx.globalAlpha = params.opacity ?? 1;
  renderTextMesh(ctx, mesh, material, {
    x: bounds.width / 2,
    y: bounds.height / 2,
    scale,
    rotationY: clip.rotationY,
    rotationX: clip.rotationX,
  });
  ctx.restore();
}
