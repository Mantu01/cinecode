import { Command } from "commander";
import { getPreset, listPresetIds, listPresets } from "../../encoder/platform-presets.js";
import { createError, ErrorCode } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";

export async function presetsCommand(name?: string, _options: Record<string, unknown> = {}): Promise<void> {
  const machine = runReport.isMachine();
  if (name && typeof name === "string") {
    const preset = getPreset(name);
    if (!preset) {
      throw createError(ErrorCode.CC1014, { kind: "platform preset", name, available: listPresetIds().join(", ") });
    }
    if (machine) {
      runReport.result({ ...preset });
      return;
    }
    const limit = preset.maxFileSizeMB ? `${preset.maxFileSizeMB} MB` : "none";
    runReport.diagnostic(`${preset.label} (${preset.id})`);
    runReport.diagnostic(`  ${preset.description}`);
    runReport.diagnostic(`  format:   ${preset.format} / ${preset.video.codec}`);
    runReport.diagnostic(`  quality:  crf ${preset.video.crf}, encoder preset ${preset.video.encoderPreset}`);
    runReport.diagnostic(`  size:     ${preset.width}x${preset.height} @ ${preset.fps} fps`);
    runReport.diagnostic(`  aspect:   ${preset.aspectRatio}`);
    runReport.diagnostic(`  audio:    ${preset.audio.codec} ${preset.audio.bitrateKbps} kbps`);
    runReport.diagnostic(`  file cap: ${limit}`);
    return;
  }

  const presets = listPresets();
  if (machine) {
    runReport.result({ presets });
    return;
  }
  runReport.diagnostic("Platform presets\n");
  for (const preset of presets) {
    const cap = preset.maxFileSizeMB ? `, <${preset.maxFileSizeMB} MB` : "";
    runReport.diagnostic(
      `  ${preset.id.padEnd(24)} ${preset.width}x${preset.height}@${preset.fps} ${preset.format}/${preset.video.codec} CRF ${preset.video.crf}${cap}`,
    );
  }
  runReport.diagnostic('\nUse `render.platformPreset: "<id>"` in cinecode.config.ts or --preset <id>.');
}

