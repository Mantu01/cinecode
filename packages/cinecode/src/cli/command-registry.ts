import type { Command } from "commander";

/** What a command leaves behind, so the summary and artifact check never guess. */
export type CommandOutcome = "none" | "artifact" | "report";

export interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  readonly example: string;
  /** What the command produces: no file, a deliverable artifact, or a report only. */
  readonly outcome: CommandOutcome;
  /** The command may reach the network when explicitly asked. */
  readonly network: boolean;
  /** The command deletes or rewrites existing files. */
  readonly destructive: boolean;
  readonly load: () => Promise<Command>;
}

export const COMMANDS: readonly CommandSpec[] = [
  { name: "still", summary: "Render a single frame to PNG or JPEG", example: "cinecode still ./composition.ts --frame 0", outcome: "artifact", network: false, destructive: false, load: async () => (await import("./still.js")).createStillCommand() },
  { name: "render", summary: "Render timelines or a composition to a video", example: "cinecode render --config ./cinecode.config.ts", outcome: "artifact", network: false, destructive: false, load: async () => (await import("./render.js")).createRenderCommand() },
  { name: "render-multi", summary: "Render one composition at multiple resolutions", example: "cinecode render-multi ./composition.ts", outcome: "artifact", network: false, destructive: false, load: async () => (await import("./multi-res.js")).createMultiResCommand() },
  { name: "preview", summary: "Start the read-only preview server and open viewer", example: "cinecode preview --config ./cinecode.config.ts", outcome: "none", network: false, destructive: false, load: async () => (await import("./preview.js")).createPreviewCommand() },
  { name: "validate", summary: "Validate configuration, compositions, media and fonts", example: "cinecode validate --config ./cinecode.config.ts", outcome: "report", network: false, destructive: false, load: async () => (await import("./validate.js")).createValidateCommand() },
  { name: "check", summary: "Validate authoring code before rendering", example: "cinecode check --config ./cinecode.config.ts", outcome: "report", network: false, destructive: false, load: async () => (await import("./check.js")).createCheckCommand() },
  { name: "doctor", summary: "Run environment and project health checks", example: "cinecode doctor --fix", outcome: "report", network: false, destructive: false, load: async () => (await import("./doctor.js")).createDoctorCommand() },
  { name: "health", summary: "Report system health for CI", example: "cinecode health --json", outcome: "report", network: false, destructive: false, load: async () => (await import("./health.js")).createHealthCommand() },
  { name: "inspect", summary: "Print the resolved timeline for a composition", example: "cinecode inspect ./composition.ts", outcome: "report", network: false, destructive: false, load: async () => (await import("./inspect.js")).createInspectCommand() },
  { name: "clean", summary: "Delete cache and output directories", example: "cinecode clean --cache", outcome: "none", network: false, destructive: true, load: async () => (await import("./clean.js")).createCleanCommand() },
  { name: "media:list", summary: "List media files in the project", example: "cinecode media:list --config ./cinecode.config.ts", outcome: "report", network: false, destructive: false, load: async () => (await import("./media-list.js")).createMediaListCommand() },
  { name: "media:download", summary: "Download cloud media into the source directory", example: "cinecode media:download --config ./cinecode.config.ts", outcome: "artifact", network: true, destructive: false, load: async () => (await import("./media-download.js")).createMediaDownloadCommand() },
  { name: "create", summary: "Scaffold a new Cinecode project", example: "cinecode create my-film", outcome: "artifact", network: false, destructive: false, load: async () => (await import("./create.js")).createCreateCommand() },
  { name: "generate", summary: "Generate images, audio, scenes or timelines", example: "cinecode generate image --all", outcome: "artifact", network: false, destructive: false, load: async () => (await import("./generate.js")).createGenerateCommand() },
  { name: "dev", summary: "Start the dev server with HMR", example: "cinecode dev --config ./cinecode.config.ts", outcome: "none", network: false, destructive: false, load: async () => (await import("./dev.js")).createDevCommand() },
  { name: "formats", summary: "List input, output and planned media formats", example: "cinecode formats --json", outcome: "report", network: false, destructive: false, load: async () => (await import("./formats.js")).createFormatsCommand() },
  { name: "presets", summary: "List platform deliverable presets", example: "cinecode presets --json", outcome: "report", network: false, destructive: false, load: async () => (await import("./presets.js")).createPresetsCommand() },
  { name: "thumbnail", summary: "Write poster images from the best frame", example: "cinecode thumbnail ./composition.ts", outcome: "artifact", network: false, destructive: false, load: async () => (await import("./thumbnail.js")).createThumbnailCommand() },
  { name: "edit", summary: "Open a composition in the editor or print it", example: "cinecode edit ./composition.ts", outcome: "report", network: false, destructive: false, load: async () => (await import("./edit.js")).createEditCommand() },
  { name: "sync", summary: "Verify media, prune cache, report orphans", example: "cinecode sync --json", outcome: "report", network: false, destructive: true, load: async () => (await import("./sync.js")).createSyncCommand() },
  { name: "compare", summary: "Pixel-diff two compositions", example: "cinecode compare ./a.ts ./b.ts", outcome: "report", network: false, destructive: false, load: async () => (await import("./compare.js")).createCompareCommand() },
  { name: "benchmark", summary: "Measure frame time, memory and worker capacity", example: "cinecode benchmark ./composition.ts", outcome: "report", network: false, destructive: false, load: async () => (await import("./benchmark.js")).createBenchmarkCommand() },
  { name: "upgrade", summary: "Compare the installed version with npm", example: "cinecode upgrade", outcome: "report", network: true, destructive: false, load: async () => (await import("./upgrade.js")).createUpgradeCommand() },
  { name: "template", summary: "List or scaffold starter compositions", example: "cinecode template list", outcome: "artifact", network: false, destructive: false, load: async () => (await import("./template.js")).createTemplateCommand() },
  { name: "tts", summary: "Text-to-speech voice utilities", example: "cinecode tts voices", outcome: "report", network: false, destructive: false, load: async () => (await import("./tts.js")).createTtsCommand() },
  { name: "plugin", summary: "Manage installed plugins", example: "cinecode plugin list", outcome: "report", network: false, destructive: false, load: async () => (await import("./plugin.js")).createPluginCommand() },
  { name: "diff", summary: "Semantic diff between compositions or revisions", example: "cinecode diff ./a.ts ./b.ts", outcome: "report", network: false, destructive: false, load: async () => (await import("./diff.js")).createDiffCommand() },
  { name: "story", summary: "Generate a standalone web player bundle", example: "cinecode story ./main.ts", outcome: "artifact", network: false, destructive: false, load: async () => (await import("./story.js")).createStoryCommand() },
  { name: "export-svg", summary: "Export frames as vector SVG graphics", example: "cinecode export-svg ./main.ts", outcome: "artifact", network: false, destructive: false, load: async () => (await import("./export-svg.js")).createExportSvgCommand() },
  { name: "audit", summary: "Scan dependencies and assets for licences", example: "cinecode audit --json", outcome: "report", network: false, destructive: false, load: async () => (await import("./audit.js")).createAuditCommand() },
  { name: "alias", summary: "Manage shorthand CLI command aliases", example: "cinecode alias list", outcome: "report", network: false, destructive: false, load: async () => (await import("./alias.js")).createAliasCommand() },
  { name: "init", summary: "Scaffold a project through a questionnaire", example: "cinecode init my-film", outcome: "artifact", network: false, destructive: false, load: async () => (await import("./wizard.js")).createInitCommand() },
  { name: "migrate", summary: "Migrate the config schema to the latest version", example: "cinecode migrate ./cinecode.config.ts", outcome: "artifact", network: false, destructive: true, load: async () => (await import("./migrate.js")).createMigrateCommand() },
  { name: "check-ignore", summary: "Check paths against .cinecodeignore rules", example: "cinecode check-ignore ./output/intro.mp4", outcome: "report", network: false, destructive: false, load: async () => (await import("./check-ignore.js")).createCheckIgnoreCommand() },
  { name: "publish", summary: "Publish a rendered output to a destination", example: "cinecode publish ./output/videos/intro.mp4", outcome: "artifact", network: false, destructive: false, load: async () => (await import("./publish.js")).createPublishCommand() },
];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((command) => command.name === name);
}

export function commandNames(): string[] {
  return COMMANDS.map((command) => command.name);
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let row = 1; row <= b.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= a.length; column += 1) {
      const cost = a[column - 1] === b[row - 1] ? 0 : 1;
      current[column] = Math.min(current[column - 1]! + 1, previous[column]! + 1, previous[column - 1]! + cost);
    }
    previous = current;
  }
  return previous[a.length]!;
}

/** Closest documented command, or undefined when nothing is close enough. */
export function suggestCommand(name: string): string | undefined {
  let best: string | undefined;
  let bestDistance = 4;
  for (const command of COMMANDS) {
    const next = distance(name, command.name);
    if (next < bestDistance) {
      best = command.name;
      bestDistance = next;
    }
  }
  return best;
}
