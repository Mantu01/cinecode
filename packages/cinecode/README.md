# Cinecode

Programmatic media creation for filmmakers and developers. Describe a video, animation, or interactive canvas in TypeScript, then render it to MP4, WebM, GIF, PNG sequence, or PDF with a deterministic pipeline.

Cinecode treats compositions as code: timelines, clips, effects, audio, and 3D scenes are typed objects you can compose, diff, test, and reuse. Plugins, resolvers, and lifecycle hooks extend every stage of the render.

## Requirements

Node.js `>=22.18.0`, which ships native TypeScript type stripping. An older runtime stops
before any command runs and exits with code `78` and the `CINECODE_RUNTIME_UNSUPPORTED`
message on standard error. Install Node.js 22.18.0 or newer, then run the command again.

## Quick start

```bash
pnpm add cinecode
```

```typescript
// main.ts — the one accepted entry shape
import { defineMain } from "cinecode";

export default defineMain({
  scenes: [
    {
      id: "intro",
      name: "Hello Scene",
      file: "./src/scenes/intro.ts",
      duration: 3,
    },
  ],
  timelines: [
    {
      id: "main",
      name: "Hello, Cinecode",
      duration: 3,
      sceneRefs: ["intro"],
    },
  ],
});
```

```typescript
// src/scenes/intro.ts
import { defineScene, timeline, track, text, solid } from "cinecode";

const DURATION = 3;

export default defineScene("intro", DURATION, () => {
  return timeline([
    track("background", [solid("#0b0b0f", { start: 0, duration: DURATION })]),
    track("title", [
      text("Hello, Cinecode", 96, {
        start: 0.5,
        duration: 2,
        align: "center",
        fill: "#ffffff",
        transitionIn: { name: "crossfade", duration: 0.6 },
      }),
    ]),
  ]);
});
```

```bash
npx cinecode render --all --config ./cinecode.config.ts --overwrite
```

See [`example/basic-api`](../../example/basic-api/) for a complete runnable project.

## Transition semantics

A transition blends a clip with the state on its own track. Timing is measured
from the clip's declared start and end in composition time.

| Field | Blends from | Blends to | Window |
| --- | --- | --- | --- |
| `transitionIn` | previous active clip on the track, or transparent | the clip | first `duration` seconds of the clip |
| `transitionOut` | the clip | transparent | last `duration` seconds of the clip |

- When entry and exit durations exceed the clip length, both scale down
  proportionally so they never overlap.
- A clip alone on a track fades in from transparent, which reveals the
  composition background or lower tracks.
- For three or more overlapping clips, the underlay is the previous active clip
  on the same track. Clips render in track order, then start time, then
  declaration order, so the last declared clip sits on top.
- Masks, mattes and opacity apply to the blended result; nothing renders after
  the clip's end.

## Audio clip semantics

Audio clips (`audio`, `sound`, `tts`) are processed in one fixed order: resolve
the source and conform its sample rate, trim, apply speed, reverse, loop to the
clip duration, apply fades, then apply the 3D position. Gain, pan and sidechain
ducking are applied by the mixer, so reordering the fields never changes the
output.

| Field | Behavior |
| --- | --- |
| `start`, `duration` | Clip placement in composition time; a clip never runs past the composition duration, which also bounds looping memory. |
| `trimStart`, `trimEnd` | Keeps the source range between both offsets. Both use composition time conversion, so timecodes follow the composition frame rate. Trimming past the source duration fails with the clip id. |
| `speed` | Resamples the trimmed source, so `2` halves its duration and `0.5` doubles it. TTS speed is applied by the speech engine and is not applied twice. |
| `reverse` | Reverses the trimmed, resampled source sample by sample; fades still follow playback order. |
| `loop` | Repeats the processed source to the clip duration. The seam policy is a folded 10 ms crossfade: the source tail is blended into its head, so a loop has no click and no gap. |
| `fadeIn`, `fadeOut` | Linear fades over the final playback buffer, after trim, speed, reverse and loop. |
| `volume` | Track gain applied by the mixer. |
| `pan` | Constant-power stereo pan; mono output reports a degradation instead of silently dropping it. |
| `position3d` | Distance attenuation, low-pass and stereo placement (attenuation only on mono output, reported as a degradation). |
| `sidechainFrom` | Names the audio track that ducks this clip. A missing or silent source track fails with the referencing clip id. |
| `muted` | Mutes the clip or its whole track. |
| `src`, `buffer`, `stem`, `stemModel` | File source, inline decoded buffer, and optional stem separation over the file source. |
| `text`, `voice`, `language`, `engine` | Text-to-speech input, voice, language and backend. |

## Mixing

The mixer works in fixed 4096-frame blocks, so working memory stays proportional
to the block size and track count, never the composition length. Peak detection,
normalization and limiting are single-pass block scans over a running scalar.
The limiter delays the signal by 1 ms through a ring buffer, ramps gain down over
that look-ahead window, releases over 100 ms, and clamps to a 0.95 ceiling.

Mixing reports the tracks mixed, muted and excluded, the peak before and after
limiting, and whether the result is silent. A track holding NaN or infinite
samples is excluded and reported as a degradation instead of poisoning the mix.

### Output audio

- An audio stream is muxed only when the mix peak is above -60 dBFS (`0.001`), or
  when `forceAudio` is set. Otherwise the encoded video is copied through, so a
  composition without audible audio has no audio stream.
- The video stream drives the output duration. An audio bed shorter than the
  video is padded with silence and a longer one is trimmed; both are reported.
- Codec, bitrate, bit depth and layout are validated before rendering starts:
  aac/ac3/eac3/flac into mp4 or mov, opus into webm, pcm_s24le into mov, and a
  lossless codec rejects an explicit bitrate.
- PCM is streamed to the encoder in 8192-frame blocks (32-bit float by default,
  24-bit for lossless requests) instead of building a whole WAV in memory.
- Mono becomes stereo by duplicating the sample across both pan legs; stereo
  becomes mono by averaging the channels. Downmixes are reported as degradations
  and every conversion is listed in the mix report.
- The muxed file is probed afterwards: stream count, codec and duration must
  match, otherwise the render fails and the staged artifact is removed.
- A mix failure is a coded error; `allowSilentAudio` opts into a silent result
  and records a degradation.

## Feature highlights

- Declarative compositions with tracks, sequences, groups, and split-screen layouts
- Rich clip types: video, image, text, shapes, SVG, particles, procedural noise, audio visualizers, data charts, stickers, gradient meshes, mesh warps, 3D text, glTF models
- Built-in effect library: blur, sharpen, denoise, vignette, color grading, film grain, glitch, bloom, neon glow, depth of field, chromatic aberration, LUTs, and more
- Transition library plus a plugin authoring API for custom transitions
- Audio pipeline: mixing, spatial panning, reverb, sidechain ducking, beat detection, MIDI input, text-to-speech
- Encoder pipeline: H.264/H.265/AV1/VP9/ProRes, two-pass VBR, alpha output, platform presets, chapters, thumbnails, subtitle burn-in, multi-resolution bundles
- Plugin system with node_modules auto-discovery and expanded lifecycle hooks
- Media resolvers for local files, HTTP(S), `s3://`, and `gs://` sources with caching
- Dev server inspector with HMR, arbitrary frame scrubbing, layer toggles, and a performance overlay
- JSON Schema generation for editor autocomplete and validation

## Configuration

```typescript
// cinecode.config.ts
import type { CinecodeConfig } from "cinecode";

export default {
  schemaVersion: 2,
  project: { name: "my-video", entry: "./main.ts", sourceDir: "./src", outputDir: "./output", cacheDir: ".cinecode/cache" },
  video: { title: "My Video", width: 1920, height: 1080, fps: 30, background: "#000000" },
  render: { format: "mp4", codec: "h264", quality: "final", platformPreset: "youtube-1080p" },
  audio: { sampleRate: 48000, channels: 2, masterVolume: 1 },
  autoDiscoverPlugins: true,
  ignorePatterns: ["tmp/**"],
} satisfies CinecodeConfig;
```

Environment variables are substituted at load time, with optional fallbacks:

```typescript
outputDir: "${OUTPUT_DIR:-./output}",
```

A missing variable without a fallback fails loading with the variable name and a fix hint. A `.cinecodeignore` file excludes media from sync and scanning using gitignore-style patterns with `!` negation.

## Dev server

```bash
npx cinecode dev
```

Open `http://localhost:3000` for the asset preview and `http://localhost:3000/inspector` for the inspector. The inspector provides click-to-seek scrubbing, frame stepping, playback, layer visibility toggles, a thumbnail strip, and a toggleable performance HUD. Saving a `.cinecode.ts` file triggers HMR without a page reload.

## CLI

Every command accepts the global options `--root <dir>`, `--config <path>`,
`--json`, `--no-color` and `--verbose`, in any position.

| Command | Purpose |
|---------|---------|
| `cinecode render --config <file>` | Render a composition to a file |
| `cinecode still <file>` | Render a single frame |
| `cinecode preview <file>` | Stream a preview |
| `cinecode dev` | Dev server with HMR and inspector |
| `cinecode edit <file>` | Open a composition in `$EDITOR` or print JSON with `--json` |
| `cinecode sync` | Verify media references, prune stale cache, report orphans and plugins |
| `cinecode compare <a> <b>` | Pixel-diff two compositions over a deterministic frame range |
| `cinecode benchmark <file>` | Measure frame time, p95, memory, and worker capacity |
| `cinecode upgrade` | Compare the installed version with npm, optionally self-update |
| `cinecode template [name]` | List or scaffold starter compositions |
| `cinecode doctor [--fix]` | Environment and project diagnostics with auto-repair |
| `cinecode health [--json]` | Compact CI-friendly system health report |

Exit codes: `0` success, `1` runtime failure, `2` usage error, `3` validation
failure, `4` environment failure, `130` cancelled.

Command aliases are opt-in: set `CINECODE_ALIASES=1` to expand them from
`cinecode.json`, `package.json#cinecode.aliases` and `~/.cinecode/config.json`
(project tables win over the global table). An alias never rewrites a known
command, expansion is bounded and cycle-safe, and an alias that resolves to no
command fails with a suggestion.
| `cinecode check` | Validate compositions and references |
| `cinecode preview` | Start read-only preview server and open viewer |
| `cinecode render-multi <file>` | Render a resolution bundle in one command |

## Advanced usage

### Plugin auto-discovery

Packages that declare a Cinecode marker are loaded automatically:

```json
{
  "name": "@studio/cinecode-transitions",
  "cinecodePlugin": { "entry": "./dist/index.js", "kind": ["transition"] }
}
```

```typescript
import { definePlugin, defineTransition, registerTransition } from "cinecode";

export default definePlugin({
  manifest: { name: "custom-transitions", version: "1.0.0", kind: "transition" },
  setup() {
    registerTransition(defineTransition({
      name: "zoom-in",
      duration: 0.5,
      params: { speed: { type: "number", default: 1, min: 0.1, max: 5 } },
      apply({ ctx, from, to, progress, width, height, params }) {
        const scale = 1 + progress * Number(params.speed);
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.scale(scale, scale);
        ctx.translate(-width / 2, -height / 2);
        ctx.drawImage(from, 0, 0);
        ctx.restore();
        ctx.globalAlpha = progress;
        ctx.drawImage(to, 0, 0);
      },
    }));
  },
});
```

Set `autoDiscoverPlugins: false` to load only plugins listed in the config.

### Lifecycle hooks

Plugins and inline handlers can observe or modify rendering:

```typescript
import { getPluginRegistry } from "cinecode";

const registry = getPluginRegistry();
registry.registerHook("afterFrame", async ({ canvas }) => {
  // draw a watermark on the frame canvas when one is available
  void canvas;
});
```

Available hooks: `beforeRender`, `afterRender`, `beforeFrame`, `afterFrame`, `beforeEncode`, `afterEncode`, `beforeMix`, `afterMix`, `onProgress`, `onWarning`, `onResolutionChange`, `onError`.

### Remote media

Media references may use local paths, `https://`, `s3://`, or `gs://`. Remote files are cached under `.cinecode/cache/media/remote`. S3 uses `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and optional `AWS_SESSION_TOKEN`/`AWS_ENDPOINT`. GCS uses `GCP_ACCESS_TOKEN` or `GCP_SERVICE_ACCOUNT_KEY`/`GOOGLE_APPLICATION_CREDENTIALS`.

```typescript
import { registerMediaResolver } from "cinecode";

registerMediaResolver({
  name: "internal-cdn",
  canResolve: (uri) => uri.startsWith("cdn://"),
  resolve: async (uri) => {
    const response = await fetch(uri.replace("cdn://", "https://cdn.example.com/"));
    return response.arrayBuffer();
  },
});
```

### 3D and canvas

Use `model3d`, `text3d`, skyboxes, PBR materials, shadows, and skeleton animation inside normal visual tracks. `cinecode preview` exposes a read-only WebSocket preview server with orbit, pan, and zoom camera controls.

### Rendering architecture

Rendering in Cinecode is entirely CPU-based via `@napi-rs/canvas` (Skia). No browser WebGPU or experimental GPU flags are required; output is 100% deterministic and pixel-identical across all supported Node.js environments.

## Editor support

Generate and use the JSON Schema:

```bash
pnpm --filter cinecode generate:schema
```

```json
{
  "json.schemas": [
    { "fileMatch": ["cinecode.config.json"], "url": "./node_modules/cinecode/cinecode.schema.json" }
  ]
}
```

## Documentation

- [API reference](../../docs/api-reference.md)
- [Examples gallery](../../docs/examples)
- [Migration guide](../../docs/migration.md)
- [Contributing](../../CONTRIBUTING.md)

## License

MIT
