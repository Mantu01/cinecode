import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { loadCinecodeIgnore } from "../config/ignore.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";

export interface PublishOptions {
  dest?: string;
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

export async function publishOutput(outputPath: string, options: PublishOptions = {}): Promise<PublishResult> {
  if (!fs.existsSync(outputPath)) {
    return { success: false, target: outputPath, message: `Output file not found: ${outputPath}` };
  }
  const resolvedOutput = path.resolve(outputPath);
  const projectDir = path.dirname(resolvedOutput);
  if (respectIgnore(projectDir, path.basename(resolvedOutput))) {
    return { success: false, target: outputPath, message: "Output matches .cinecodeignore patterns — publish refused" };
  }

  const configPath = path.join(process.cwd(), ".cinecode-publish.json");
  let destination = options.dest;
  if (!destination && fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { destination?: string };
      destination = config.destination;
    } catch {
      // ignore
    }
  }
  if (!destination) {
    return { success: false, target: outputPath, message: "Local publish needs --dest or .cinecode-publish.json {\"destination\": \"...\"}" };
  }

  const targetDir = path.resolve(destination);
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, path.basename(outputPath));
  const contentType = detectContentType(target);

  // Atomic write via temp file in same directory + rename
  const tempPath = `${target}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    fs.copyFileSync(outputPath, tempPath);
    fs.renameSync(tempPath, target);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    return { success: false, target, message: `Failed atomic write: ${String(err)}` };
  }

  return { success: true, target, contentType, message: `Published output to ${target} (${contentType})` };
}

export function createPublishCommand(): Command {
  return new Command("publish")
    .description("Publish a rendered output locally to a destination directory")
    .argument("<outputPath>", "Rendered output file to publish")
    .option("--dest <dir>", "Local destination directory")
    .action(async (outputPath: string, options: PublishOptions) => {
      console.log(`Publishing '${outputPath}' locally...`);
      const result = await publishOutput(outputPath, options);
      runReport.result({ success: result.success, target: result.target, message: result.message });
      if (result.success) {
        runReport.artifact({ kind: "published", path: result.target, units: 1, unit: "file" });
        console.log(pc.green(`✔ ${result.message}`));
        console.log(pc.cyan(result.target));
      } else {
        if (!fs.existsSync(outputPath)) {
          throw createError(ErrorCode.CC2001, { path: path.resolve(outputPath) }, { location: { file: path.resolve(outputPath) } });
        }
        throw createError(ErrorCode.CC6002, { url: result.target, reason: result.message });
      }
    });
}
