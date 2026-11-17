import { Command } from "commander";
import { listPlatformPresets, resolvePlatformPreset } from "../encoder/presets.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";

export function createPresetsCommand(): Command {
  return new Command("presets")
    .description("List platform deliverable presets (YouTube, TikTok, Instagram, X)")
    .argument("[name]", "show details for a single preset")
    .action((name: string | undefined, options: { json?: boolean }) => {
      if (name) {
        const preset = resolvePlatformPreset(name as never);
        if (!preset) throw createError(ErrorCode.CC1011, { name });
        if (options.json) {
          runReport.result({ ...preset });
          return;
        }
        const limit = preset.maxFileSizeMB ? `${preset.maxFileSizeMB} MB` : "none";
        console.log(`${preset.label} (${preset.name})`);
        console.log(`  ${preset.description}`);
        console.log(`  format:   ${preset.format} / ${preset.codec}`);
        console.log(`  quality:  crf ${preset.crf}, preset ${preset.preset}`);
        console.log(`  max size: ${preset.maxWidth ?? "auto"}x${preset.maxHeight ?? "auto"}`);
        console.log(`  aspect:   ${preset.recommendedAspect}`);
        console.log(`  audio:    ${preset.audioCodec} ${preset.audioBitrateKbps} kbps`);
        console.log(`  file cap: ${limit}`);
        return;
      }

      const presets = listPlatformPresets();
      if (options.json) {
        runReport.result({ presets });
        return;
      }
      console.log("Platform presets\n");
      for (const preset of presets) {
        const size = preset.maxWidth ? `${preset.maxWidth}x${preset.maxHeight}` : "source";
        const cap = preset.maxFileSizeMB ? `, <${preset.maxFileSizeMB} MB` : "";
        console.log(`  ${preset.name.padEnd(18)} ${preset.codec} ${size} ${preset.recommendedAspect}${cap}`);
      }
      console.log('\nUse `render.platformPreset: "<name>"` in cinecode.config.ts.');
    });
}
