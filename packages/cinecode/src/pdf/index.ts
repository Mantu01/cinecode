import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export interface PdfOptions {
  readonly width?: number;
  readonly height?: number;
  readonly dpi?: number;
  readonly compress?: boolean;
}

export interface PdfShapeContent {
  readonly shapeType: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius?: number;
  readonly points?: readonly { readonly x: number; readonly y: number }[];
  readonly path?: readonly {
    readonly command: string;
    readonly points: readonly { readonly x: number; readonly y: number }[];
  }[];
  readonly fill?: string;
  readonly stroke?: { readonly color: string; readonly width: number };
  readonly opacity?: number;
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
  readonly shape?: PdfShapeContent;
}

export interface PdfDocumentOptions {
  readonly width: number;
  readonly height: number;
  readonly dpi?: number;
  readonly title?: string;
}

export interface PdfBuildResult {
  readonly buffer: Buffer;
  readonly pages: number;
  readonly title: string;
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
 * Incremental PDF assembly: each rendered frame is embedded as a page as soon
 * as it arrives, so no frame sequence is buffered. Metadata describes the
 * document (title, page count, page size), not its byte count.
 */
export class PdfDocumentBuilder {
  private readonly doc: PDFDocument;
  private readonly options: Required<Pick<PdfDocumentOptions, "width" | "height" | "dpi" | "title">>;

  private constructor(doc: PDFDocument, options: Required<PdfDocumentOptions>) {
    this.doc = doc;
    this.options = options;
  }

  static async create(options: PdfDocumentOptions): Promise<PdfDocumentBuilder> {
    const doc = await PDFDocument.create();
    return new PdfDocumentBuilder(doc, {
      width: options.width,
      height: options.height,
      dpi: options.dpi ?? 150,
      title: options.title ?? "Cinecode document",
    });
  }

  /** Raw document, so vector-only compositions can append native pages. */
  get document(): PDFDocument {
    return this.doc;
  }

  get pageCount(): number {
    return this.doc.getPageCount();
  }

  get pageSize(): { readonly width: number; readonly height: number } {
    return { width: this.options.width, height: this.options.height };
  }

  async addPngFrame(png: Buffer): Promise<void> {
    const page = this.doc.addPage([this.options.width, this.options.height]);
    await renderPdfContent(page, {
      type: "canvas",
      data: png,
      width: this.options.width,
      height: this.options.height,
    }, { width: this.options.width, height: this.options.height, dpi: this.options.dpi });
  }

  async addContentPage(contents: readonly PdfPageContent[]): Promise<void> {
    const page = this.doc.addPage([this.options.width, this.options.height]);
    for (const content of contents) {
      await renderPdfContent(page, content, {
        width: this.options.width,
        height: this.options.height,
        dpi: this.options.dpi,
      });
    }
  }

  async finish(options: { readonly author?: string } = {}): Promise<PdfBuildResult> {
    const pages = this.doc.getPageCount();
    this.doc.setTitle(this.options.title);
    this.doc.setProducer("Cinecode");
    this.doc.setCreator("Cinecode");
    if (options.author) this.doc.setAuthor(options.author);
    this.doc.setSubject(
      `${pages} page${pages === 1 ? "" : "s"} at ${this.options.width}x${this.options.height}px`,
    );
    this.doc.setCreationDate(new Date(0));
    this.doc.setModificationDate(new Date(0));
    return { buffer: Buffer.from(await this.doc.save()), pages, title: this.options.title };
  }
}

/** Generates a multi-page PDF from prepared page contents, one page each. */
export async function generatePdf(
  pages: PdfPageContent[][],
  options: PdfOptions = {},
): Promise<Buffer> {
  const builder = await PdfDocumentBuilder.create({
    width: options.width ?? 612,
    height: options.height ?? 792,
    dpi: options.dpi,
  });
  for (const contents of pages) await builder.addContentPage(contents);
  return (await builder.finish()).buffer;
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
      if (content.data.length > 8 && content.data.readUInt32BE(0) === 0x89504e47) {
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
      const shape = content.shape;
      if (!shape) return;
      const { drawRect, drawCircle, drawPath } = await import("./vector.js");
      const style = { fill: shape.fill, stroke: shape.stroke, opacity: shape.opacity };
      if (shape.shapeType === "rectangle" || shape.shapeType === "rounded-rectangle") {
        drawRect(page, shape, style, ctx.height, shape.shapeType === "rounded-rectangle" ? shape.radius : undefined);
        break;
      }
      if (shape.shapeType === "ellipse") {
        drawCircle(
          page,
          {
            cx: shape.x + shape.width / 2,
            cy: shape.y + shape.height / 2,
            radiusX: shape.width / 2,
            radiusY: shape.height / 2,
          },
          style,
          ctx.height,
        );
        break;
      }
      drawPath(page, (shape.path ?? []) as never, style, ctx.height, { x: shape.x, y: shape.y });
      break;
    }
  }
}
