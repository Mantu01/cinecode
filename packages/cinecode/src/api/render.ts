import { isAbsolute, resolve } from "node:path";
import type {
  Composition,
  FontEntry,
  QualitySetting,
  RenderFormat,
  VideoCodec,
} from "../core/types/index.js";
import { createError, ErrorCode } from "../errors/index.js";
import { createProjectResolver } from "../cli/resolve/project-resolver.js";
import { runValidation } from "../cli/gate/validation-engine.js";
import { resolveRenderParameters } from "../cli/resolve/precedence.js";
import { assertRenderableFormat } from "../cli/gate/format-preflight.js";
import { resolveOutputPath, startCompositionRender } from "../cli/shared/shared.js";
import { outputPlanFor } from "../core/output-plan.js";
import { resolveVideoEncoding } from "../core/quality.js";
import { getPluginRegistry } from "../plugin/registry.js";
import { loadProjectPlugins } from "../plugin/loader.js";
import type { RenderJob, RenderResult } from "../pipeline/pipeline-types.js";

const VALID_QUALITIES = new Set<string>([
  "draft",
  "preview",
  "medium",
  "final",
  "lossless",
  "low",
  "high",
]);

export interface RenderApiOptions {
  readonly entry?: string;
  readonly file?: string;
  readonly composition?: string;
  readonly timeline?: string;
  readonly scene?: string;
  readonly preview?: boolean;
  readonly fps?: number;
  readonly resolution?: { readonly width: number; readonly height: number };
  readonly out?: string;
  readonly from?: string | number;
  readonly to?: string | number;
  readonly concurrency?: number | "auto";
  readonly noCache?: boolean;
  readonly fresh?: boolean;
  readonly overwrite?: boolean;
  readonly seed?: number;
  readonly cacheDir?: string;
  /** Override render quality; supersedes config and preview flag. */
  readonly quality?: QualitySetting;
  readonly format?: RenderFormat;
  readonly codec?: VideoCodec;
  /** Chunk size in frames for worker parallelism. */
  readonly chunkSize?: number;
  /** Render memory budget in MiB (frames queued + chunks in flight). */
  readonly memoryBudgetMb?: number;
  /** Configured fonts registered in every render process before drawing. */
  readonly fonts?: readonly FontEntry[];
  /** Project root; defaults to the configured/discovered project. */
  readonly root?: string;
  readonly config?: string;
  readonly cwd?: string;
  readonly projectRoot?: string;
  readonly mediaDir?: string;
  readonly strict?: boolean;
  readonly allowInvalid?: boolean;
}

export interface RenderApiArtifact {
  readonly kind: string;
  readonly path: string;
  readonly units?: number;
  readonly unit?: string;
}

export interface RenderApiSelection {
  readonly id: string;
  readonly kind: string;
  readonly name?: string;
}

export interface RenderApiResult extends RenderResult {
  readonly artifact: RenderApiArtifact;
  readonly selection: RenderApiSelection;
}

export interface TypedRenderJob extends Omit<RenderJob, "promise"> {
  readonly promise: Promise<RenderApiResult>;
}

export async function render(options: RenderApiOptions): Promise<TypedRenderJob> {
  if (options.quality !== undefined && !VALID_QUALITIES.has(options.quality)) {
    throw createError(ErrorCode.CC1012, {
      key: "quality",
      value: String(options.quality),
      allowed: Array.from(VALID_QUALITIES).join(", "),
      reason: `Invalid quality level: "${options.quality}"`,
    });
  }

  const resolver = createProjectResolver({
    root: options.root ?? options.projectRoot ?? options.cwd,
    config: options.config,
    file: options.file ?? options.entry,
    composition: options.composition,
    timeline: options.timeline,
    scene: options.scene,
    requireSelection: true,
  });
  const resolution = await resolver.resolve();

  if ("all" in resolution && typeof (resolution as { all?: unknown }).all === "function") {
    const validationReport = await runValidation(resolution, { mode: "all" });
    if (!validationReport.ok && !options.allowInvalid) {
      throw createError(
        ErrorCode.CC1013,
        { count: validationReport.errors.length },
        {
          location: { file: resolution.configPath },
          fixHint: `Fix reported validation errors: ${validationReport.errors.map((e) => `[${e.code}] ${e.message}`).join("; ")}`,
        },
      );
    }
  }

  const registry = getPluginRegistry();
  await loadProjectPlugins(resolution.config, registry, resolution.root);

  const targets = await resolution.selected();
  const target = targets[0];
  if (!target) {
    throw createError(ErrorCode.CC1009, { reason: "No target selected for rendering" });
  }

  const { parameters, preset } = resolveRenderParameters({
    flags: {
      fps: options.fps,
      width: options.resolution?.width,
      height: options.resolution?.height,
      out: options.out,
      from: options.from,
      to: options.to,
      concurrency: options.concurrency,
      memoryBudget: options.memoryBudgetMb,
      preview: options.preview,
      quality: options.quality,
      format: options.format,
      codec: options.codec,
      overwrite: options.overwrite,
    },
    selection: {
      name: target.name,
      width: target.width,
      height: target.height,
      fps: target.fps,
      duration: target.duration,
    },
    project: {
      root: resolution.root,
      configPath: resolution.configPath,
      manifestPath: resolution.manifestPath,
      config: resolution.config,
      mode: resolution.mode,
      selection: `composition ${target.name}`,
      roots: resolution.context.roots,
    },
    explicit: resolution.context.explicit,
  });

  assertRenderableFormat({
    command: "render",
    format: parameters.format.value,
    fromFrame: parameters.frameWindow.value.from,
    toFrame: parameters.frameWindow.value.to,
    preset: preset?.id,
  });

  const plan = outputPlanFor(parameters.format.value);
  const targetOutputPath = options.out
    ? (isAbsolute(options.out) ? options.out : resolve(resolution.root, options.out))
    : parameters.outputPath.value;
  const outputPath = await resolveOutputPath(targetOutputPath, options.overwrite ?? false);

  const resolvedComposition: Composition = {
    ...target,
    width: parameters.width.value,
    height: parameters.height.value,
    fps: parameters.fps.value,
  };

  const job = startCompositionRender({
    composition: resolvedComposition,
    outputPath,
    config: resolution.config,
    seed: options.seed ?? 0,
    concurrency: parameters.concurrency.value,
    chunkSize: options.chunkSize ?? parameters.chunkSize.value,
    memoryBudgetMb: parameters.memoryBudgetMb.value,
    overwrite: options.overwrite ?? false,
    fresh: options.fresh ?? false,
    noCache: options.noCache ?? false,
    encoding: {
      ...resolveVideoEncoding({
        render: {
          ...resolution.config.render,
          codec: parameters.codec.value,
          crf: parameters.crf.value,
          hardwareAcceleration: parameters.hardwareAcceleration.value,
        },
        quality: parameters.quality.value,
      }),
    },
    format: parameters.format.value,
    fromFrame: parameters.frameWindow.value.from,
    toFrame: parameters.frameWindow.value.to,
    twoPass: parameters.twoPass.value,
    alpha: parameters.alpha.value,
    bitrateKbps: parameters.bitrate.value ? parseInt(parameters.bitrate.value, 10) : undefined,
    colorManagement: parameters.colorManagement.value,
    allowInvalidTimeline: options.allowInvalid === true,
    fonts: options.fonts ?? resolution.config.fonts,
    projectRoot: resolution.root,
    mediaDir: options.mediaDir ?? resolution.config.mediaDir ?? "media",
    strictFonts: options.strict === true,
    strict: options.strict === true,
  });

  const enhancedPromise: Promise<RenderApiResult> = job.promise.then((res) => {
    return {
      ...res,
      artifact: {
        kind: plan.strategy === "sequence" ? "sequence" : "video",
        path: res.outputPath,
        units: Math.max(1, Math.round(res.duration * parameters.fps.value)),
        unit: "frames",
      },
      selection: {
        id: target.name,
        kind: "composition",
        name: target.name,
      },
    };
  });

  return {
    ...job,
    promise: enhancedPromise,
  };
}

export async function renderSync(options: RenderApiOptions): Promise<RenderApiResult> {
  const job = await render(options);
  return job.promise;
}
