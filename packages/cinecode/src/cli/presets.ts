import { Command } from "commander";
import { getPreset, listPresetIds, listPresets } from "../encoder/platform-presets.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";

export function createPresetsCommand(): Command {
  return new Command("presets")
    .description("List platform deliverable presets (YouTube, TikTok, Instagram, X)")
    .argument("[name]", "show details for a single preset")
    .action((name: string | undefined) => {
      const machine = runReport.isMachine();
      if (name) {
        const preset = getPreset(name);
        if (!preset) {
          throw createError(ErrorCode.CC1014, { kind: "platform preset", name, available: listPresetIds().join(", ") });
        }
        if (machine) {
          runReport.result({ ...preset });
          return;
        }
        const limit = preset.maxFileSizeMB ? `${preset.maxFileSizeMB} MB` : "none";
        console.log(`${preset.label} (${preset.id})`);
        console.log(`  ${preset.description}`);
        console.log(`  format:   ${preset.format} / ${preset.video.codec}`);
        console.log(`  quality:  crf ${preset.video.crf}, encoder preset ${preset.video.encoderPreset}`);
        console.log(`  size:     ${preset.width}x${preset.height} @ ${preset.fps} fps`);
        console.log(`  aspect:   ${preset.aspectRatio}`);
        console.log(`  audio:    ${preset.audio.codec} ${preset.audio.bitrateKbps} kbps`);
        console.log(`  file cap: ${limit}`);
        return;
      }

      const presets = listPresets();
      if (machine) {
        runReport.result({ presets });
        return;
      }
      console.log("Platform presets\n");
      for (const preset of presets) {
        const cap = preset.maxFileSizeMB ? `, <${preset.maxFileSizeMB} MB` : "";
        console.log(
          `  ${preset.id.padEnd(24)} ${preset.width}x${preset.height}@${preset.fps} ${preset.format}/${preset.video.codec} CRF ${preset.video.crf}${cap}`,
        );
      }
      console.log('\nUse `render.platformPreset: "<id>"` in cinecode.config.ts or --preset <id>.');
    });
}
