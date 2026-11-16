import fs from "node:fs";
import path from "node:path";
import type { CinecodeConfig } from "../core/types/index.js";
import { defineConfig as coreDefineConfig } from "../core/define/definitions.js";

export function defineConfig(config: CinecodeConfig): CinecodeConfig {
  return coreDefineConfig(config);
}

export interface ScaffoldConfigOptions {
  name?: string;
  preset?: "youtube-1080p" | "youtube-4k" | "tiktok-9-16" | "square" | "cinematic";
  fps?: number;
  typescript?: boolean;
}

export function scaffoldConfigFile(targetDir: string, options: ScaffoldConfigOptions = {}): string {
  const isTs = options.typescript !== false;
  const fileName = isTs ? "cinecode.config.ts" : "cinecode.config.js";
  const filePath = path.resolve(targetDir, fileName);

  let width = 1920;
  let height = 1080;
  let fps = options.fps ?? 30;

  if (options.preset === "youtube-4k" || options.preset === "cinematic") {
    width = 3840;
    height = 2160;
    if (options.preset === "cinematic") fps = 24;
  } else if (options.preset === "tiktok-9-16") {
    width = 1080;
    height = 1920;
    fps = 60;
  } else if (options.preset === "square") {
    width = 1080;
    height = 1080;
  }

  const name = options.name ?? "my-cinecode-video";

  const content = isTs
    ? `import { defineConfig } from "cinecode";

export default defineConfig({
  schemaVersion: 1,
  project: {
    name: "${name}",
    entry: "./src/main.ts",
  },
  video: {
    title: "${name}",
    width: ${width},
    height: ${height},
    fps: ${fps},
    background: "#000000",
  },
  render: {
    quality: "final",
    format: "mp4",
    codec: "h264",
  },
});
`
    : `/// <reference types="cinecode" />
import { defineConfig } from "cinecode";

export default defineConfig({
  schemaVersion: 1,
  project: {
    name: "${name}",
    entry: "./src/main.js",
  },
  video: {
    title: "${name}",
    width: ${width},
    height: ${height},
    fps: ${fps},
    background: "#000000",
  },
  render: {
    quality: "final",
    format: "mp4",
    codec: "h264",
  },
});
`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}
