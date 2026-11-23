import { defineConfig } from "cinecode";

export default defineConfig({
  schemaVersion: 2,
  project: {
    entry: "./main.js",
    sourceDir: "./src",
    mediaDir: "./media",
    outputDir: "./output",
    cacheDir: ".cinecode/cache",
  },
  video: {
    width: 1920,
    height: 1920,
    fps: 30,
    background: "#030303",
    defaultDuration: 12,
  },
  render: {
    fps: 30,
    resolution: "1920x1920",
    format: "mp4",
    quality: "final",
    codec: "h264",
    preset: "slow",
    hardwareAcceleration: "off",
    memoryBudgetMb: 2048,
  },
});