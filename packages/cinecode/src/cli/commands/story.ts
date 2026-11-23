import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pc } from "../output/palette.js";
import { bundleStoryHtml } from "../../encoder/story-bundler.js";
import type { Composition } from "../../core/types/index.js";
import type { TransitionRef } from "../../core/types/clips.js";
import { multiSelect } from "../shared/prompt-select.js";
import { createError, ErrorCode, isCinecodeError } from "../../errors/index.js";
import { runReport } from "../output/run-report.js";
import { createProjectResolver } from "../resolve/project-resolver.js";
import { writeFileAtomic } from "../../encoder/output.js";
import { validateComposition } from "../../core/validation/index.js";

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

export function writeGeneratedComposition(board: Storyboard, sourceDir: string, id: string): string {
  storyboardToComposition(board);
  const dir = path.join(sourceDir, "generated");
  fs.mkdirSync(dir, { recursive: true });
  const build = buildStoryboardClips(board);
  const target = path.join(dir, `story-${id}.ts`);
  const source = [
    'import { defineScene, timeline, track } from "cinecode";',
    "",
    `const clips = ${JSON.stringify(build.clips, null, 2)};`,
    "",
    `export default defineScene(${JSON.stringify(id)}, ${JSON.stringify(build.duration)}, () => timeline(track("main", clips as never)));`,
    "",
  ].join("\n");
  fs.writeFileSync(target, source, "utf8");
  return target;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "story";
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

export async function storyCommand(
  entryOrOptions?: string | StoryOptions,
  maybeOptions?: StoryOptions,
  maybeContext?: import("../gate/preflight.js").PreflightContext,
): Promise<void> {
  const isEntry = typeof entryOrOptions === "string";
  const options = (isEntry ? (maybeOptions ?? {}) : (entryOrOptions ?? maybeOptions ?? {})) as StoryOptions;
  const contextCandidates = isEntry ? [maybeContext] : [maybeOptions, maybeContext];
  const preflight = contextCandidates.find(
    (candidate): candidate is import("../gate/preflight.js").PreflightContext =>
      typeof candidate === "object" && candidate !== null && "resolution" in candidate,
  );
  const resolution = preflight?.resolution ?? await createProjectResolver({
    root: options.root,
    config: options.config,
    requireSelection: false,
  }).resolve();
  const root = resolution.root;
  const explicitEntry = isEntry ? entryOrOptions : undefined;
  const entryPath = explicitEntry ? path.resolve(root, explicitEntry) : resolution.manifestPath ? path.resolve(resolution.manifestPath) : path.resolve(root, "main.ts");
  if (explicitEntry && !fs.existsSync(entryPath)) {
    throw createError(ErrorCode.CC1002, { reason: `Story entry file does not exist: ${entryPath}` }, { location: { file: entryPath } });
  }
  if (!runReport.isMachine()) runReport.diagnostic(`Generating interactive story for '${entryPath}'...`);
  runReport.setProject({ root, manifest: entryPath });

  const outDir = options.out ? path.resolve(root, options.out) : path.resolve(root, "dist/story");
  let board: Storyboard | undefined;
  let boardSource: string | undefined;
  if (options.board) {
    boardSource = path.resolve(root, options.board);
    if (!fs.existsSync(boardSource)) {
      throw createError(ErrorCode.CC1006, { path: boardSource, reason: "storyboard file not found" }, { location: { file: boardSource } });
    }
  } else {
    const candidate = path.resolve(root, "storyboard.json");
    if (fs.existsSync(candidate)) boardSource = candidate;
  }
  if (boardSource) board = loadStoryboard(boardSource);

  let composition: Composition;
  let compositionLabel: string;
  let generatedPath: string | undefined;
  if (board) {
    composition = storyboardToComposition(board);
    compositionLabel = composition.name;
    const generatedId = slug(options.title ?? board.title ?? path.basename(root));
    generatedPath = writeGeneratedComposition(board, resolution.context.roots.source, generatedId);
    runReport.expectArtifact("composition");
    runReport.artifact({ kind: "composition", path: generatedPath, units: 1, unit: "file" });
    if (!runReport.isMachine()) runReport.diagnostic(pc.green(`✔ Generated scene module: ${generatedPath}`));
  } else {
    const selected = await resolution.selected();
    const fromProject = selected[0];
    if (fromProject && !explicitEntry) {
      composition = fromProject;
      compositionLabel = composition.name ?? entryPath;
    } else {
      const absEntry = entryPath;
      if (!fs.existsSync(absEntry)) {
        throw createError(ErrorCode.CC1002, { reason: `Story entry file does not exist: ${absEntry}` }, { location: { file: absEntry } });
      }
      if (absEntry.endsWith(".json")) {
        try {
          composition = JSON.parse(fs.readFileSync(absEntry, "utf8")) as Composition;
        } catch (error) {
          throw createError(ErrorCode.CC1006, { path: absEntry, reason: error instanceof Error ? error.message : String(error) }, { location: { file: absEntry }, cause: error });
        }
      } else {
        try {
          const mod = await import(pathToFileURL(absEntry).href);
          composition = (mod.default || mod.composition || mod) as Composition;
        } catch (error) {
          if (isCinecodeError(error)) throw error;
          throw createError(ErrorCode.CC3008, { path: absEntry, expected: "a composition export" }, { location: { file: absEntry }, cause: error });
        }
      }
      compositionLabel = composition.name ?? absEntry;
    }
  }

  const html = bundleStoryHtml(composition, { title: options.title ?? "Cinecode Review" });
  const htmlPath = path.join(outDir, "index.html");
  await writeFileAtomic(htmlPath, html);
  runReport.expectArtifact("story");
  runReport.artifact({ kind: "story", path: htmlPath, units: 1, unit: "file" });
  runReport.result({ composition: compositionLabel, html: htmlPath, generated: generatedPath });
  if (!runReport.isMachine()) runReport.diagnostic(pc.green(`✔ Bundled standalone review story: ${htmlPath}`));
}

