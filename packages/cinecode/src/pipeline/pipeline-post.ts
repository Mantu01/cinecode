import { copyFile, rename, rm } from "node:fs/promises";
import { extname } from "node:path";
import { withAtomicOutput } from "../encoder/output.js";
import { embedChaptersIntoVideo } from "../encoder/chapters/index.js";
import { muxAudioVideo, type MuxerOptions } from "../audio/muxer.js";
import { recordWarning } from "../errors/degradations.js";
import { ErrorCode } from "../errors/codes.js";
import type { Composition } from "../core/types/index.js";
import type { ProgressReporter } from "./progress.js";
import { muxError, verifyMuxedOutput } from "./pipeline-audio.js";

export async function stageAndMuxOutput(params: {
  readonly outputPath: string;
  readonly tempVideoPath: string;
  readonly muxAudio: boolean;
  readonly muxOptions: MuxerOptions | null;
  readonly duration: number;
  readonly composition: Composition;
  readonly muxPlan: import("../audio/muxer.js").MuxAudioPlan | null;
  readonly silentMix: boolean;
  readonly reporter: ProgressReporter;
}): Promise<void> {
  const {
    outputPath,
    tempVideoPath,
    muxAudio,
    muxOptions,
    duration,
    composition,
    muxPlan,
    silentMix,
    reporter,
  } = params;

  if (muxAudio) reporter.reportMuxing();
  await withAtomicOutput(outputPath, async (stagedOutput) => {
    if (!muxAudio || !muxOptions) {
      await copyFile(tempVideoPath, stagedOutput);
      await verifyMuxedOutput(stagedOutput, {
        audio: false,
        nonSilent: false,
        duration,
        outputPath,
        width: composition.width,
        height: composition.height,
      });
      return;
    }
    const muxResult = await muxAudioVideo({
      ...muxOptions,
      outputPath: stagedOutput,
      overwrite: true,
    });
    if (!muxResult.success) throw muxError(muxResult.error, outputPath);
    if (muxResult.adjustment !== "none") {
      recordWarning({
        code: ErrorCode.CC4005,
        message: `audio bed ${muxResult.adjustment === "padded" ? "padded with silence" : "trimmed"} to the ${duration.toFixed(3)}s video duration`,
        input: outputPath,
      });
    }
    await verifyMuxedOutput(stagedOutput, {
      audio: true,
      nonSilent: !silentMix,
      codec: muxPlan?.ffmpegCodec,
      duration,
      outputPath,
      width: composition.width,
      height: composition.height,
    });
  });
}

export async function processChaptersAndThumbnail(params: {
  readonly composition: Composition;
  readonly processedComposition: Composition;
  readonly outputPath: string;
  readonly cacheDir: string;
  readonly duration: number;
  readonly seed: number;
  readonly format: string;
  readonly generateThumbnailOption?: boolean | { readonly outputPath?: string; readonly formats?: readonly ("png" | "jpg" | "webp")[] };
  readonly reporter: ProgressReporter;
}): Promise<void> {
  const {
    composition,
    processedComposition,
    outputPath,
    cacheDir,
    duration,
    seed,
    format,
    generateThumbnailOption,
    reporter,
  } = params;

  if (composition.chapters && composition.chapters.length > 0) {
    const chapterPath = `${outputPath}.with-chapters${extname(outputPath)}`;
    const embedded = await embedChaptersIntoVideo({
      videoPath: outputPath,
      chapters: composition.chapters,
      outputPath: chapterPath,
      tempDir: cacheDir,
      duration,
    });
    if (embedded) {
      await rename(chapterPath, outputPath).catch(async () => {
        await rm(outputPath, { force: true });
        await rename(chapterPath, outputPath);
      });
    } else {
      await rm(chapterPath, { force: true });
      reporter.reportDegradation(
        "[CC8002] chapter metadata could not be embedded — the video is still valid",
        { code: ErrorCode.CC8002, what: "chapter metadata", input: outputPath, instead: "video written without chapters" },
      );
    }
  }

  if (generateThumbnailOption && (format === "mp4" || format === "webm")) {
    const config = generateThumbnailOption === true ? {} : generateThumbnailOption;
    const { generateThumbnail } = await import("../encoder/thumbnail/index.js");
    const thumbPath = config.outputPath ?? outputPath.replace(/\.[a-z0-9]+$/i, ".thumb.png");
    await generateThumbnail(processedComposition, thumbPath, {
      formats: config.formats ?? ["png"],
      seed,
    }).catch((error: unknown) => {
      reporter.reportDegradation(
        `[CC8003] thumbnail generation failed: ${error instanceof Error ? error.message : String(error)}`,
        { code: ErrorCode.CC8003, what: "thumbnail generation", input: thumbPath, instead: "video written without a thumbnail" },
      );
    });
  }
}
