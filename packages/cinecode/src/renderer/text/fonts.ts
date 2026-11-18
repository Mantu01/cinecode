import { GlobalFonts } from "@napi-rs/canvas";
import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { FontEntry } from "../../core/types/index.js";

export const SUPPORTED_FONT_EXTENSIONS: readonly string[] = [".ttf", ".otf", ".ttc"];
export const WEB_FONT_EXTENSIONS: readonly string[] = [".woff", ".woff2"];

export interface FontIssue {
  readonly family: string;
  readonly path?: string;
  readonly code: string;
  readonly message: string;
}

export interface RegisteredFont {
  readonly family: string;
  readonly src: string;
  readonly kind: "file" | "platform";
  readonly resolvedPath?: string;
  readonly weight?: number | string;
  readonly style?: string;
}

export interface FontRegistrationResult {
  readonly fonts: readonly RegisteredFont[];
  readonly errors: readonly FontIssue[];
  readonly warnings: readonly FontIssue[];
}

const registered = new Map<string, RegisteredFont>();

export function getRegisteredProjectFonts(): readonly RegisteredFont[] {
  return [...registered.values()].sort((a, b) => a.family.localeCompare(b.family) || a.src.localeCompare(b.src));
}

function platformFamilies(): Set<string> {
  return new Set(GlobalFonts.families.map((entry) => entry.family.toLowerCase()));
}

function isPathLike(src: string): boolean {
  return isAbsolute(src) || src.startsWith(".") || /[\\/]/.test(src) || extname(src) !== "";
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Registers configured fonts into the canvas backend for this process. File
 * paths resolve under the media root; a bare family name refers to a platform
 * font. The first entry for a family wins so two machines register the same face.
 */
export function registerProjectFonts(
  fonts: readonly FontEntry[] | undefined,
  options: { readonly projectRoot: string; readonly mediaDir: string },
): FontRegistrationResult {
  const errors: FontIssue[] = [];
  const warnings: FontIssue[] = [];
  const accepted: RegisteredFont[] = [];
  const families = new Set<string>();
  const available = platformFamilies();
  const mediaRoot = resolve(options.projectRoot, options.mediaDir);

  for (const font of [...(fonts ?? [])].sort((a, b) => a.family.localeCompare(b.family) || a.src.localeCompare(b.src))) {
    const family = font.family.trim();
    if (families.has(family.toLowerCase())) {
      warnings.push({
        family,
        path: font.src,
        code: "CC3006",
        message: `Duplicate font family "${family}" ignored; the first configured face wins`,
      });
      continue;
    }

    if (!isPathLike(font.src)) {
      if (available.has(font.src.toLowerCase()) || available.has(family.toLowerCase())) {
        families.add(family.toLowerCase());
        accepted.push({ family, src: font.src, kind: "platform", weight: font.weight, style: font.style });
        continue;
      }
      errors.push({
        family,
        path: font.src,
        code: "CC3006",
        message: `Platform font family "${font.src}" is not installed for "${family}"`,
      });
      continue;
    }

    const extension = extname(font.src).toLowerCase();
    if (WEB_FONT_EXTENSIONS.includes(extension)) {
      errors.push({
        family,
        path: font.src,
        code: "CC1003",
        message: `Font "${family}" uses unsupported web format "${extension}"; convert it to .ttf, .otf or .ttc`,
      });
      continue;
    }
    if (!SUPPORTED_FONT_EXTENSIONS.includes(extension)) {
      errors.push({
        family,
        path: font.src,
        code: "CC1003",
        message: `Font "${family}" has unsupported extension "${extension || "none"}"; supported: ${SUPPORTED_FONT_EXTENSIONS.join(", ")}`,
      });
      continue;
    }

    const resolvedPath = resolve(options.projectRoot, font.src);
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
      errors.push({
        family,
        path: resolvedPath,
        code: "CC2001",
        message: `Font file not found for "${family}": ${resolvedPath}`,
      });
      continue;
    }
    if (!inside(mediaRoot, resolvedPath)) {
      errors.push({
        family,
        path: resolvedPath,
        code: "CC1003",
        message: `Font "${family}" must live inside the media root: ${mediaRoot}`,
      });
      continue;
    }

    try {
      const key = GlobalFonts.registerFromPath(resolvedPath, family);
      if (!key) throw new Error("the backend rejected the font file");
    } catch (error) {
      errors.push({
        family,
        path: resolvedPath,
        code: "CC3006",
        message: `Font "${family}" could not be registered: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    families.add(family.toLowerCase());
    const record: RegisteredFont = {
      family,
      src: font.src,
      kind: "file",
      resolvedPath,
      weight: font.weight,
      style: font.style,
    };
    registered.set(resolvedPath, record);
    accepted.push(record);
  }

  return { fonts: accepted, errors, warnings };
}

export function describeRegisteredFonts(): { count: number; families: readonly string[] } {
  const fonts = getRegisteredProjectFonts();
  return { count: fonts.length, families: fonts.map((font) => font.family) };
}
