import type { Composition } from "../core/types/index.js";
import {
  assembleTimelineComposition,
  composeSceneComposition,
  resolveAudioBuffer,
  resolveImageClip,
  type ManifestProject,
} from "../manifest/index.js";
import { renderImageBuffer } from "../renderer/image.js";
import { encodeWavBuffer } from "../audio/muxer.js";
import { createError, ErrorCode } from "../errors/index.js";
import type { DevNode, PreviewFrame } from "./types.js";
import {
  PreviewEngine,
  type PreviewCameraState,
} from "../renderer/preview-engine.js";
import type { ResolutionScale } from "../renderer/scale.js";

export async function produceServerPreview(
  project: ManifestProject,
  node: DevNode,
  frame: number,
  scale: ResolutionScale,
  camera?: PreviewCameraState,
): Promise<PreviewFrame> {
  const safeFrame = Number.isFinite(frame) && frame >= 0 ? Math.floor(frame) : 0;
  switch (node.kind) {
    case "image": {
      const resolvedImage = await resolveImageClip(project, node.id);
      const width = Math.max(1, Math.round(resolvedImage.width * scale));
      const height = Math.max(1, Math.round(resolvedImage.height * scale));
      const buffer = await renderImageBuffer(resolvedImage.clips, {
        width,
        height,
        background: resolvedImage.background,
        format: "png",
        scaleFactor: scale,
      });
      return { buffer, contentType: "image/png", width, height, frame: 0 };
    }
    case "audio": {
      const buffer = await resolveAudioBuffer(project, node.id);
      return { buffer: encodeWavBuffer(buffer), contentType: "audio/wav", frame: 0 };
    }
    case "scene": {
      const composition = await composeSceneComposition(project, node.id);
      const engine = new PreviewEngine(composition, { scale, bypassEffects: true, camera });
      const renderResult = await engine.render(safeFrame);
      const buffer = (renderResult.canvas as unknown as { toBuffer(mime: string): Buffer }).toBuffer("image/png");
      const width = renderResult.canvas.width;
      const height = renderResult.canvas.height;
      engine.dispose();
      return { buffer, contentType: "image/png", width, height, frame: safeFrame };
    }
    case "timeline": {
      const composition = await assembleTimelineComposition(project, node.id);
      const engine = new PreviewEngine(composition, { scale, bypassEffects: true, camera });
      const renderResult = await engine.render(safeFrame);
      const buffer = (renderResult.canvas as unknown as { toBuffer(mime: string): Buffer }).toBuffer("image/png");
      const width = renderResult.canvas.width;
      const height = renderResult.canvas.height;
      engine.dispose();
      return { buffer, contentType: "image/png", width, height, frame: safeFrame };
    }
    default:
      throw createError(ErrorCode.CC4001, { reason: `Node kind '${node.kind}' is not previewable.` });
  }
}

export async function resolveServerComposition(
  project: ManifestProject,
  node: DevNode,
): Promise<Composition | null> {
  if (node.kind === "scene") return composeSceneComposition(project, node.id);
  if (node.kind === "timeline") return assembleTimelineComposition(project, node.id);
  return null;
}
