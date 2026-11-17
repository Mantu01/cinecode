import { Command } from "commander";
import { resolve } from "node:path";
import type { VisualClip, AudioClip, SoundClip, Clip } from "../core/types/index.js";
import { loadComposition, selectComposition, parseTimeInput } from "./still.js";
import { allClips } from "../core/types/tracks.js";
import { createError, ErrorCode } from "../errors/index.js";
import { runReport } from "./run-report.js";

interface InspectOptions {
  composition?: string;
  frame?: number;
  time?: string;
  config?: string;
  props?: string;
  json?: boolean;
  deep?: boolean;
  format?: "dot" | "mermaid" | "ascii";
}

function generateDeepGraph(composition: any, format: "dot" | "mermaid" | "ascii" = "ascii"): string {
  const clips = allClips(composition.rootTimeline);
  const nodes: { id: string; label: string; type: "media" | "transform" | "audio" | "shader" | "output" }[] = [];
  const edges: { from: string; to: string; label: string }[] = [];

  nodes.push({ id: "out_muxer", label: "Final Muxer / Output", type: "output" });

  clips.forEach((c, idx) => {
    const cId = `clip_${idx}`;
    const cAny = c as any;
    const isAudio = cAny.type === "audio" || cAny.type === "sound";
    const clipLabel = cAny.id || cAny.name || cAny.track || idx;
    nodes.push({
      id: cId,
      label: `${(cAny.type || "clip").toUpperCase()}: ${clipLabel}`,
      type: isAudio ? "audio" : "media",
    });

    const start = Number(cAny.start ?? 0);
    const dur = Number(cAny.duration ?? 5);
    const timeLabel = `[${start}s - ${start + dur}s]`;

    if ((c as any).effects && (c as any).effects.length > 0) {
      let prevId = cId;
      (c as any).effects.forEach((eff: any, eIdx: number) => {
        const effId = `${cId}_fx_${eIdx}`;
        nodes.push({ id: effId, label: `FX: ${eff.type}`, type: "shader" });
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
  return typeof start === "number" ? Math.round(start * fps) : parseTimeInput(start, fps);
}

function getClipEndFrame(clip: Clip, fps: number, compositionDuration?: number | string): number {
  if (clip.end !== undefined) {
    return typeof clip.end === "number" ? Math.round(clip.end * fps) : parseTimeInput(clip.end, fps);
  }
  if (clip.duration !== undefined) {
    const startFrame = getClipStartFrame(clip, fps);
    const dur = typeof clip.duration === "number" ? clip.duration : parseFloat(clip.duration);
    return startFrame + Math.round(dur * fps);
  }
  if (compositionDuration) {
    const dur = typeof compositionDuration === "number" ? compositionDuration : parseFloat(compositionDuration);
    return Math.ceil(dur * fps);
  }
  return getClipStartFrame(clip, fps) + 1;
}

function describeVisualClip(clip: VisualClip, fps: number): string[] {
  const lines: string[] = [];
  const startFrame = getClipStartFrame(clip, fps);
  const endFrame = getClipEndFrame(clip, fps, clip.duration as number | string);
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

function describeAudioClip(clip: AudioClip | SoundClip, fps: number): string[] {
  const lines: string[] = [];
  const startFrame = getClipStartFrame(clip, fps);
  const endFrame = getClipEndFrame(clip, fps);
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
  const configPath = options.config ?? options.props ?? "cinecode.config.js";
  const compositions = await loadComposition(resolve(configPath), options.composition);

  if (compositions.length === 0) {
    throw createError(ErrorCode.CC3003, {}, { fixHint: "No compositions found in config" });
  }

  const composition = selectComposition(compositions, options.composition);
  const fps = composition.fps;
  const totalFrames = composition.duration ? Math.ceil((typeof composition.duration === "number" ? composition.duration : parseFloat(composition.duration as string)) * fps) : 0;

  let targetFrame: number | null = null;
  if (options.frame !== undefined) targetFrame = options.frame;
  if (options.time) targetFrame = parseTimeInput(options.time, fps);

  if (options.deep) {
    const graphStr = generateDeepGraph(composition, options.format || "ascii");
    console.log(graphStr);
    return;
  }

  if (options.json) {
    const clips = allClips(composition.rootTimeline);
    const output = {
      composition: composition.name,
      resolution: `${composition.width}x${composition.height}`,
      fps,
      duration: composition.duration,
      totalFrames,
      background: composition.background,
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
  console.log("");

  const clips = allClips(composition.rootTimeline);
  for (const clip of clips) {
    const isActive = targetFrame === null || (targetFrame >= getClipStartFrame(clip, fps) && targetFrame < getClipEndFrame(clip, fps, composition.duration));
    if (!isActive) continue;

    if (clip.type === "audio" || clip.type === "sound") {
      const lines = describeAudioClip(clip, fps);
      for (const line of lines) console.log(line);
    } else {
      const lines = describeVisualClip(clip as VisualClip, fps);
      for (const line of lines) console.log(line);
    }
  }
}

export function createInspectCommand(): Command {
  const cmd = new Command("inspect")
    .description("Print resolved timeline for a composition")
    .option("-c, --composition <name>", "Composition name")
    .option("-f, --frame <number>", "Show clips active at frame", (v) => parseInt(v, 10))
    .option("-t, --time <timecode|seconds>", "Show clips active at time (HH:MM:SS:FF or seconds)")
    .option("--deep", "Generate deep dependency graph across audio, visual, and effects", false)
    .option("--format <format>", "Graph output format: dot, mermaid, ascii")
    .action(async (options: InspectOptions) => {
      await inspectCommand(options);
    });
  return cmd;
}