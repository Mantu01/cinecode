export { normalizeChapters, buildChapterMetadata, type Chapter } from "./metadata.js";
export { embedChaptersIntoVideo, type EmbedChaptersOptions } from "./embed.js";
export {
  generateChaptersFromTranscript, chaptersFromSubtitles, splitIntoChaptersByDuration,
  type TranscriptLine,
} from "./generate.js";
