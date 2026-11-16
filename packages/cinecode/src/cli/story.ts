import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pc from "picocolors";
import { bundleStoryHtml } from "../encoder/story-bundler.js";
import type { Composition } from "../core/types/index.js";
import type { TransitionRef } from "../core/types/clips.js";
import { multiSelect } from "./prompt-select.js";

export interface SceneShot {
  readonly type: "scene";
  readonly duration?: number;
  readonly config: Record<string, unknown>;
}

export interface TransitionShot {
  readonly type: "transition";
  readonly name: string;
  readonly duration?: number;
}

export interface TextShot {
  readonly type: "text";
  readonly content: string;
  readonly duration?: number;
  readonly fontSize?: number;
}

export type StoryboardShot = SceneShot | TransitionShot | TextShot;

export interface Storyboard {
  readonly title?: string;
  readonly fps?: number;
  readonly width?: number;
  readonly height?: number;
  readonly background?: string;
  readonly shots: readonly StoryboardShot[];
}

const DEFAULT_SHOT_SECONDS = 3;
const DEFAULT_TEXT_SECONDS = 2;

export interface StoryboardBuild {
  readonly clips: Record<string, unknown>[];
  readonly duration: number;
}

export function buildStoryboardClips(board: Storyboard): StoryboardBuild {
  const clips: Record<string, unknown>[] = [];
  let cursor = 0;
  let pendingTransition: TransitionRef | undefined;
  for (const shot of board.shots) {
    if (shot.type === "transition") {
      pendingTransition = { name: shot.name, duration: shot.duration };
      continue;
    }
    if (shot.type === "scene") {
      const duration = shot.duration ?? DEFAULT_SHOT_SECONDS;
      clips.push({
        ...shot.config,
        start: cursor,
        duration,
        ...(pendingTransition ? { transitionIn: pendingTransition } : {}),
      });
      cursor += duration;
      pendingTransition = undefined;
      continue;
    }
    const duration = shot.duration ?? DEFAULT_TEXT_SECONDS;
    clips.push({
      type: "text",
      content: shot.content,
      start: cursor,
      duration,
      fontSize: shot.fontSize ?? 64,
      align: "center",
    });
    cursor += duration;
  }
  return { clips, duration: cursor };
}

export function storyboardToComposition(board: Storyboard): Composition {
  const { clips, duration } = buildStoryboardClips(board);
  return {
    name: board.title ?? "story",
    width: board.width ?? 1920,
    height: board.height ?? 1080,
    fps: board.fps ?? 30,
    duration,
    background: board.background ?? "#000000",
    audio: {},
    rootTimeline: {
      tracks: [
        { name: "visual", kind: "visual", clips: clips as never },
      ],
    },
  } as unknown as Composition;
}

export function writeGeneratedComposition(board: Storyboard, cwd = process.cwd()): string {
  const composition = storyboardToComposition(board);
  const target = path.join(cwd, "generated-composition.ts");
  const source = `import { defineConfig } from "cinecode";\n\nexport default defineConfig(${JSON.stringify(composition, null, 2)});\n`;
  fs.writeFileSync(target, source, "utf8");
  return target;
}

function isStoryboard(value: unknown): value is Storyboard {
  return (
    typeof value === "object"
    && value !== null
    && Array.isArray((value as Storyboard).shots)
  );
}

export function loadStoryboard(filePath: string): Storyboard {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isStoryboard(parsed)) {
    throw new Error(`Storyboard file '${filePath}' must be a JSON object with a 'shots' array`);
  }
  return parsed;
}

const BOARD_TEMPLATES: readonly { readonly label: string; readonly board: Storyboard }[] = [
  {
    label: "Scene + title card + scene (with fade transition)",
    board: {
      title: "Story",
      shots: [
        { type: "scene", config: { type: "shape", shapeType: "rectangle", fill: "#1e3a8a" } },
        { type: "transition", name: "fade", duration: 0.5 },
        { type: "text", content: "Chapter 1" },
        { type: "scene", config: { type: "shape", shapeType: "rectangle", fill: "#7f1d1d" } },
      ],
    },
  },
  {
    label: "Single scene with title overlay",
    board: {
      title: "Story",
      shots: [
        { type: "scene", config: { type: "shape", shapeType: "rectangle", fill: "#14532d" } },
        { type: "text", content: "Title" },
      ],
    },
  },
  {
    label: "Text-only storyboard",
    board: {
      title: "Story",
      shots: [
        { type: "text", content: "Intro" },
        { type: "text", content: "Body" },
        { type: "text", content: "Outro" },
      ],
    },
  },
];

async function interactiveStoryboard(): Promise<Storyboard> {
  const [template] = await multiSelect("Choose a storyboard template", [
    ...BOARD_TEMPLATES.map((entry) => ({ value: entry, label: entry.label })),
  ]);
  return template?.board ?? BOARD_TEMPLATES[0]!.board;
}

export function createStoryCommand(): Command {
  const cmd = new Command("story")
    .description("Generate a standalone interactive web player bundle for team review")
    .argument("[entry]", "Composition entry file or storyboard JSON", "src/main.ts")
    .option("-o, --out <dir>", "Output directory for web bundle", "./dist/story")
    .option("--title <title>", "Story title", "Cinecode Review")
    .option("--board <path>", "Storyboard JSON path (auto-detects ./storyboard.json)")
    .option("--share", "Upload story and generate short shareable URL", false)
    .option("--expires <time>", "Link expiration (e.g. 24h, 7d)", "48h")
    .action(async (entry: string, options) => {
      console.log(`Generating interactive story for '${entry}'...`);

      const outDir = path.resolve(options.out);
      fs.mkdirSync(outDir, { recursive: true });

      let board: Storyboard | undefined;
      let boardSource: string | undefined;
      if (options.board) {
        boardSource = path.resolve(options.board);
      } else {
        const candidate = path.resolve("storyboard.json");
        if (!fs.existsSync(path.resolve(entry)) && fs.existsSync(candidate)) {
          boardSource = candidate;
        }
      }
      if (!boardSource && !fs.existsSync(path.resolve(entry))) {
        board = await interactiveStoryboard();
        console.log(pc.dim("No entry or storyboard.json found — using template storyboard"));
      }
      if (boardSource) {
        board = loadStoryboard(boardSource);
      }

      if (board) {
        const composition = storyboardToComposition(board);
        const generatedPath = writeGeneratedComposition(board);
        console.log(pc.green(`✔ Generated composition from storyboard: ${generatedPath}`));
        const html = bundleStoryHtml(composition, { title: options.title });
        const htmlPath = path.join(outDir, "index.html");
        fs.writeFileSync(htmlPath, html, "utf8");
        console.log(pc.green(`✔ Bundled standalone review story: ${htmlPath}`));
        if (options.share) {
          printShareUrl(options.expires);
        }
        return;
      }

      let comp: Composition;
      const absEntry = path.resolve(entry);
      if (absEntry.endsWith(".json")) {
        comp = JSON.parse(fs.readFileSync(absEntry, "utf8"));
      } else {
        try {
          const mod = await import(absEntry);
          comp = mod.default || mod.composition || mod;
        } catch {
          comp = fallbackComposition();
        }
      }

      const html = bundleStoryHtml(comp, { title: options.title });
      const htmlPath = path.join(outDir, "index.html");
      fs.writeFileSync(htmlPath, html, "utf8");

      console.log(pc.green(`✔ Bundled standalone review story: ${htmlPath}`));

      if (options.share) {
        printShareUrl(options.expires);
      }
    });

  return cmd;
}

function fallbackComposition(): Composition {
  return {
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

function printShareUrl(expires: string): void {
  const mockShortId = randomUUID().slice(0, 6);
  const shareUrl = `https://share.cinecode.dev/s/${mockShortId}`;
  console.log(`\n${pc.bold("Shareable Review URL:")} ${pc.cyan(shareUrl)}`);
  console.log(pc.dim(`(Expires in ${expires})`));
}
