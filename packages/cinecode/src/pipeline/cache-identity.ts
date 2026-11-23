import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { recordDegradation } from "../errors/degradations.js";
import { CINECODE_VERSION } from "../version.js";
import { CACHE_FORMAT_VERSION } from "../contracts.js";

export const CACHE_FORMAT = CACHE_FORMAT_VERSION;

export function deriveCacheKey(value: unknown): string {
  const payload = typeof value === "string" ? value : canonicalJsonString(value);
  return createHash("sha256").update(payload).digest("hex");
}

export interface MediaFingerprint {
  readonly src: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly modifiedMs: number;
}

export interface FrameCacheDescriptor {
  readonly compositionId: string;
  readonly compositionHash: string;
  readonly frameIndex: number;
  readonly media: readonly MediaFingerprint[];
  readonly clips: unknown;
  readonly effects: unknown;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly workingColorSpace: string;
}

export interface CachePluginIdentity {
  readonly name: string;
  readonly version: string;
  readonly options?: unknown;
}

export interface CacheIdentityInputs {
  readonly composition: object;
  readonly seed?: number;
  readonly encoding?: unknown;
  readonly frameWindow?: { readonly from?: number; readonly to?: number };
  readonly tempo?: unknown;
  readonly colorSpace?: string;
  readonly colorManagement?: unknown;
  readonly pixelRatio?: number;
  readonly alpha?: boolean;
  readonly registry?: unknown;
  readonly plugins?: readonly CachePluginIdentity[];
  readonly fonts?: unknown;
  readonly frameworkVersion?: string;
  readonly entryPath?: string;
  readonly entryContent?: string | Buffer;
}

export interface CacheIdentityResult {
  readonly identityHash: string;
  readonly bypassCache: boolean;
  readonly bypassReason?: string;
  readonly cacheFormat: number;
  readonly frameworkVersion: string;
  readonly identityInputs: Record<string, unknown>;
}

export function findFunctionValuedProperty(value: unknown, path: string = ""): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "function") return path || "anonymous";
  if (typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const match = findFunctionValuedProperty(value[i], `${path}[${i}]`);
      if (match) return match;
    }
    return null;
  }
  for (const [key, val] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key;
    const match = findFunctionValuedProperty(val, currentPath);
    if (match) return match;
  }
  return null;
}

export function computeCanonicalCacheIdentity(inputs: CacheIdentityInputs): CacheIdentityResult {
  const frameworkVersion = inputs.frameworkVersion ?? CINECODE_VERSION;
  const state: CanonicalState = { opaque: [] };
  const composition = canonicalize(summarizeForHash(inputs.composition), "composition", state);

  if (state.opaque.length > 0) {
    const reason = `composition contains opaque function-valued property at ${state.opaque.join(", ")}`;
    recordDegradation({
      code: "CC4008",
      what: "render cache bypassed",
      reason,
      input: state.opaque[0],
      instead: "frames will be rendered fresh without disk cache reuse",
    });
    const randomHash = createHash("sha256").update(randomUUID()).digest("hex").slice(0, 32);
    return {
      identityHash: randomHash,
      bypassCache: true,
      bypassReason: reason,
      cacheFormat: CACHE_FORMAT,
      frameworkVersion,
      identityInputs: { cacheFormat: CACHE_FORMAT, frameworkVersion, opaque: state.opaque },
    };
  }

  const entryDigest = inputs.entryContent !== undefined
    ? createHash("sha256").update(inputs.entryContent).digest("hex")
    : "";

  const identityPayload = {
    cacheFormat: CACHE_FORMAT,
    composition,
    seed: inputs.seed ?? 0,
    encoding: inputs.encoding ?? null,
    frameWindow: inputs.frameWindow ?? null,
    tempo: inputs.tempo ?? null,
    colorSpace: inputs.colorSpace ?? "srgb",
    colorManagement: inputs.colorManagement ?? null,
    pixelRatio: inputs.pixelRatio ?? 1,
    alpha: inputs.alpha ?? false,
    plugins: inputs.plugins ?? inputs.registry ?? null,
    fonts: inputs.fonts ?? null,
    frameworkVersion,
    entryDigest,
  };

  const identityHash = createHash("sha256")
    .update(canonicalJsonString(identityPayload))
    .digest("hex")
    .slice(0, 32);

  return {
    identityHash,
    bypassCache: false,
    cacheFormat: CACHE_FORMAT,
    frameworkVersion,
    identityInputs: {
      cacheFormat: CACHE_FORMAT,
      frameworkVersion,
      entryDigest: entryDigest === "" ? "none" : digestOf(entryDigest),
      composition: digestOf(identityPayload.composition),
      seed: identityPayload.seed,
      encoding: digestOf(identityPayload.encoding),
      frameWindow: digestOf(identityPayload.frameWindow),
      tempo: digestOf(identityPayload.tempo),
      colorSpace: identityPayload.colorSpace,
      colorManagement: digestOf(identityPayload.colorManagement),
      pixelRatio: identityPayload.pixelRatio,
      alpha: identityPayload.alpha,
      plugins: digestOf(identityPayload.plugins),
      fonts: digestOf(identityPayload.fonts),
    },
  };
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalize(value, "", { opaque: [] }));
}

interface CanonicalState {
  opaque: string[];
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function digestOf(value: unknown): string {
  return hashText(canonicalJsonString(value));
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function functionIdentity(
  fn: (...args: never[]) => unknown,
  path: string,
  state: CanonicalState,
): unknown {
  let source: string;
  try {
    source = Function.prototype.toString.call(fn).trim();
  } catch {
    source = "";
    recordDegradation({
      code: "CC7108",
      what: "function source unavailable",
      reason: "Function.toString failed",
      input: path,
      instead: "resolved function output is used when available",
    });
  }
  if (source !== "" && !source.includes("[native code]")) {
    return { $function: hashText(source) };
  }
  try {
    const output = (fn as () => unknown)();
    if (output !== undefined && typeof output !== "function") {
      return { $function: hashText(canonicalJsonString(output)) };
    }
  } catch {
    state.opaque.push(path || "anonymous");
  }
  if (!state.opaque.includes(path || "anonymous")) state.opaque.push(path || "anonymous");
  return { $opaque: true };
}

function canonicalize(value: unknown, path: string, state: CanonicalState): unknown {
  if (typeof value === "function") {
    return functionIdentity(value as (...args: never[]) => unknown, path, state);
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "bigint") return value.toString();
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return createHash("sha256")
      .update(Buffer.from(view.buffer, view.byteOffset, view.byteLength))
      .digest("hex");
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()]
        .map(([key, entry]) => [String(key), canonicalize(entry, `${path}.${String(key)}`, state)] as const)
        .sort((left, right) => compareKeys(left[0], right[0])),
    );
  }
  if (value instanceof Set) {
    return [...value]
      .map((entry, index) => canonicalize(entry, `${path}[${index}]`, state))
      .map((entry) => canonicalJsonString(entry))
      .sort();
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalize(entry, `${path}[${index}]`, state));
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    sorted[key] = canonicalize(record[key], path ? `${path}.${key}` : key, state);
  }
  return sorted;
}

export function computeDescriptorHash(descriptor: FrameCacheDescriptor): string {
  return deriveCacheKey(descriptor);
}

export function createFrameCacheDescriptor(input: {
  readonly compositionId: string;
  readonly compositionHash: string;
  readonly frameIndex: number;
  readonly media?: readonly MediaFingerprint[];
  readonly clips?: unknown;
  readonly effects?: unknown;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio?: number;
  readonly workingColorSpace?: string;
}): FrameCacheDescriptor {
  return {
    compositionId: input.compositionId,
    compositionHash: input.compositionHash,
    frameIndex: input.frameIndex,
    media: [...(input.media ?? [])].sort((left, right) => left.src.localeCompare(right.src)),
    clips: input.clips ?? null,
    effects: input.effects ?? null,
    seed: input.seed,
    width: input.width,
    height: input.height,
    pixelRatio: input.pixelRatio ?? 1,
    workingColorSpace: input.workingColorSpace ?? "srgb",
  };
}

export async function fingerprintMediaFile(path: string): Promise<MediaFingerprint> {
  const info = await stat(path);
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return { src: path, sha256: hash.digest("hex"), sizeBytes: info.size, modifiedMs: info.mtimeMs };
}

export interface FontIdentitySource {
  readonly family: string;
  readonly src: string;
  readonly kind: string;
  readonly resolvedPath?: string;
  readonly weight?: number | string;
  readonly style?: string;
}

export async function fingerprintFonts(
  fonts: readonly FontIdentitySource[],
): Promise<readonly Record<string, unknown>[]> {
  const sorted = [...fonts].sort(
    (left, right) =>
      compareKeys(left.family, right.family) ||
      compareKeys(left.src, right.src) ||
      compareKeys(left.kind, right.kind),
  );
  const entries: Record<string, unknown>[] = [];
  for (const font of sorted) {
    entries.push({
      family: font.family,
      src: font.src,
      kind: font.kind,
      weight: font.weight ?? null,
      style: font.style ?? null,
      sha256: font.resolvedPath ? (await fingerprintMediaFile(font.resolvedPath)).sha256 : null,
    });
  }
  return entries;
}

export function computeCompositionHash(composition: object, extra: string = ""): string {
  const hash = createHash("sha256");
  hash.update(canonicalJsonString(summarizeForHash(composition)));
  hash.update(extra);
  return hash.digest("hex").slice(0, 32);
}

function summarizeForHash(composition: unknown): unknown {
  const comp = composition as { rootTimeline?: { tracks?: unknown[] } };
  const tracks = comp?.rootTimeline?.tracks;
  if (!Array.isArray(tracks)) return composition;

  const summarizedTracks = tracks.map((track) => {
    const t = track as { kind?: string; clips?: unknown[] };
    if (t.kind !== "audio" || !Array.isArray(t.clips)) return track;
    return {
      ...t,
      clips: t.clips.map((clip) => {
        const c = clip as { buffer?: { data?: unknown; sampleRate?: number; channels?: number; length?: number } };
        if (!c.buffer) return clip;
        return { ...c, buffer: digestAudioBuffer(c.buffer) };
      }),
    };
  });

  return { ...comp, rootTimeline: { ...(comp.rootTimeline as object), tracks: summarizedTracks } };
}

function digestAudioBuffer(buffer: { data?: unknown; sampleRate?: number; channels?: number; length?: number }): string {
  const { data, sampleRate, channels, length } = buffer;
  const bytes = ArrayBuffer.isView(data as ArrayBufferView)
    ? Buffer.from((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength)
    : Buffer.alloc(0);
  return `sr=${sampleRate},ch=${channels},len=${length},sha=${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
}
