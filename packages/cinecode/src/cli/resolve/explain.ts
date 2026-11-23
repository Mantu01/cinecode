import { getInstrumentationCounters } from "../../media/instrumentation.js";
import type { ExplainReport } from "./precedence-types.js";

export function formatExplainReport(explain: ExplainReport): string {
  const p = explain.parameters;
  const lines = [
    `Resolved Execution Plan:`,
    `  Project Root:     ${explain.root}`,
    `  Config:           ${explain.configPath || "none (standalone)"}`,
    `  Manifest:         ${explain.manifestPath || "none"}`,
    `  Mode:             ${explain.mode}`,
    `  Selection:        ${explain.selection}`,
    `  Frame Window:     ${p.frameWindow.value.from}..${p.frameWindow.value.to} (${p.frameWindow.value.totalFrames} frames)`,
    ``,
    `Resolved Render Parameters:`,
    `  width:            ${p.width.value} (origin: ${p.width.originLabel})`,
    `  height:           ${p.height.value} (origin: ${p.height.originLabel})`,
    `  fps:              ${p.fps.value} (origin: ${p.fps.originLabel})`,
    `  format:           ${p.format.value} (origin: ${p.format.originLabel})`,
    `  codec:            ${p.codec.value} (origin: ${p.codec.originLabel})`,
    `  quality:          ${p.quality.value} (origin: ${p.quality.originLabel})`,
    `  crf:              ${p.crf.value} (origin: ${p.crf.originLabel})`,
    `  bitrate:          ${p.bitrate.value ?? "unset"} (origin: ${p.bitrate.originLabel})`,
    `  concurrency:      ${p.concurrency.value} (origin: ${p.concurrency.originLabel})`,
    `  chunkSize:        ${p.chunkSize.value} (origin: ${p.chunkSize.originLabel})`,
    `  hardwareAccel:    ${p.hardwareAcceleration.value} (origin: ${p.hardwareAcceleration.originLabel})`,
    `  memoryBudgetMb:   ${p.memoryBudgetMb.value ?? "auto (available memory)"} (origin: ${p.memoryBudgetMb.originLabel})`,
    `  alpha:            ${p.alpha.value} (origin: ${p.alpha.originLabel})`,
    `  colorManagement:  ${typeof p.colorManagement.value === "string" ? p.colorManagement.value : JSON.stringify(p.colorManagement.value)} (origin: ${p.colorManagement.originLabel})`,
    `  twoPass:          ${p.twoPass.value} (origin: ${p.twoPass.originLabel})`,
    `  outputPath:       ${p.outputPath.value} (origin: ${p.outputPath.originLabel})`,
    `  frameWindow:      ${p.frameWindow.value.from}..${p.frameWindow.value.to} (origin: ${p.frameWindow.originLabel})`,
    `  overwrite:        ${p.overwrite.value} (origin: ${p.overwrite.originLabel})`,
    `  audioCodec:       ${p.audioCodec.value ?? "unset"} (origin: ${p.audioCodec.originLabel})`,
    `  audioBitrate:     ${p.audioBitrate.value ?? "unset"} (origin: ${p.audioBitrate.originLabel})`,
    `  gifQuality:       ${p.gifQuality.value ?? "unset"} (origin: ${p.gifQuality.originLabel})`,
    `  gifDither:        ${p.gifDither.value ?? "unset"} (origin: ${p.gifDither.originLabel})`,
    `  gifMaxFrames:     ${p.gifMaxFrames.value ?? "unlimited"} (origin: ${p.gifMaxFrames.originLabel})`,
    `  seed:             ${p.seed.value ?? "unset"} (origin: ${p.seed.originLabel})`,
    `  effects:          ${p.effects.value ? p.effects.value.join(",") : "all"} (origin: ${p.effects.originLabel})`,
    `  noEffects:        ${p.noEffects.value} (origin: ${p.noEffects.originLabel})`,
    `  strictFonts:      ${p.strictFonts.value} (origin: ${p.strictFonts.originLabel})`,
    `  frameErrorPolicy: ${p.frameErrorPolicy.value} (origin: ${p.frameErrorPolicy.originLabel})`,
  ];
  const inst = explain.instrumentation ?? getInstrumentationCounters();
  lines.push(
    ``,
    `Instrumentation:`,
    `  processSpawns:    ${inst.processSpawns}`,
    `  framesDecoded:    ${inst.framesDecoded}`,
    `  framesFromCache:  ${inst.framesFromCache}`,
    `  bytesTransferred: ${inst.bytesTransferred}`,
  );
  if (explain.resourcePlan) {
    const rp = explain.resourcePlan;
    lines.push(
      ``,
      `Resource Plan:`,
      `  totalBudget:      ${rp.summary}`,
      `  workerCount:      ${rp.workerCount}`,
      `  chunkSize:        ${rp.chunkSize}`,
      `  inProcess:        ${rp.inProcess}`,
      `  queueDepth:       ${rp.queueDepth}`,
      `  previewShare:     ${rp.previewShare} bytes`,
      `  partitions:       frames=${rp.partitions.frames}, images=${rp.partitions.images}, text=${rp.partitions.text}, media=${rp.partitions.media}`,
    );
  }
  return lines.join("\n");
}

export function describeExplainReport(explain: ExplainReport): Record<string, unknown> {
  const p = explain.parameters;
  return {
    root: explain.root,
    config: explain.configPath || null,
    manifest: explain.manifestPath || null,
    mode: explain.mode,
    selection: explain.selection,
    frameWindow: explain.frameWindow,
    instrumentation: explain.instrumentation ?? getInstrumentationCounters(),
    resourcePlan: explain.resourcePlan ?? null,
    parameters: {
      width: { value: p.width.value, origin: p.width.origin, source: p.width.source, originLabel: p.width.originLabel },
      height: { value: p.height.value, origin: p.height.origin, source: p.height.source, originLabel: p.height.originLabel },
      fps: { value: p.fps.value, origin: p.fps.origin, source: p.fps.source, originLabel: p.fps.originLabel },
      format: { value: p.format.value, origin: p.format.origin, source: p.format.source, originLabel: p.format.originLabel },
      codec: { value: p.codec.value, origin: p.codec.origin, source: p.codec.source, originLabel: p.codec.originLabel },
      quality: { value: p.quality.value, origin: p.quality.origin, source: p.quality.source, originLabel: p.quality.originLabel },
      crf: { value: p.crf.value, origin: p.crf.origin, source: p.crf.source, originLabel: p.crf.originLabel },
      bitrate: { value: p.bitrate.value ?? null, origin: p.bitrate.origin, source: p.bitrate.source, originLabel: p.bitrate.originLabel },
      concurrency: { value: p.concurrency.value, origin: p.concurrency.origin, source: p.concurrency.source, originLabel: p.concurrency.originLabel },
      chunkSize: { value: p.chunkSize.value, origin: p.chunkSize.origin, source: p.chunkSize.source, originLabel: p.chunkSize.originLabel },
      hardwareAcceleration: { value: p.hardwareAcceleration.value, origin: p.hardwareAcceleration.origin, source: p.hardwareAcceleration.source, originLabel: p.hardwareAcceleration.originLabel },
      memoryBudgetMb: { value: p.memoryBudgetMb.value ?? null, origin: p.memoryBudgetMb.origin, source: p.memoryBudgetMb.source, originLabel: p.memoryBudgetMb.originLabel },
      alpha: { value: p.alpha.value, origin: p.alpha.origin, source: p.alpha.source, originLabel: p.alpha.originLabel },
      colorManagement: { value: p.colorManagement.value, origin: p.colorManagement.origin, source: p.colorManagement.source, originLabel: p.colorManagement.originLabel },
      twoPass: { value: p.twoPass.value, origin: p.twoPass.origin, source: p.twoPass.source, originLabel: p.twoPass.originLabel },
      outputPath: { value: p.outputPath.value, origin: p.outputPath.origin, source: p.outputPath.source, originLabel: p.outputPath.originLabel },
      frameWindow: { value: p.frameWindow.value, origin: p.frameWindow.origin, source: p.frameWindow.source, originLabel: p.frameWindow.originLabel },
      overwrite: { value: p.overwrite.value, origin: p.overwrite.origin, source: p.overwrite.source, originLabel: p.overwrite.originLabel },
      audioCodec: { value: p.audioCodec.value ?? null, origin: p.audioCodec.origin, source: p.audioCodec.source, originLabel: p.audioCodec.originLabel },
      audioBitrate: { value: p.audioBitrate.value ?? null, origin: p.audioBitrate.origin, source: p.audioBitrate.source, originLabel: p.audioBitrate.originLabel },
      gifQuality: { value: p.gifQuality.value ?? null, origin: p.gifQuality.origin, source: p.gifQuality.source, originLabel: p.gifQuality.originLabel },
      gifDither: { value: p.gifDither.value ?? null, origin: p.gifDither.origin, source: p.gifDither.source, originLabel: p.gifDither.originLabel },
      gifMaxFrames: { value: p.gifMaxFrames.value ?? null, origin: p.gifMaxFrames.origin, source: p.gifMaxFrames.source, originLabel: p.gifMaxFrames.originLabel },
      seed: { value: p.seed.value ?? null, origin: p.seed.origin, source: p.seed.source, originLabel: p.seed.originLabel },
      effects: { value: p.effects.value ?? null, origin: p.effects.origin, source: p.effects.source, originLabel: p.effects.originLabel },
      noEffects: { value: p.noEffects.value, origin: p.noEffects.origin, source: p.noEffects.source, originLabel: p.noEffects.originLabel },
      strictFonts: { value: p.strictFonts.value, origin: p.strictFonts.origin, source: p.strictFonts.source, originLabel: p.strictFonts.originLabel },
      frameErrorPolicy: { value: p.frameErrorPolicy.value, origin: p.frameErrorPolicy.origin, source: p.frameErrorPolicy.source, originLabel: p.frameErrorPolicy.originLabel },
    },
  };
}
