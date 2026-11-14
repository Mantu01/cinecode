import type { ChapterMarker } from "../../core/types/composition.js";

export interface Chapter {
  readonly time: number;
  readonly title: string;
  readonly end?: number;
}

export function normalizeChapters(chapters: readonly ChapterMarker[], duration?: number): Chapter[] {
  const sorted = [...chapters]
    .filter((chapter) => Number.isFinite(chapter.time) && chapter.time >= 0)
    .sort((left, right) => left.time - right.time)
    .map((chapter) => ({ time: chapter.time, title: chapter.title.trim() || "Chapter" }));

  if (sorted.length === 0) return [];
  const normalized = sorted[0]!.time === 0
    ? sorted
    : [{ time: 0, title: "Intro" } as Chapter, ...sorted];

  return normalized.map((chapter, index) => {
    const next = normalized[index + 1];
    const end = next ? next.time : duration;
    return end !== undefined ? { ...chapter, end: Math.max(chapter.time + 0.001, end) } : chapter;
  });
}

/** Builds the FFmetadata document ffmpeg uses for chapters across MP4 and WebM. */
export function buildChapterMetadata(chapters: readonly Chapter[], duration: number): string {
  const lines = [";FFMETADATA1"];
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index]!;
    const next = chapters[index + 1];
    const start = Math.round(chapter.time * 1000);
    const end = Math.round((next ? next.time : duration) * 1000);
    lines.push("[CHAPTER]");
    lines.push("TIMEBASE=1/1000");
    lines.push(`START=${start}`);
    lines.push(`END=${Math.max(start + 1, end)}`);
    lines.push(`title=${escapeMetadata(chapter.title)}`);
  }
  return `${lines.join("\n")}\n`;
}

function escapeMetadata(value: string): string {
  return value.replace(/([=;#\\\n])/g, "\\$1");
}
