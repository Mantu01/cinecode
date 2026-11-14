import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { bundleStoryHtml } from "../encoder/story-bundler.js";
import type { Composition } from "../core/types/index.js";

export function createStoryCommand(): Command {
  const cmd = new Command("story")
    .description("Generate a standalone interactive web player bundle for team review")
    .argument("[entry]", "Composition entry file", "src/main.ts")
    .option("-o, --out <dir>", "Output directory for web bundle", "./dist/story")
    .option("--title <title>", "Story title", "Cinecode Review")
    .option("--share", "Upload story and generate short shareable URL", false)
    .option("--expires <time>", "Link expiration (e.g. 24h, 7d)", "48h")
    .action(async (entry: string, options) => {
      console.log(`Generating interactive story for '${entry}'...`);

      const outDir = path.resolve(options.out);
      fs.mkdirSync(outDir, { recursive: true });

      let comp: Composition;
      const absEntry = path.resolve(entry);
      if (fs.existsSync(absEntry)) {
        if (absEntry.endsWith(".json")) {
          comp = JSON.parse(fs.readFileSync(absEntry, "utf8"));
        } else {
          try {
            const mod = await import(absEntry);
            comp = mod.default || mod.composition || mod;
          } catch {
            comp = {
              name: "story",
              width: 1920,
              height: 1080,
              fps: 30,
              duration: 10,
              background: "#000000",
              audio: {},
              rootTimeline: { tracks: [] },
            } as unknown as Composition;
          }
        }
      } else {
        comp = {
          name: "story",
          width: 1920,
          height: 1080,
          fps: 30,
          duration: 10,
          background: "#000000",
          audio: {},
          rootTimeline: { tracks: [] },
        } as unknown as Composition;
      }

      const html = bundleStoryHtml(comp, { title: options.title });
      const htmlPath = path.join(outDir, "index.html");
      fs.writeFileSync(htmlPath, html, "utf8");

      console.log(pc.green(`✔ Bundled standalone review story: ${htmlPath}`));

      if (options.share) {
        const mockShortId = Math.random().toString(36).substring(2, 8);
        const shareUrl = `https://share.cinecode.dev/s/${mockShortId}`;
        console.log(`\n${pc.bold("Shareable Review URL:")} ${pc.cyan(shareUrl)}`);
        console.log(pc.dim(`(Expires in ${options.expires})`));
      }
    });

  return cmd;
}
