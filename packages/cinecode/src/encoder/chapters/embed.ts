import { spawn } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import ffmpegStatic from "@ffmpeg-installer/ffmpeg";
import type { ChapterMarker } from "../../core/types/composition.js";
import { buildChapterMetadata, normalizeChapters } from "./metadata.js";

export interface EmbedChaptersOptions {
  readonly videoPath: string;
  readonly chapters: readonly ChapterMarker[];
  readonly outputPath: string;
  readonly tempDir: string;
  readonly duration: number;
}

function runFfmpeg(args: readonly string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegStatic.path, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ code: 1, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/** Remuxes chapters into an existing video without re-encoding any stream. */
export async function embedChaptersIntoVideo(options: EmbedChaptersOptions): Promise<boolean> {
  const chapters = normalizeChapters(options.chapters, options.duration);
  if (chapters.length === 0) return false;

  const metadataPath = join(options.tempDir, `chapters-${Date.now()}.txt`);
  try {
    await writeFile(metadataPath, buildChapterMetadata(chapters, options.duration), "utf-8");
    const { code, stderr } = await runFfmpeg([
      "-v", "error", "-y",
      "-i", options.videoPath,
      "-i", metadataPath,
      "-map_metadata", "1",
      "-map_chapters", "1",
      "-c", "copy",
      options.outputPath,
    ]);
    if (code !== 0) {
      if (stderr) process.stderr.write(`[CC8002] chapter embedding failed: ${stderr}\n`);
      return false;
    }
    return true;
  } catch (error) {
    process.stderr.write(`[CC8002] chapter embedding failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return false;
  } finally {
    await rm(metadataPath, { force: true }).catch(() => undefined);
  }
}
