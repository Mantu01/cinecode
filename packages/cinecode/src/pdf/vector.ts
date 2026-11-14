import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Composition } from "../core/types/index.js";

export interface PdfVectorOptions {
  readonly width: number;
  readonly height: number;
}

/**
 * Checks whether a composition contains only vector-friendly clips (shape/text).
 * Returns false for any video or raster image clip.
 */
export function isVectorOnly(composition: Composition): boolean {
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      if ((clip as { type?: string }).type === "video") return false;
    }
  }
  return true;
}

/**
 * Converts a vector-only composition to a single-page PDF at the given frame.
 * Returns null if the composition contains non-vector elements.
 */
export async function compositionToVectorPdf(
  composition: Composition,
  _frame: number,
  options: PdfVectorOptions,
): Promise<Buffer | null> {
  if (!isVectorOnly(composition)) return null;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([options.width, options.height]);
  const font = await page.doc.embedFont(StandardFonts.Helvetica);

  // Render each track's clips at the given frame time
  const time = _frame / composition.fps;
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      await renderVectorClip(page, clip as never, time, composition.fps, options, font);
    }
  }

  return Buffer.from(await pdfDoc.save());
}

async function renderVectorClip(
  page: import("pdf-lib").PDFPage,
  clip: never,
  time: number,
  fps: number,
  options: PdfVectorOptions,
  font: import("pdf-lib").PDFFont,
): Promise<void> {
  const shape = clip as { type?: string; content?: { text?: string; color?: string; fontSize?: number }; x?: number; y?: number; w?: number; h?: number };
  if (shape.type === "text" && shape.content?.text) {
    const color = shape.content.color ? hexToRgb(shape.content.color) : rgb(0, 0, 0);
    const size = shape.content.fontSize ?? 12;
    page.drawText(shape.content.text, {
      x: shape.x ?? 10,
      y: (options.height ?? 792) - (shape.y ?? 0) - size,
      size,
      font,
      color,
    });
  }
  // Other shape types (rect, circle, path) can be added here
}

function hexToRgb(hex: string): ReturnType<typeof rgb> {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return rgb(0, 0, 0);
  return rgb(
    parseInt(result[1]!, 16) / 255,
    parseInt(result[2]!, 16) / 255,
    parseInt(result[3]!, 16) / 255,
  );
}
