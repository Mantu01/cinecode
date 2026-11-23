import { optimize } from "svgo";
import type { Composition } from "../core/types/index.js";

export type CssMode = "inline" | "embedded" | "external";
export type FontStrategy = "embed-base64" | "link-webfont" | "convert-to-paths";

export interface SvgSerializerOptions {
  viewBoxPrecision?: number;
  cssMode?: CssMode;
  fontStrategy?: FontStrategy;
  optimize?: boolean;
}

interface SvgClip {
  readonly type?: string;
  readonly text?: string;
  readonly start?: number;
  readonly duration?: number;
  readonly fontSize?: number;
  readonly color?: string;
  readonly x?: number;
  readonly y?: number;
  readonly shape?: string;
  readonly radius?: number;
  readonly w?: number;
  readonly h?: number;
}

export interface UnsupportedSvgClip {
  readonly id: string;
  readonly type: string;
  readonly track: string;
  readonly start: number;
  readonly duration: number;
}

export function unsupportedSvgClips(comp: Composition): readonly UnsupportedSvgClip[] {
  const unsupported: UnsupportedSvgClip[] = [];
  for (const track of comp.rootTimeline?.tracks ?? []) {
    if (track.kind !== "visual") continue;
    for (const clip of track.clips as readonly any[]) {
      if (clip.type === "text" || clip.type === "shape" || clip.type === "solid") continue;
      unsupported.push({
        id: String(clip.name ?? clip.id ?? "unnamed"),
        type: String(clip.type ?? "unknown"),
        track: track.name ?? "unnamed",
        start: Number(clip.start ?? 0),
        duration: Number(clip.duration ?? 0),
      });
    }
  }
  return unsupported;
}

export function serializeFrameToSvg(
  comp: Composition,
  frame: number,
  options: SvgSerializerOptions = {},
): string {
  const width = comp.width || 1920;
  const height = comp.height || 1080;
  const precision = options.viewBoxPrecision ?? 3;
  const bg = comp.background || "#000000";

  const elements: string[] = [];
  elements.push(`<rect width="${width}" height="${height}" fill="${bg}" />`);

  const fps = comp.fps || 30;
  const time = frame / fps;

  const rawClips: readonly SvgClip[] = comp.rootTimeline?.tracks
    ? comp.rootTimeline.tracks.flatMap((t) => t.clips as readonly SvgClip[])
    : ((comp as unknown as { clips?: readonly SvgClip[] }).clips ?? []);
  for (const clip of rawClips) {
    const start = Number(clip.start ?? 0);
    const dur = Number(clip.duration ?? 5);
    if (time < start || time > start + dur) continue;

    if (clip.type === "text") {
      const text = String(clip.text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const fontSize = clip.fontSize || 48;
      const fill = clip.color || "#ffffff";
      const x = clip.x ?? width * 0.5;
      const y = clip.y ?? height * 0.5;

      elements.push(
        `<text x="${x.toFixed(precision)}" y="${y.toFixed(precision)}" font-size="${fontSize}" fill="${fill}" text-anchor="middle" dominant-baseline="middle">${text}</text>`,
      );
    } else if (clip.type === "solid") {
      elements.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${clip.color || "#000000"}" />`);
    } else if (clip.type === "shape") {
      const shapeType = clip.shape || "rect";
      const fill = clip.color || "#3182ce";
      if (shapeType === "circle") {
        const cx = clip.x ?? width * 0.5;
        const cy = clip.y ?? height * 0.5;
        const r = clip.radius ?? 50;
        elements.push(`<circle cx="${cx.toFixed(precision)}" cy="${cy.toFixed(precision)}" r="${r}" fill="${fill}" />`);
      } else {
        const x = clip.x ?? 100;
        const y = clip.y ?? 100;
        const w = clip.w ?? 200;
        const h = clip.h ?? 200;
        elements.push(`<rect x="${x.toFixed(precision)}" y="${y.toFixed(precision)}" width="${w}" height="${h}" fill="${fill}" />`);
      }
    }
  }

  const rawSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n  ${elements.join("\n  ")}\n</svg>`;

  if (options.optimize) {
    try {
      const result = optimize(rawSvg, {
        multipass: true,
        floatPrecision: precision,
      });
      return result.data;
    } catch {
      return rawSvg;
    }
  }

  return rawSvg;
}
