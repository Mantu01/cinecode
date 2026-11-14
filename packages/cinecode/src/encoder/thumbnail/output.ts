import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Canvas, loadImage } from "@napi-rs/canvas";
import type { Composition } from "../../core/types/index.js";
import { selectThumbnailFrame, type ThumbnailSelection } from "./select.js";

export type ThumbnailFormat = "png" | "jpg" | "webp";

export interface ThumbnailSize {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export interface ThumbnailOptions {
  readonly outputDir?: string;
  readonly formats?: readonly ThumbnailFormat[];
  readonly sizes?: readonly ThumbnailSize[];
  readonly frame?: number;
  readonly seed?: number;
}

export interface ThumbnailResult {
  readonly selection: ThumbnailSelection;
  readonly files: readonly { readonly path: string; readonly format: ThumbnailFormat; readonly width: number; readonly height: number }[];
}

export const DEFAULT_THUMBNAIL_SIZES: readonly ThumbnailSize[] = [
  { label: "full", width: 0, height: 0 },
  { label: "hd", width: 1920, height: 1080 },
  { label: "social", width: 1280, height: 720 },
];

async function encodeVariant(buffer: Buffer, width: number, height: number, format: ThumbnailFormat, quality: number): Promise<Buffer> {
  const image = await loadImage(buffer);
  const targetWidth = width > 0 ? width : image.width;
  const targetHeight = height > 0 ? height : image.height;
  if (targetWidth === image.width && targetHeight === image.height && format === "png") return buffer;
  const canvas = new Canvas(targetWidth, targetHeight);
  canvas.getContext("2d").drawImage(image, 0, 0, targetWidth, targetHeight);
  if (format === "jpg") return canvas.encode("jpeg", quality);
  if (format === "webp") return canvas.encode("webp", quality);
  return canvas.encode("png");
}

export async function generateThumbnail(
  composition: Composition,
  outputPaths: string | readonly string[],
  options: ThumbnailOptions = {},
): Promise<ThumbnailResult> {
  const paths = typeof outputPaths === "string" ? [outputPaths] : outputPaths;
  const formats = options.formats ?? ["png"];
  const sizes = options.sizes ?? DEFAULT_THUMBNAIL_SIZES;
  const selection = options.frame !== undefined
    ? await selectThumbnailFrame(composition, { frameIndices: [options.frame], seed: options.seed })
    : await selectThumbnailFrame(composition, { seed: options.seed });

  const files: { path: string; format: ThumbnailFormat; width: number; height: number }[] = [];
  for (const target of paths) {
    await mkdir(dirname(target), { recursive: true });
    const variant = sizes[0] ?? { label: "full", width: 0, height: 0 };
    for (const format of formats) {
      const buffer = await encodeVariant(selection.buffer, variant.width, variant.height, format, 90);
      const path = formats.length === 1 ? target : target.replace(/(\.[a-z0-9]+)?$/i, `.${format}`);
      await writeFile(path, buffer);
      files.push({ path, format, width: variant.width || composition.width, height: variant.height || composition.height });
    }
  }

  if (options.outputDir) {
    for (const size of sizes.slice(1)) {
      for (const format of formats) {
        const buffer = await encodeVariant(selection.buffer, size.width, size.height, format, 88);
        const path = join(options.outputDir, `thumbnail-${size.label}.${format}`);
        await writeFile(path, buffer);
        files.push({ path, format, width: size.width, height: size.height });
      }
    }
  }

  return { selection, files };
}
