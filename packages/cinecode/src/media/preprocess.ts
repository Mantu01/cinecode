import { spawn } from "node:child_process";
import { resolveBinary } from "../binary/resolver.js";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdir, rm, stat } from "node:fs/promises";
import type { VideoEditOptions } from "../core/types/clips.js";

export type { VideoEditOptions };

export async function preprocessVideo(
  src: string,
  options: VideoEditOptions,
  cacheDir: string,
): Promise<string> {
  const filters: string[] = [];

  if (options.trimStart !== undefined || options.trimEnd !== undefined) {
    const start = options.trimStart ?? 0;
    const end = options.trimEnd ?? Infinity;
    filters.push(`trim=start=${start}:end=${end}`);
    filters.push("setpts=PTS/STARTPTS");
  }

  if (options.speed && options.speed !== 1) {
    filters.push(`setpts=${1 / options.speed}*PTS`);
  }

  if (options.crop) {
    const { x, y, width, height } = options.crop;
    filters.push(`crop=${width}:${height}:${x}:${y}`);
  }

  if (options.mirror === "horizontal") {
    filters.push("hflip");
  } else if (options.mirror === "vertical") {
    filters.push("vflip");
  }

  if (options.fadeDuration && options.fadeDuration > 0) {
    filters.push(`fade=t=in:st=0:d=${options.fadeDuration}`);
    filters.push(`fade=t=out:st=END-${options.fadeDuration}:d=${options.fadeDuration}`);
  }

  const filtergraph = filters.join(",");
  const cacheKey = createHash("sha256")
    .update(src + filtergraph + JSON.stringify(options))
    .digest("hex")
    .slice(0, 16);

  const cachePath = join(cacheDir, "preprocessed", `${cacheKey}.mp4`);

  try {
    await stat(cachePath);
    return cachePath;
  } catch {
    await mkdir(join(cacheDir, "preprocessed"), { recursive: true });

    return new Promise((resolve, reject) => {
      const args = [
        "-v", "error",
        "-i", src,
        ...(filtergraph ? ["-vf", filtergraph] : []),
        "-c:v", "libx264",
        "-crf", "18",
        "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        cachePath,
      ];

      const child = spawn(resolveBinary("ffmpeg").path, args, { windowsHide: true });
      child.on("close", (code) => {
        if (code === 0) resolve(cachePath);
        else reject(new Error(`FFmpeg preprocess failed: ${code}`));
      });
      child.on("error", reject);
    });
  }
}
