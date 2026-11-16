import { Command } from "commander";
import { CINECODE_VERSION } from "../version.js";
import { createStillCommand } from "./still.js";
import { createMediaListCommand } from "./media-list.js";
import { createRenderCommand } from "./render.js";
import { createPreviewCommand } from "./preview.js";
import { createValidateCommand } from "./validate.js";
import { createCheckCommand } from "./check.js";
import { createDoctorCommand } from "./doctor.js";
import { createInspectCommand } from "./inspect.js";
import { createCleanCommand } from "./clean.js";
import { createMediaDownloadCommand } from "./media-download.js";
import { createCreateCommand } from "./create.js";
import { createGenerateCommand } from "./generate.js";
import { createDevCommand } from "./dev.js";
import { createCanvasCommand } from "./canvas.js";
import { createPresetsCommand } from "./presets.js";
import { createThumbnailCommand } from "./thumbnail.js";
import { createMultiResCommand } from "./multi-res.js";
import { createEditCommand } from "./edit.js";
import { createSyncCommand } from "./sync.js";
import { createCompareCommand } from "./compare.js";
import { createBenchmarkCommand } from "./benchmark.js";
import { createUpgradeCommand } from "./upgrade.js";
import { createTemplateCommand } from "./template.js";
import { createHealthCommand } from "./health.js";
import { createTtsCommand } from "./tts.js";
import { createPluginCommand } from "./plugin.js";
import { createTelemetryCommand } from "./telemetry.js";
import { createDiffCommand } from "./diff.js";
import { createStoryCommand } from "./story.js";
import { createExportSvgCommand } from "./export-svg.js";
import { createAuditCommand } from "./audit.js";
import { createAliasCommand } from "./alias.js";
import { createInitCommand } from "./wizard.js";
import { createMigrateCommand } from "./migrate.js";
import { createCheckIgnoreCommand } from "./check-ignore.js";
import { createPublishCommand } from "./publish.js";
import { createProbeCommand } from "./uptime-probe.js";
import { expandCliArgs } from "./profiles.js";
import { setJsonMode } from "../observability/logger.js";
import { checkRuntime, formatUnsupportedRuntime } from "../loader/index.js";

const runtime = checkRuntime();
if (!runtime.supported) {
  console.error(formatUnsupportedRuntime(runtime));
  process.exit(78);
}

const program = new Command()
  .name("cinecode")
  .description("Code-first 2D animation engine and video generation framework")
  .version(CINECODE_VERSION)
  .option("--verbose", "Verbose output", false)
  .option("--no-color", "Disable colored output", false)
  .option("--json", "Emit NDJSON structured logs", false)
  .addCommand(createStillCommand())
  .addCommand(createMediaListCommand())
  .addCommand(createRenderCommand())
  .addCommand(createPreviewCommand())
  .addCommand(createValidateCommand())
  .addCommand(createCheckCommand())
  .addCommand(createDoctorCommand())
  .addCommand(createInspectCommand())
  .addCommand(createCleanCommand())
  .addCommand(createMediaDownloadCommand())
  .addCommand(createCreateCommand())
  .addCommand(createGenerateCommand())
  .addCommand(createDevCommand())
  .addCommand(createCanvasCommand())
  .addCommand(createPresetsCommand())
  .addCommand(createThumbnailCommand())
  .addCommand(createMultiResCommand())
  .addCommand(createEditCommand())
  .addCommand(createSyncCommand())
  .addCommand(createCompareCommand())
  .addCommand(createBenchmarkCommand())
  .addCommand(createUpgradeCommand())
  .addCommand(createTemplateCommand())
  .addCommand(createHealthCommand())
  .addCommand(createTtsCommand())
  .addCommand(createPluginCommand())
  .addCommand(createTelemetryCommand())
  .addCommand(createDiffCommand())
  .addCommand(createStoryCommand())
  .addCommand(createExportSvgCommand())
  .addCommand(createAuditCommand())
  .addCommand(createAliasCommand())
  .addCommand(createInitCommand())
  .addCommand(createMigrateCommand())
  .addCommand(createCheckIgnoreCommand())
  .addCommand(createPublishCommand())
  .addCommand(createProbeCommand());

program
  .command("version")
  .description("Show the Cinecode version")
  .action(() => {
    console.log(CINECODE_VERSION);
  });

program
  .command("license")
  .description("Show license information")
  .action(() => {
    console.log(
      'Cinecode is MIT licensed.\n\nCopyright (c) Cinecode contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.',
    );
  });

program.on("command:*", () => {
  const unknown = program.args[0] ?? "";
  const commands = program.commands.map((c) => c.name());
  let suggestion = "";
  let bestDist = Infinity;
  for (const cmd of commands) {
    const dist = levenshtein(unknown, cmd);
    if (dist < bestDist && dist <= 3) {
      bestDist = dist;
      suggestion = cmd;
    }
  }
  if (suggestion) {
    console.error(`Unknown command: ${unknown}\nDid you mean: ${suggestion}?`);
  } else {
    console.error(`Unknown command: ${unknown}`);
  }
  process.exit(1);
});

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = Array.from({ length: b.length + 1 }, (_, i) =>
    Array.from({ length: a.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const prevDiag = matrix[i - 1]?.[j - 1] ?? 0;
      const prevUp = matrix[i - 1]?.[j] ?? 0;
      const prevLeft = matrix[i]?.[j - 1] ?? 0;
      if (b[i - 1] === a[j - 1]) matrix[i]![j] = prevDiag;
      else matrix[i]![j] = 1 + Math.min(prevUp, prevLeft, prevDiag);
    }
  }
  return matrix[b.length]?.[a.length] ?? 0;
}

const userArgs = process.argv.slice(2);
const expandedArgs = expandCliArgs(userArgs);
const effectiveArgv = [process.argv[0] ?? "node", process.argv[1] ?? "cinecode", ...expandedArgs];

if (expandedArgs.includes("--json")) {
  setJsonMode(true);
}

program.parseAsync(effectiveArgv).catch(async (err) => {
  const { isCinecodeError } = await import("../errors/index.js");
  const { formatDiagnostic } = await import("./diagnostics.js");
  if (isCinecodeError(err)) {
    console.error(
      formatDiagnostic({
        code: err.code || "CC9999",
        message: err.message,
        fixHint: err.fixHint,
        severity: err.severity,
        noColor: program.opts().color === false,
      }),
    );
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
