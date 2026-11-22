import { Command } from "commander";
import type { VisualClip, AudioClip, SoundClip, Clip } from "../core/types/index.js";
import { parseTimeArgument, parseDurationArgument } from "./shared.js";

/** Converts a manifest clip duration value to frames. */
export function manifestClipDurationFrames(value: unknown, fps: number): number {
  if (typeof value === "number") return Math.round(value * fps);
  return parseTimeArgument(String(value), fps);
}


import { compositionTotalFrames, createConversion, durationToFrames } from "../core/time/index.js";
import { TIME_GRAMMAR } from "../core/time-input.js";
import { allClips } from "../core/types/tracks.js";
import { runReport } from "./run-report.js";
import { createProjectResolver, reportResolution } from "./project-resolver.js";
import { resolveRenderParameters, describeExplainReport } from "./precedence.js";
import { referenceWarnings } from "../manifest/references.js";

interface InspectOptions {
  composition?: string;
  file?: string;
  timeline?: string;
  scene?: string;
  frame?: number;
  time?: string;
  config?: string;
  root?: string;
  json?: boolean;
  deep?: boolean;
  format?: "dot" | "mermaid" | "ascii";
}

function generateDeepGraph(composition: Composition, format: "dot" | "mermaid" | "ascii" = "ascii"): string {
  const clips = allClips(composition.rootTimeline);
  const nodes: { id: string; label: string; type: "media" | "transform" | "audio" | "shader" | "output" }[] = [];
  const edges: { from: string; to: string; label: string }[] = [];

  nodes.push({ id: "out_muxer", label: "Final Muxer / Output", type: "output" });

  clips.forEach((c, idx) => {
    const cId = `clip_${idx}`;
    const cClip = c as Clip & { id?: string; name?: string; track?: string; start?: number; duration?: number; effects?: Array<{ type?: string; name?: string }> };
    const isAudio = cClip.type === "audio" || cClip.type === "sound";
    const clipLabel = cClip.id || cClip.name || cClip.track || idx;
    nodes.push({
      id: cId,
      label: `${(cClip.type || "clip").toUpperCase()}: ${clipLabel}`,
      type: isAudio ? "audio" : "media",
    });

    const start = Number(cClip.start ?? 0);
    const dur = Number(cClip.duration ?? 5);
    const timeLabel = `[${start}s - ${start + dur}s]`;

    if (cClip.effects && cClip.effects.length > 0) {
      let prevId = cId;
      cClip.effects.forEach((eff, eIdx: number) => {
        const effId = `${cId}_fx_${eIdx}`;
        nodes.push({ id: effId, label: `FX: ${eff.type ?? eff.name ?? "effect"}`, type: "shader" });
        edges.push({ from: prevId, to: effId, label: "RGBA" });
        prevId = effId;
      });
      edges.push({ from: prevId, to: "out_muxer", label: timeLabel });
    } else {
      edges.push({ from: cId, to: "out_muxer", label: timeLabel });
    }
  });

  if (format === "dot") {
    const lines = ["digraph CompositionGraph {", '  rankdir="LR";', '  node [shape="box", style="rounded,filled", fontname="Helvetica"];'];
    for (const n of nodes) {
      const color = n.type === "media" ? "#63b3ed" : n.type === "audio" ? "#b794f4" : n.type === "shader" ? "#fc8181" : n.type === "output" ? "#68d391" : "#fbd38d";
      lines.push(`  "${n.id}" [label="${n.label}", fillcolor="${color}"];`);
    }
    for (const e of edges) {
      lines.push(`  "${e.from}" -> "${e.to}" [label="${e.label}"];`);
    }
    lines.push("}");
    return lines.join("\n");
  }

  if (format === "mermaid") {
    const lines = ["graph LR"];
    for (const n of nodes) {
      lines.push(`  ${n.id}["${n.label}"]`);
    }
    for (const e of edges) {
      lines.push(`  ${e.from} -->|"${e.label}"| ${e.to}`);
    }
    return lines.join("\n");
  }

  const lines = [`Composition Dependency Tree: ${composition.name || "Default"}`];
  for (const n of nodes) {
    if (n.id === "out_muxer") continue;
    lines.push(`├── [${n.type.toUpperCase()}] ${n.label}`);
    const outEdges = edges.filter(e => e.from === n.id);
    for (const e of outEdges) {
      lines.push(`│   └── feeds into ${e.to} ${e.label}`);
    }
  }
  lines.push(`└── [OUTPUT] Final Muxer / Output`);
  return lines.join("\n");
}

function formatTimecode(frame: number, fps: number): string {
  const totalSeconds = frame / fps;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frames = Math.round((totalSeconds % 1) * fps);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
}

function getClipStartFrame(clip: Clip, fps: number): number {
  const start = clip.start ?? 0;
  return typeof start === "number" ? Math.round(start * fps) : parseTimeArgument(start, fps);
}

function getClipEndFrame(clip: Clip, fps: number, compositionDuration?: number | string): number {
  if (clip.end !== undefined) {
    return typeof clip.end === "number" ? Math.round(clip.end * fps) : parseTimeArgument(clip.end, fps);
  }
  if (clip.duration !== undefined) {
    return getClipStartFrame(clip, fps) + manifestClipDurationFrames(clip.duration, fps);
  }
  if (compositionDuration) {
    return durationToFrames(parseDurationArgument(compositionDuration, fps), createConversion(fps));
  }
  return getClipStartFrame(clip, fps) + 1;
}

function describeVisualClip(clip: VisualClip, fps: number, compositionDuration?: number | string): string[] {
  const lines: string[] = [];
  const startFrame = getClipStartFrame(clip, fps);
  const endFrame = getClipEndFrame(clip, fps, compositionDuration);
  const duration = endFrame - startFrame;

  const timeRange = `[${formatTimecode(startFrame, fps)} \u2013 ${formatTimecode(endFrame, fps)}]`;

  let clipDesc = "";
  if (clip.type === "video") {
    clipDesc = `video "${clip.src}"`;
  } else if (clip.type === "image") {
    clipDesc = `image "${clip.src}"`;
  } else if (clip.type === "solid") {
    clipDesc = `solid ${clip.color}`;
  } else if (clip.type === "text") {
    clipDesc = `text "${clip.content?.slice(0, 30) ?? ""}${clip.content && clip.content.length > 30 ? "..." : ""}"`;
  } else if (clip.type === "shape") {
    clipDesc = `shape ${clip.shapeType}`;
  } else if (clip.type === "component") {
    clipDesc = `component ${clip.ref}`;
  } else if (clip.type === "group") {
    clipDesc = `group (${clip.children.length} children)`;
  } else if (clip.type === "scene") {
    clipDesc = `scene ${clip.ref}`;
  }

  lines.push(`  ${timeRange} ${clipDesc} (${duration} frames)`);

  if (clip.effects && clip.effects.length > 0) {
    const effectsDesc = clip.effects.map(e => {
      const params = Object.entries(e.params ?? {}).map(([k, v]) => {
        if (typeof v === "object" && v && "keyframes" in v) return `${k}: animated`;
        return `${k}: ${v}`;
      }).join(", ");
      return `${e.name}(${params})`;
    }).join(", ");
    lines.push(`    Effects: ${effectsDesc}`);
  }

  if (clip.transform) {
    const transformParts: string[] = [];
    if (clip.transform.x !== undefined) transformParts.push(`x=${clip.transform.x}`);
    if (clip.transform.y !== undefined) transformParts.push(`y=${clip.transform.y}`);
    if (clip.transform.scaleX !== undefined) transformParts.push(`scaleX=${clip.transform.scaleX}`);
    if (clip.transform.scaleY !== undefined) transformParts.push(`scaleY=${clip.transform.scaleY}`);
    if (clip.transform.rotation !== undefined) transformParts.push(`rotation=${clip.transform.rotation}`);
    if (clip.transform.anchor !== undefined) transformParts.push(`anchor=${clip.transform.anchor}`);
    if (transformParts.length > 0) {
      const animated = transformParts.some(p => p.includes("animated") || p.includes("\u2192"));
      if (animated) {
        lines.push(`    Transform: ${transformParts.join(" ")} (animated)`);
      } else {
        lines.push(`    Transform: ${transformParts.join(" ")}`);
      }
    }
  }

  return lines;
}

function describeAudioClip(clip: AudioClip | SoundClip, fps: number, compositionDuration?: number | string): string[] {
  const lines: string[] = [];
  const startFrame = getClipStartFrame(clip, fps);
  const endFrame = getClipEndFrame(clip, fps, compositionDuration);
  const duration = endFrame - startFrame;
  const sampleRate = 48000;
  const samples = Math.round(duration / fps * sampleRate);

  const timeRange = `[${formatTimecode(startFrame, fps)} \u2013 ${formatTimecode(endFrame, fps)}]`;

  let clipDesc = "";
  if (clip.type === "audio") {
    clipDesc = `audio "${clip.src}"`;
  } else if (clip.type === "sound") {
    clipDesc = `sound:${clip.ref}`;
  }

  lines.push(`  ${timeRange} ${clipDesc} (${duration} frames, ${samples} samples)`);

  if (clip.volume !== undefined) {
    if (typeof clip.volume === "object" && "keyframes" in clip.volume) {
      lines.push(`    Volume: animated`);
    } else {
      lines.push(`    Volume: ${clip.volume}`);
    }
  }

  return lines;
}

export async function inspectCommand(options: InspectOptions): Promise<void> {
  const resolver = createProjectResolver({
    root: options.root,
    config: options.config,
    file: options.file,
    composition: options.composition,
    timeline: options.timeline,
    scene: options.scene,
    requireSelection: true,
  });
  const resolution = await resolver.resolve();
  reportResolution(resolution, true);
  const composition = (await resolver.selected())[0]!;
  const timelineValidation = (await resolution.validateCompositions()).find(
    (entry) => entry.composition === composition.name,
  );
  const { parameters, explain } = resolveRenderParameters({
    selection: {
      name: composition.name,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      duration: composition.duration,
    },
    project: {
      root: resolution.root,
      configPath: resolution.configPath,
      manifestPath: resolution.manifestPath,
      mode: resolution.mode,
      selection: resolution.selection.id ? `${resolution.selection.kind} ${resolution.selection.id}` : resolution.selection.kind,
      config: resolution.config,
      roots: resolution.context.roots,
    },
    explicit: resolution.context.explicit,
  });
  const explained = describeExplainReport(explain);
  runReport.result({ explain: explained });
  runReport.explain(explained);
  const fps = parameters.fps.value;
  const width = parameters.width.value;
  const height = parameters.height.value;
  const totalFrames = compositionTotalFrames(composition);

  let targetFrame: number | null = null;
  if (options.frame !== undefined) targetFrame = options.frame;
  if (options.time) targetFrame = parseTimeArgument(options.time, fps);

  const references = resolution.manifest ? referenceWarnings(resolution.manifest.manifest) : [];
  for (const warning of references) runReport.warn(warning.code, warning.message, resolution.manifestPath);

  if (options.deep) {
    const graphStr = generateDeepGraph(composition, options.format || "ascii");
    if (options.json || runReport.isMachine()) {
      runReport.result({
        composition: composition.name,
        deep: true,
        format: options.format || "ascii",
        graph: graphStr,
      });
      return;
    }
    console.log(graphStr);
    return;
  }

  if (options.json) {
    const clips = allClips(composition.rootTimeline);
    const output = {
      composition: composition.name,
      resolution: `${width}x${height}`,
      fps,
      duration: composition.duration,
      totalFrames,
      background: composition.background,
      references: references.map((warning) => ({ code: warning.code, severity: warning.severity, message: warning.message })),
      validation: timelineValidation
        ? {
            valid: timelineValidation.valid,
            errors: timelineValidation.errors,
            warnings: timelineValidation.warnings,
          }
        : undefined,
      clips: clips.map(clip => {
        const base = {
          start: clip.start,
          end: clip.end,
          startFrame: getClipStartFrame(clip, fps),
          endFrame: getClipEndFrame(clip, fps, composition.duration),
          type: clip.type,
        };
        if (clip.type === "video" || clip.type === "image" || clip.type === "audio") return { ...base, src: clip.src };
        if (clip.type === "text") return { ...base, content: clip.content };
        if (clip.type === "sound") return { ...base, ref: clip.ref };
        if (clip.type === "component" || clip.type === "scene") return { ...base, ref: clip.ref };
        if (clip.type === "shape") return { ...base, shapeType: clip.shapeType };
        if (clip.type === "solid") return { ...base, color: clip.color };
        if (clip.type === "group") return { ...base, children: clip.children.length };
        return base;
      }),
    };
    runReport.result(output);
    return;
  }

  console.log(`Composition: ${composition.name} (${composition.width}\u00d7${composition.height} @ ${fps}fps, ${composition.duration ?? "?"}s, ${totalFrames} frames)`);
  console.log(`Background: ${composition.background}`);
  if (timelineValidation) {
    console.log(
      `Validation: ${timelineValidation.errors.length} error(s), ${timelineValidation.warnings.length} warning(s)`,
    );
    for (const issue of [...timelineValidation.errors, ...timelineValidation.warnings]) {
      const where = [issue.clipName ? `clip ${issue.clipName}` : "", issue.trackName ? `track ${issue.trackName}` : "", issue.timecode ?? ""]
        .filter(Boolean)
        .join(", ");
      console.log(`  ${issue.severity} [${issue.code}] ${issue.message}${where ? ` (${where})` : ""}`);
    }
  }
  if (references.length > 0) {
    console.log("Reference warnings:");
    for (const warning of references) console.log(`  warn [${warning.code}] ${warning.message}`);
  }
  console.log("");

  const clips = allClips(composition.rootTimeline);
  for (const clip of clips) {
    const isActive = targetFrame === null || (targetFrame >= getClipStartFrame(clip, fps) && targetFrame < getClipEndFrame(clip, fps, composition.duration));
    if (!isActive) continue;

    if (clip.type === "audio" || clip.type === "sound") {
      const lines = describeAudioClip(clip, fps, composition.duration);
      for (const line of lines) console.log(line);
    } else {
      const lines = describeVisualClip(clip as VisualClip, fps, composition.duration);
      for (const line of lines) console.log(line);
    }
  }
}

import { findCommand, buildCommanderCommand } from "./command-registry.js";

export function createInspectCommand(): Command {
  const spec = findCommand("inspect");
  if (!spec) throw new Error("Command 'inspect' not found in registry");
  return buildCommanderCommand(spec);
}