export interface JsonSchemaNode {
  readonly $ref?: string;
  readonly type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  readonly title?: string;
  readonly description?: string;
  readonly enum?: readonly (string | number | boolean)[];
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly items?: JsonSchemaNode;
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchemaNode;
  readonly default?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
  readonly format?: string;
  readonly oneOf?: readonly JsonSchemaNode[];
}

export interface JsonSchemaDocument {
  readonly $schema: string;
  readonly $id: string;
  readonly title: string;
  readonly description: string;
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonSchemaNode>>;
  readonly required: readonly string[];
  readonly additionalProperties: boolean;
  readonly definitions: Readonly<Record<string, JsonSchemaNode>>;
}

const str = (description?: string): JsonSchemaNode => (description ? { type: "string", description } : { type: "string" });
const num = (description?: string): JsonSchemaNode => (description ? { type: "number", description } : { type: "number" });
const bool = (description?: string): JsonSchemaNode => (description ? { type: "boolean", description } : { type: "boolean" });
const ref = (name: string): JsonSchemaNode => ({ $ref: `#/definitions/${name}` });
const arrayOf = (items: JsonSchemaNode, description?: string): JsonSchemaNode => ({
  type: "array",
  items,
  ...(description ? { description } : {}),
});
const mapOf = (additionalProperties: boolean | JsonSchemaNode = true): JsonSchemaNode => ({
  type: "object",
  additionalProperties,
});
const stringOrNumber = (description?: string): JsonSchemaNode => ({
  anyOf: [{ type: "string" }, { type: "number" }],
  ...(description ? { description } : {}),
});
const enumOf = (values: readonly string[], description?: string): JsonSchemaNode => ({
  type: "string",
  enum: values,
  ...(description ? { description } : {}),
});
const objectOf = (
  properties: Readonly<Record<string, JsonSchemaNode>>,
  required: readonly string[] = [],
  description?: string,
): JsonSchemaNode => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
  ...(description ? { description } : {}),
});

const TIME_RANGE: Readonly<Record<string, JsonSchemaNode>> = {
  start: stringOrNumber("Start time in seconds or a duration string such as \"1.5s\"."),
  end: stringOrNumber("End time in seconds or a duration string."),
  duration: stringOrNumber("Clip duration in seconds or a duration string."),
};

const EFFECT_REF = objectOf({
  name: str("Effect name, for example \"vignette\" or \"gaussian-blur\"."),
  enabled: bool(),
  from: stringOrNumber(),
  to: stringOrNumber(),
  params: mapOf(true),
  keyframes: arrayOf(ref("KeyframeTrack"), "Per-property keyframe tracks."),
}, ["name"], "Reference to a registered effect and its parameters.");

const TRANSITION_REF = objectOf({
  name: str("Transition name, built-in or registered by a plugin."),
  duration: stringOrNumber("Transition duration in seconds or a duration string."),
  params: mapOf(true),
  eased: bool(),
}, ["name"], "Transition applied to the start or end of a visual clip.");

const CLIP_PROPERTIES: Readonly<Record<string, JsonSchemaNode>> = {
  ...TIME_RANGE,
  type: enumOf([
    "video", "image", "text", "shape", "solid", "group", "scene", "component",
    "audio", "sound", "tts", "model3d", "svg", "particle", "noise",
    "audioVisualizer", "chromaKey", "subtitle", "dataViz", "sticker",
    "gradientMesh", "meshWarp", "text3d", "multiCamera",
  ], "Clip discriminant."),
  src: str("Media source path or URL. Resolvers handle http(s), s3 and gs schemes."),
  name: str(),
  text: str(),
  fit: enumOf(["cover", "contain", "fill", "none", "scale-down"]),
  color: str(),
  background: str(),
  opacity: num(),
  volume: num(),
  muted: bool(),
  loop: bool(),
  speed: num(),
  reverse: bool(),
  pan: num(),
  trimStart: stringOrNumber(),
  trimEnd: stringOrNumber(),
  fadeIn: stringOrNumber(),
  fadeOut: stringOrNumber(),
  sidechainFrom: str("Track name that ducks this audio clip."),
  position3d: objectOf({
    x: num(), y: num(), z: num(),
    maxDistance: num(), rolloffFactor: num(),
  }),
  transform: objectOf({
    x: num(), y: num(), scaleX: num(), scaleY: num(),
    rotation: num(), anchor: str(), skewX: num(), skewY: num(),
  }),
  effects: arrayOf(ref("EffectRef")),
  transitionIn: ref("TransitionRef"),
  transitionOut: ref("TransitionRef"),
  keyframes: arrayOf(ref("KeyframeTrack"), "Animatable property tracks."),
  mask: mapOf(true),
  matte: mapOf(true),
  dropShadow: mapOf(true),
  data: arrayOf(mapOf(true), "Inline data points for data visualization clips."),
  chartType: enumOf(["bar", "line", "pie", "area", "scatter"]),
  emitter: mapOf(true),
  noiseType: enumOf(["simplex", "perlin", "worley", "fbm"]),
  svg: str("Inline SVG source markup."),
  style: mapOf(true),
};

const TRACK_SCHEMA = objectOf({
  kind: enumOf(["visual", "audio", "subtitle"], "Track kind. Defaults to visual."),
  name: str(),
  muted: bool(),
  opacity: num(),
  blend: str("Blend mode applied to the whole track."),
  clips: arrayOf(ref("Clip"), "Ordered clips on this track."),
}, ["clips"], "A visual, audio or subtitle track.");

const CONFIG_DEFINITIONS: Readonly<Record<string, JsonSchemaNode>> = {
  ProjectConfig: objectOf({
    name: str("Project name used as the default output stem."),
    entry: str("Root manifest entry. Default: ./main.ts."),
    sourceDir: str("Directory holding authored sources. Default: ./src."),
    outputDir: str("Directory receiving rendered artifacts. Default: ./output."),
    cacheDir: str("Directory holding render caches. Default: .cinecode/cache."),
  }, ["name", "entry", "sourceDir", "outputDir", "cacheDir"]),

  VideoConfig: objectOf({
    title: str(),
    description: str(),
    author: str(),
    version: str(),
    tags: arrayOf(str()),
    license: str(),
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 },
    aspectRatio: enumOf(["16:9", "9:16", "1:1", "4:3", "21:9"]),
    fps: { type: "number", minimum: 1, maximum: 120 },
    defaultDuration: stringOrNumber(),
    background: str(),
    colorSpace: enumOf(["srgb", "rec709", "display-p3"]),
    pixelAspectRatio: num(),
  }, ["title", "width", "height", "fps", "background"]),

  ImageConfig: objectOf({
    defaultFormat: enumOf(["png", "jpg", "webp", "svg"]),
    quality: { type: "number", minimum: 1, maximum: 100 },
    scaleFactor: num(),
  }, ["defaultFormat"]),

  DevConfig: objectOf({
    port: { type: "integer", minimum: 1, maximum: 65535 },
    host: str(),
    open: bool(),
    hmr: bool(),
    historyDepth: { type: "integer", minimum: 1, maximum: 500 },
  }, ["port", "hmr"]),

  RenderConfig: objectOf({
    fps: { type: "number", minimum: 1, maximum: 120 },
    resolution: str("Resolution preset or WIDTHxHEIGHT."),
    format: enumOf(["mp4", "webm", "prores", "gif", "png", "pdf", "webm-alpha", "prores-alpha"]),
    background: str(),
    quality: enumOf(["draft", "preview", "medium", "final", "lossless", "low", "high"]),
    codec: enumOf(["h264", "h265", "av1", "prores", "vp9"]),
    crf: { type: "number", minimum: 0, maximum: 63 },
    preset: enumOf(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"]),
    hardwareAcceleration: enumOf(["auto", "nvenc", "videotoolbox", "qsv", "off"]),
    concurrency: { anyOf: [{ type: "integer", minimum: 1 }, { type: "string", enum: ["auto"] }] },
    chunkSize: { type: "integer", minimum: 1 },
    alpha: bool(),
    twoPass: bool(),
    platformPreset: enumOf(["youtube-1080p", "youtube-4k", "tiktok", "instagram-reels", "instagram-post", "twitter", "custom"]),
    enforceAspectRatio: bool(),
    variants: arrayOf(objectOf({
      label: str(),
      width: { type: "integer" },
      height: { type: "integer" },
      scaleFactor: num(),
      crf: num(),
      codec: enumOf(["h264", "h265", "av1", "prores", "vp9"]),
    }, ["label"])),
  }),

  AudioConfig: objectOf({
    sampleRate: { type: "integer", enum: [22050, 44100, 48000, 96000] },
    channels: { type: "integer", enum: [1, 2] },
    masterVolume: num(),
    normalize: bool(),
    limiter: objectOf({ enabled: bool(), thresholdDb: num() }, ["enabled", "thresholdDb"]),
    sidechains: arrayOf(objectOf({
      targetTrackName: str(),
      sidechainTrackName: str(),
      threshold: num(),
      ratio: num(),
      attackMs: num(),
      releaseMs: num(),
    }, ["targetTrackName", "sidechainTrackName"])),
  }),

  FontEntry: objectOf({
    family: str(),
    src: str(),
    weight: stringOrNumber(),
    style: str(),
  }, ["family", "src"]),

  CloudMediaEntry: objectOf({
    url: str(),
    name: str(),
    sha256: str(),
  }, ["url"]),

  PluginConfigEntry: objectOf({
    source: str("Package name or path to the plugin module."),
    options: mapOf(true),
    enabled: bool(),
  }, ["source"]),

  EffectRef: EFFECT_REF,
  TransitionRef: TRANSITION_REF,
  KeyframeTrack: {
    type: "array",
    description: "Tuple of [property, keyframes].",
    items: { anyOf: [{ type: "string" }, { type: "array", items: mapOf(true) }] },
  },
  Clip: objectOf(CLIP_PROPERTIES, ["type"], "Any Cinecode clip. Type-specific fields are validated by the runtime."),
  Track: TRACK_SCHEMA,

  Timeline: objectOf({
    name: str(),
    tracks: arrayOf(ref("Track")),
    offset: stringOrNumber(),
    speed: num(),
    duration: stringOrNumber(),
  }, ["tracks"]),

  TempoRegion: objectOf({
    start: num(),
    end: num(),
    fps: num(),
    speed: num(),
  }, ["start", "end"]),

  ChapterMarker: objectOf({ time: num("Seconds into the composition."), title: str() }, ["time", "title"]),

  SplitRegion: objectOf({
    x: num(), y: num(), width: num(), height: num(),
    sourceTrack: str(), fit: enumOf(["cover", "contain", "fill", "none", "scale-down"]),
    padding: num(), roundedCorners: num(),
  }),

  SplitScreenConfig: objectOf({
    layout: enumOf(["side-by-side", "pip", "grid-2x2", "grid-3x3", "thirds-vertical", "thirds-horizontal", "custom"]),
    regions: arrayOf(ref("SplitRegion")),
    padding: num(),
  }, ["layout"]),

  SkyboxConfig: objectOf({
    type: enumOf(["cube", "equirectangular", "procedural"]),
    faces: arrayOf(str()),
    src: str(),
    exposure: num(),
    yaw: num(),
    pitch: num(),
  }, ["type"]),

  PostProcessEffectConfig: objectOf({
    name: str(),
    params: mapOf(true),
    enabled: bool(),
    priority: num(),
  }, ["name"]),

  PostProcessingConfig: objectOf({
    effects: arrayOf(ref("PostProcessEffectConfig")),
    previewMode: bool(),
    resolutionScale: num(),
  }),

  Composition: objectOf({
    name: str(),
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 },
    fps: { type: "number", minimum: 1, maximum: 120 },
    background: str(),
    duration: stringOrNumber(),
    tempo: arrayOf(ref("TempoRegion")),
    audio: ref("AudioConfig"),
    rootTimeline: ref("Timeline"),
    splitScreen: ref("SplitScreenConfig"),
    skybox: ref("SkyboxConfig"),
    chapters: arrayOf(ref("ChapterMarker")),
    postProcessing: ref("PostProcessingConfig"),
    burnSubtitles: bool(),
  }, ["name", "width", "height", "fps", "rootTimeline"], "A renderable composition."),
};

export function generateSchema(): JsonSchemaDocument {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://cinecode.dev/schemas/cinecode.schema.json",
    title: "Cinecode Configuration",
    description:
      "JSON Schema for Cinecode configs and compositions. Generated from the public TypeScript types in src/core/types and src/config.",
    type: "object",
    additionalProperties: true,
    required: ["sourceDir"],
    properties: {
      $schema: str("Schema reference for editor tooling."),
      schemaVersion: { type: "integer", enum: [1, 2], default: 2 },
      name: str("Project name used as the output stem."),
      extends: str("Path to a base config file this config inherits from."),
      project: ref("ProjectConfig"),
      video: ref("VideoConfig"),
      images: ref("ImageConfig"),
      dev: ref("DevConfig"),
      sourceDir: str("Directory holding authored sources. Default: ./src."),
      outputDir: str("Directory receiving rendered artifacts. Default: ./output."),
      cacheDir: str("Directory holding render caches. Default: .cinecode/cache."),
      cloudMedia: arrayOf(ref("CloudMediaEntry")),
      render: ref("RenderConfig"),
      audio: ref("AudioConfig"),
      fonts: arrayOf(ref("FontEntry")),
      concurrency: { anyOf: [{ type: "integer", minimum: 1 }, { type: "string", enum: ["auto"] }] },
      logLevel: enumOf(["silent", "error", "warn", "info", "debug"]),
      overwrite: bool(),
      gitignore: bool(),
      plugins: arrayOf(ref("PluginConfigEntry")),
      autoDiscoverPlugins: bool("Scan node_modules for marked Cinecode plugin packages."),
      ignorePatterns: arrayOf(str("Glob pattern excluded from sync and media scanning.")),
      composition: ref("Composition"),
    },
    definitions: CONFIG_DEFINITIONS,
  };
}

export function generateSchemaJson(): string {
  return `${JSON.stringify(generateSchema(), null, 2)}\n`;
}
