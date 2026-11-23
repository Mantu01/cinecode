import { rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createError, ErrorCode } from "../errors/codes.js";
import type { VideoEncoder, EncoderResult } from "../encoder/index.js";
import type { FrameSink } from "./strategy-sinks.js";
import type { ProgressReporter } from "./progress.js";

export async function executeTwoPassEncoding(params: {
  readonly twoPass: boolean;
  readonly passLogFile?: string;
  readonly cacheDir: string;
  readonly planExtension?: string;
  readonly tempVideoPath: string;
  readonly outputPath: string;
  readonly createVideoSink: (targetPath: string, pass?: 1 | 2, passLogFile?: string) => Promise<VideoEncoder>;
  readonly runFrameProducer: (sink: FrameSink, isPass2?: boolean) => Promise<EncoderResult>;
  readonly reporter: ProgressReporter;
}): Promise<{ videoEncoder: VideoEncoder; videoResult: EncoderResult }> {
  const {
    twoPass,
    passLogFile,
    cacheDir,
    planExtension,
    tempVideoPath,
    outputPath,
    createVideoSink,
    runFrameProducer,
    reporter,
  } = params;

  let videoEncoder: VideoEncoder;
  let videoResult: EncoderResult;

  if (twoPass && passLogFile) {
    const analysisPath = join(cacheDir, `two-pass-analysis-${randomUUID().slice(0, 8)}${planExtension || ".mp4"}`);
    const pass1Encoder = await createVideoSink(analysisPath, 1, passLogFile);
    const pass1Result = await runFrameProducer(pass1Encoder);
    await rm(analysisPath, { force: true });
    if (!pass1Result.success) {
      throw createError(ErrorCode.CC4002, { details: pass1Result.error ?? "Two-pass analysis failed" });
    }
    reporter.setStage("encoding");
    videoEncoder = await createVideoSink(tempVideoPath, 2, passLogFile);
    videoResult = await runFrameProducer(videoEncoder, true);
    await Promise.all([
      rm(`${passLogFile}-0.log`, { force: true }),
      rm(`${passLogFile}-0.log.mbtree`, { force: true }),
    ]).catch(() => undefined);
    if (!videoResult.success) {
      throw createError(ErrorCode.CC4002, { details: videoResult.error ?? "Two-pass encoding failed" }, { location: { file: outputPath } });
    }
  } else {
    videoEncoder = await createVideoSink(tempVideoPath);
    videoResult = await runFrameProducer(videoEncoder);
    if (!videoResult.success) {
      throw createError(ErrorCode.CC4002, { details: videoResult.error ?? "Video encoding failed" });
    }
  }

  return { videoEncoder, videoResult };
}
