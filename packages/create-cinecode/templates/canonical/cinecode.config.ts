import { defineConfig } from "cinecode";

const WIDTH = {{WIDTH}};
const HEIGHT = {{HEIGHT}};
const FPS = {{FPS}};

const BACKGROUND = "#0a0a0a";

/**
 * Global project configuration.
 *
 * Video quality is fully controlled here — the renderer never silently
 * downgrades a render. Bump `render.quality` to "lossless" (or set an explicit
 * `render.crf: 0`) for a pristine master.
 */
export default defineConfig({
  schemaVersion: 2,

  project: {
    entry: "./main.{{EXT}}",
    sourceDir: "./src",
    mediaDir: "./media",
    outputDir: "./output",
    cacheDir: ".cinecode/cache",
  },

  video: {
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    background: BACKGROUND,
  },

  render: {
    format: "mp4",
    // draft | preview | medium | final | lossless
    quality: "final",
    // h264 | h265 | av1 | prores | vp9
    codec: "h264",
    // 0 = lossless. Leave undefined to use the quality profile's CRF.
    // crf: 0,
    preset: "slow",
    hardwareAcceleration: "off",
    concurrency: "auto",
    chunkSize: 50,
  },

  images: {
    defaultFormat: "png",
    quality: 90,
    scaleFactor: 1,
  },

  audio: {
    sampleRate: 48000,
    channels: 2,
    masterVolume: 1,
  },

  dev: {
    port: 3000,
    host: "127.0.0.1",
    hmr: true,
    open: false,
  },
});
