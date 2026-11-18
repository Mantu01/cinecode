import { parentPort, workerData } from "node:worker_threads";
import { Canvas } from "@napi-rs/canvas";
import { describeRegisteredFonts, registerProjectFonts } from "../fonts.js";
import type { FontEntry } from "../../../core/types/index.js";

const input = workerData as {
  fonts: readonly FontEntry[];
  projectRoot: string;
  mediaDir: string;
  family: string;
};

const result = registerProjectFonts(input.fonts, {
  projectRoot: input.projectRoot,
  mediaDir: input.mediaDir,
});
const ctx = new Canvas(8, 8).getContext("2d");
ctx.font = `16px "${input.family}"`;
const width = ctx.measureText("Hello World").width;

parentPort!.postMessage({
  errors: result.errors.length,
  width,
  registered: describeRegisteredFonts(),
});
