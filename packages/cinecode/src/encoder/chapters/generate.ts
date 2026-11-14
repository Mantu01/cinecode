import type { ChapterMarker } from "../../core/types/composition.js";
import type { SubtitleEntry } from "../../subtitles/parser.js";

export interface TranscriptLine {
  readonly start: number;
  readonly end?: number;
  readonly text: string;
}

/** Turns caption cues into chapter titles, one chapter per cue. */
export function generateChaptersFromTranscript(lines: readonly TranscriptLine[]): ChapterMarker[] {
  return lines
    .filter((line) => line.text.trim().length > 0)
    .map((line) => ({
      time: Math.max(0, line.start),
      title: line.text.trim().replace(/\s+/g, " ").slice(0, 80),
    }))
    .sort((left, right) => left.time - right.time);
}

export function chaptersFromSubtitles(entries: readonly SubtitleEntry[]): ChapterMarker[] {
  return generateChaptersFromTranscript(entries.map((entry) => ({
    start: entry.startTime,
    end: entry.endTime,
    text: entry.text,
  })));
}

/** Splits a timeline into evenly spaced chapters with minute-based titles. */
export function splitIntoChaptersByDuration(
  duration: number,
  minutesPerChapter = 5,
  titlePrefix = "Part",
): ChapterMarker[] {
  const interval = Math.max(0.1, minutesPerChapter * 60);
  const chapters: ChapterMarker[] = [];
  let index = 1;
  for (let time = 0; time < duration; time += interval) {
    chapters.push({
      time,
      title: index === 1 ? "Intro" : `${titlePrefix} ${index}`,
    });
    index += 1;
  }
  return chapters;
}
