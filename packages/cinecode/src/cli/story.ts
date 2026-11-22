import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { bundleStoryHtml } from "../encoder/story-bundler.js";
import type { Composition } from "../core/types/index.js";
import type { TransitionRef } from "../core/types/clips.js";
import { multiSelect } from "./prompt-select.js";
import { createError, ErrorCode, isCinecodeError } from "../errors/index.js";
import { runReport } from "./run-report.js";
import { loadProjectContext } from "./project-context.js";
import { validateComposition } from "../core/validation/index.js";
import { buildCommanderCommand, findCommand } from "./command-registry.js";

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

const VALID_TRANSITIONS = new Set([
  "crossfade",
  "fade",
  "fadeToWhite",
  "wipe",
  "dissolve",
  "iris",
  "irisOpen",
  "irisClose",
  "spin",
  "zoom",
  "diagonalWipe",
  "curveWipe",
]);

export function buildStoryboardClips(board: Storyboard): StoryboardBuild {
  const clips: Record<string, unknown>[] = [];
  let cursor = 0;
  let pendingTransition: TransitionRef | undefined;
  for (const shot of board.shots) {
    if (shot.type === "transition") {
      if (!VALID_TRANSITIONS.has(shot.name)) {
        throw createError(ErrorCode.CC1002, {
          key: "transition.name",
          suggestion: `Transition "${shot.name}" is not registered. Use one of [${[...VALID_TRANSITIONS].join(", ")}]`,
        });
      }
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
  const comp: Composition = {
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
  };
  const validation = validateComposition(comp);
  if (!validation.valid) {
    throw createError(ErrorCode.CC1002, {
      reason: `invalid storyboard composition: ${validation.errors.map((e) => e.message).join("; ")}`,
    });
  }
  return comp;
}

export function writeGeneratedComposition(board: Storyboard, dir: string): string {
  const composition = storyboardToComposition(board);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "generated-composition.ts");
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

export interface StoryOptions {
  out?: string;
  title?: string;
  board?: string;
  root?: string;
  config?: string;
}

export async function storyCommand(entry = "src/main.ts", options: StoryOptions = {}): Promise<void> {
  console.log(`Generating interactive story for '${entry}'...`);
  const context = await loadProjectContext({ root: options.root, config: options.config, allowStandalone: true });
  const entryPath = path.resolve(context.root, entry);

  const outDir = path.resolve(context.root, options.out ?? "./dist/story");
  fs.mkdirSync(outDir, { recursive: true });
  runReport.setProject({ root: context.root, manifest: entryPath });
  runReport.expectArtifact("story");

  let board: Storyboard | undefined;
  let boardSource: string | undefined;
  if (options.board) {
    boardSource = path.resolve(options.board);
  } else {
    const candidate = path.resolve(context.root, "storyboard.json");
    if (!fs.existsSync(entryPath) && fs.existsSync(candidate)) {
      boardSource = candidate;
    }
  }
  if (!boardSource && !fs.existsSync(entryPath)) {
    board = await interactiveStoryboard();
    console.log(pc.dim("No entry or storyboard.json found — using template storyboard"));
  }
  if (boardSource) {
    board = loadStoryboard(boardSource);
  }

  if (board) {
    const composition = storyboardToComposition(board);
    const generatedPath = writeGeneratedComposition(board, path.join(context.roots.output, "scenes"));
    runReport.artifact({ kind: "composition", path: generatedPath, units: 1, unit: "file" });
    console.log(pc.green(`✔ Generated composition from storyboard: ${generatedPath}`));
    const html = bundleStoryHtml(composition, { title: options.title ?? "Cinecode Review" });
    const htmlPath = path.join(outDir, "index.html");
    fs.writeFileSync(htmlPath, html, "utf8");
    runReport.artifact({ kind: "story", path: htmlPath, units: 1, unit: "file" });
    runReport.result({ composition: generatedPath, html: htmlPath });
    console.log(pc.green(`✔ Bundled standalone review story: ${htmlPath}`));
    return;
  }

  let comp: Composition;
  const absEntry = entryPath;
  if (absEntry.endsWith(".json")) {
    try {
      comp = JSON.parse(fs.readFileSync(absEntry, "utf8"));
    } catch (error) {
      throw createError(ErrorCode.CC1006, { path: absEntry, reason: error instanceof Error ? error.message : String(error) }, { location: { file: absEntry }, cause: error });
    }
  } else {
    try {
      const mod = await import(absEntry);
      comp = mod.default || mod.composition || mod;
    } catch (error) {
      if (isCinecodeError(error)) throw error;
      throw createError(ErrorCode.CC3008, { path: absEntry, expected: "a composition export" }, { location: { file: absEntry }, cause: error });
    }
  }

  const html = bundleStoryHtml(comp, { title: options.title ?? "Cinecode Review" });
  const htmlPath = path.join(outDir, "index.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  runReport.artifact({ kind: "story", path: htmlPath, units: 1, unit: "file" });
  runReport.result({ html: htmlPath });

  console.log(pc.green(`✔ Bundled standalone review story: ${htmlPath}`));
}

export function createStoryCommand(): Command {
  return buildCommanderCommand(findCommand("story")!);
}
