import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Composition } from "../core/types/index.js";

export interface PdfOptions {
  readonly width?: number;
  readonly height?: number;
  readonly dpi?: number;
  readonly compress?: boolean;
}

export interface PdfPageContent {
  readonly type: "image" | "text" | "shape" | "canvas";
  readonly data?: Buffer;
  readonly width?: number;
  readonly height?: number;
  readonly x?: number;
  readonly y?: number;
  readonly text?: string;
  readonly fontSize?: number;
  readonly color?: string;
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

/**
 * Generates a multi-page PDF from rendered frame buffers.
 * Each frame becomes one page in the output PDF.
 * Uses pdf-lib (no native deps, pure JS).
 */
export async function generatePdf(
  pages: PdfPageContent[][],
  options: PdfOptions = {},
): Promise<Buffer> {
  const {
    width = 612,
    height = 792,
    dpi = 150,
  } = options;

  const pdfDoc = await PDFDocument.create();

  for (const pageContents of pages) {
    const page = pdfDoc.addPage([width, height]);
    for (const content of pageContents) {
      await renderPdfContent(page, content, { width, height, dpi });
    }
  }

  return Buffer.from(await pdfDoc.save());
}

async function renderPdfContent(
  page: import("pdf-lib").PDFPage,
  content: PdfPageContent,
  ctx: { width: number; height: number; dpi: number },
): Promise<void> {
  switch (content.type) {
    case "image":
    case "canvas": {
      if (!content.data || !content.width || !content.height) return;
      const scaleX = ctx.width / content.width;
      const scaleY = ctx.height / content.height;
      const scale = Math.min(scaleX, scaleY);
      const drawWidth = content.width * scale;
      const drawHeight = content.height * scale;
      const x = (ctx.width - drawWidth) / 2 + (content.x ?? 0);
      const y = (ctx.height - drawHeight) / 2 + (content.y ?? 0);

      let img: import("pdf-lib").PDFImage;
      // png buffer (4-byte RGBA from rawbgra transport — need to convert to RGB for embed)
      // pdf-lib's embedPng accepts raw PNG bytes directly.
      if (content.data.length > 8 &&
          content.data.readUInt32BE(0) === 0x89504e47) {
        img = await page.doc.embedPng(content.data);
      } else {
        img = await page.doc.embedJpg(content.data);
      }
      page.drawImage(img, { x, y, width: drawWidth, height: drawHeight });
      break;
    }
    case "text": {
      if (!content.text) return;
      const font = await page.doc.embedFont(StandardFonts.Helvetica);
      const size = content.fontSize ?? 12;
      const color = content.color ? hexToRgb(content.color) : rgb(0, 0, 0);
      page.drawText(content.text, {
        x: content.x ?? 0,
        y: content.y ?? ctx.height - size,
        size,
        font,
        color,
      });
      break;
    }
    case "shape": {
      // vector shapes delegated to vector mode — placeholder
      break;
    }
  }
}
