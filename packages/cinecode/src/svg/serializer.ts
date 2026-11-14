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

  const rawClips = (comp as any).clips ?? (comp.rootTimeline?.tracks ? comp.rootTimeline.tracks.flatMap((t: any) => t.clips) : []);
  for (const c of rawClips) {
    const clip = c as any;
    const start = Number(clip.start ?? 0);
    const dur = Number(clip.duration ?? 5);
    if (time < start || time > start + dur) continue;

    if (clip.type === "text") {
      const text = clip.text || "";
      const fontSize = clip.fontSize || 48;
      const fill = clip.color || "#ffffff";
      const x = clip.x ?? width * 0.5;
      const y = clip.y ?? height * 0.5;

      elements.push(
        `<text x="${x.toFixed(precision)}" y="${y.toFixed(precision)}" font-size="${fontSize}" fill="${fill}" text-anchor="middle" dominant-baseline="middle">${text}</text>`,
      );
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
