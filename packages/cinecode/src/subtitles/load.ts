import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseAss, parseSrt, parseVtt } from "./parser.js";
import type { SubtitleEntry } from "./parser.js";

export type SubtitleFormat = "srt" | "vtt" | "ass" | "ssa";

export function detectSubtitleFormat(filePath: string): SubtitleFormat {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".vtt") return "vtt";
  if (ext === ".ass" || ext === ".ssa") return "ass";
  return "srt";
}

export function parseSubtitleText(text: string, format: SubtitleFormat): SubtitleEntry[] {
  if (format === "vtt") return parseVtt(text);
  if (format === "ass" || format === "ssa") return parseAss(text);
  return parseSrt(text);
}

export async function loadSubtitles(filePath: string): Promise<SubtitleEntry[]> {
  const raw = await readFile(filePath, "utf-8");
  return parseSubtitleText(raw, detectSubtitleFormat(filePath));
}
