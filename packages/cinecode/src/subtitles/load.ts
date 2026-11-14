import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseSrt, parseVtt } from "./parser.js";
import type { SubtitleEntry } from "./parser.js";

export type SubtitleFormat = "srt" | "vtt";

export function detectSubtitleFormat(filePath: string): SubtitleFormat {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".vtt") return "vtt";
  return "srt";
}

export function parseSubtitleText(text: string, format: SubtitleFormat): SubtitleEntry[] {
  return format === "vtt" ? parseVtt(text) : parseSrt(text);
}

export async function loadSubtitles(filePath: string): Promise<SubtitleEntry[]> {
  const raw = await readFile(filePath, "utf-8");
  return parseSubtitleText(raw, detectSubtitleFormat(filePath));
}
