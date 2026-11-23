import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pc } from "../output/palette.js";
import { loadCinecodeIgnore } from "../../config/ignore.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";
import { loadProjectContext } from "../resolve/project-context.js";

export interface PublishOptions {
  dest?: string;
  root?: string;
  config?: string;
  allowOutside?: boolean;
  tag?: string;
}

export interface PublishResult {
  success: boolean;
  target: string;
  contentType?: string;
  message: string;
}

const MIME_MAP: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

export function detectContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

function respectIgnore(projectDir: string, relativePath: string): boolean {
  return loadCinecodeIgnore(projectDir).shouldIgnore(relativePath);
}

export async function publishOutput(
  outputPath: string,
  options: PublishOptions = {},
  projectRoot?: string,
  outputRoot?: string,
): Promise<PublishResult> {
  const root = path.resolve(projectRoot ?? ".");
  const resolvedOutput = path.resolve(root, outputPath);
  if (!fs.existsSync(resolvedOutput)) {
    return { success: false, target: resolvedOutput, message: `Output file not found: ${resolvedOutput}` };
  }
  const relativeOutput = path.relative(root, resolvedOutput).replace(/\\/g, "/");
  if (respectIgnore(root, relativeOutput)) {
    return { success: false, target: resolvedOutput, message: "Output matches .cinecodeignore patterns — publish refused" };
  }

  const configPath = path.join(root, ".cinecode-publish.json");
  let destination = options.dest;
  if (!destination && fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { destination?: string };
      destination = config.destination;
    } catch {
      // Note: ignore missing .cinecode-publish.json
    }
  }
  if (!destination) {
    return { success: false, target: outputPath, message: "Local publish needs --dest or .cinecode-publish.json {\"destination\": \"...\"}" };
  }

  const targetDir = path.resolve(root, destination);
  const insideProject = isInside(root, targetDir);
  if (!insideProject && options.allowOutside !== true) {
    return { success: false, target: targetDir, message: `Destination '${targetDir}' is outside project root '${root}'. Pass --allow-outside to permit it.` };
  }
  const sourceDir = path.resolve(root, "src");
  const outputDir = path.resolve(outputRoot ?? path.join(root, "output"));
  if (isInside(sourceDir, targetDir) || targetDir === sourceDir) {
    return { success: false, target: targetDir, message: `Local destination is inside source tree: source=${sourceDir}, destination=${targetDir}` };
  }
  if (isInside(outputDir, targetDir) || targetDir === outputDir) {
    return { success: false, target: targetDir, message: `Local destination is the render output directory: ${outputDir}` };
  }
  const finalDir = options.tag ? path.join(targetDir, options.tag) : targetDir;
  fs.mkdirSync(finalDir, { recursive: true });
  const target = path.join(finalDir, path.basename(resolvedOutput));
  const contentType = detectContentType(target);

  const tempPath = `${target}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    fs.copyFileSync(resolvedOutput, tempPath);
    const handle = fs.openSync(tempPath, "r+");
    try { fs.fsyncSync(handle); } catch { /* Note: fsync may be unsupported on this filesystem */ } finally { fs.closeSync(handle); }
    try {
      fs.renameSync(tempPath, target);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "EXDEV" && code !== "EACCES" && code !== "EPERM") throw error;
      fs.copyFileSync(tempPath, target);
      const copied = fs.statSync(target).size;
      if (copied !== fs.statSync(tempPath).size) throw new Error(`cross-volume copy size mismatch for ${target}`);
      fs.unlinkSync(tempPath);
    }
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch { /* Note: ignore temp file unlink error on failure */ }
    return { success: false, target, message: `Failed atomic write: ${String(err)}` };
  }

  return { success: true, target, contentType, message: `Published output to ${target} (${contentType})` };
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function publishCommand(
  outputPath: string,
  options: PublishOptions = {},
  preflight?: import("../gate/preflight.js").PreflightContext,
): Promise<void> {
  if (!runReport.isMachine()) runReport.diagnostic(`Publishing '${outputPath}' locally...`);
  const context = preflight?.resolution?.context ?? await loadProjectContext({ root: options.root, config: options.config, allowStandalone: true });
  const result = await publishOutput(outputPath, options, context.root, context.roots.output);
  runReport.result({ success: result.success, target: result.target, message: result.message });
  if (result.success) {
    runReport.artifact({ kind: "published", path: result.target, units: 1, unit: "file" });
    if (!runReport.isMachine()) {
      runReport.diagnostic(pc.green(`✔ ${result.message}`));
      runReport.diagnostic(pc.cyan(result.target));
    }
  } else {
    const resolved = path.resolve(context.root, outputPath);
    if (!fs.existsSync(resolved)) {
      throw createError(ErrorCode.CC2001, { path: resolved }, { location: { file: resolved } });
    }
    throw createError(ErrorCode.CC6009, { target: result.target, reason: result.message });
  }
}

