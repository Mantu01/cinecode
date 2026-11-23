import type { Composition } from "../core/types/index.js";
import { preprocessVideo } from "../media/preprocess.js";
import { createCheckpointManager, type CheckpointManager } from "./recovery.js";
import type { ProgressReporter } from "./progress.js";

export async function preprocessCompositionMedia(
  composition: Composition,
  cacheDir: string,
  burnSubtitles?: boolean,
): Promise<Composition> {
  const preprocessedVideos = new Map<string, string>();
  for (const track of composition.rootTimeline.tracks) {
    if (track.kind !== "visual") continue;
    for (const clip of track.clips) {
      if (clip.type !== "video" || !clip.preprocess) continue;
      const src = clip.src;
      if (preprocessedVideos.has(src)) continue;
      const processedPath = await preprocessVideo(src, clip.preprocess, cacheDir);
      preprocessedVideos.set(src, processedPath);
    }
  }

  let processedComposition = composition;
  if (preprocessedVideos.size > 0) {
    processedComposition = {
      ...composition,
      rootTimeline: {
        ...composition.rootTimeline,
        tracks: composition.rootTimeline.tracks.map((track) => {
          if (track.kind !== "visual") return track;
          return {
            ...track,
            clips: track.clips.map((clip) => {
              if (clip.type !== "video" || !clip.preprocess) return clip;
              const processedSrc = preprocessedVideos.get(clip.src);
              if (!processedSrc) return clip;
              const { preprocess, ...rest } = clip;
              return { ...rest, src: processedSrc };
            }),
          };
        }),
      },
    };
  }

  if (burnSubtitles === false) {
    processedComposition = { ...processedComposition, burnSubtitles: false };
  }
  const { preloadSubtitlesForRender } = await import("../encoder/subtitle-burn.js");
  await preloadSubtitlesForRender(processedComposition);

  return processedComposition;
}

export async function setupCheckpointResume(params: {
  readonly cacheDir: string;
  readonly compositionId: string;
  readonly compositionHash: string;
  readonly totalFrames: number;
  readonly fromFrame: number;
  readonly toFrame?: number;
  readonly checkpointInterval?: number;
  readonly resume?: boolean;
  readonly fresh?: boolean;
  readonly silent: boolean;
  readonly reporter: ProgressReporter;
}): Promise<{ checkpointManager: CheckpointManager; resumedFrames: Set<number> }> {
  const {
    cacheDir,
    compositionId,
    compositionHash,
    totalFrames,
    fromFrame,
    toFrame,
    checkpointInterval,
    resume,
    fresh,
    silent,
    reporter,
  } = params;

  const checkpointManager = createCheckpointManager({
    cacheDir,
    compositionId,
    compositionHash,
    totalFrames,
    from: fromFrame,
    to: toFrame,
    checkpointInterval,
  });
  await checkpointManager.initialize();
  const resumedFrames = new Set<number>();
  if (resume === true && !fresh) {
    const checkpoint = await checkpointManager.findLatestCheckpoint();
    if (checkpoint) {
      for (const frameIndex of checkpointManager.getCompletedFrames()) resumedFrames.add(frameIndex);
      if (!silent) {
        const missingFrames = totalFrames - resumedFrames.size;
        reporter.reportWarning(
          `[CC4002] resuming session ${checkpoint.renderSessionId}: ${resumedFrames.size}/${totalFrames} frame(s) completed, ${missingFrames} frame(s) missing`,
        );
      }
    }
  }

  return { checkpointManager, resumedFrames };
}
