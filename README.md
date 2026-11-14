# Cinecode

Programmatic media creation for filmmakers and developers. Describe a video, animation, or interactive canvas in TypeScript, then render it to MP4, WebM, GIF, PNG sequence, or PDF with a deterministic pipeline.

Cinecode treats compositions as code: timelines, clips, effects, audio, and 3D scenes are typed objects you can compose, diff, test, and reuse. Plugins, resolvers, and lifecycle hooks extend every stage of the render.

## Quick start

```bash
pnpm add cinecode
```

```typescript
// hello.cinecode.ts
import { composition, timeline, track, text, solid } from "cinecode";

export default composition({
  name: "hello",
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 5,
  rootTimeline: timeline(
    track("background", [solid("#0b0b0f", { duration: 5 })]),
    track("title", [
      text("Hello, Cinecode", 96, {
        start: 0.5,
        duration: 4,
        x: 960,
        y: 540,
        align: "center",
        fill: "#ffffff",
        transitionIn: { name: "fade", duration: 0.6 },
      }),
    ]),
  ),
});
```

```bash
npx cinecode render --props hello.cinecode.ts --out hello.mp4
```

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

| Command | Purpose |
|---------|---------|
| `cinecode render --props <file>` | Render a composition to a file |
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
| `cinecode check` | Validate compositions and references |
| `cinecode canvas serve` | Interactive drawing canvas server |
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

Use `model3d`, `text3d`, skyboxes, PBR materials, shadows, and skeleton animation inside normal visual tracks. `cinecode canvas serve` exposes a WebSocket canvas protocol with bounded undo/redo history and layer reordering.

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

- [API reference](docs/api-reference.md)
- [Examples gallery](docs/examples)
- [Migration guide](docs/migration.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT
