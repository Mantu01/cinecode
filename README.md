# Cinecode

Code-first media generation framework for developers and creators. Author animations, motion graphics, video timelines, and procedural audio directly in TypeScript or JavaScript, then render master videos with a deterministic pipeline.

## Runtime & Authoring Contract

- **Node.js Requirement:** Node `>=22.18.0` (tested on Node 22 LTS and Node 24). Older runtimes exit with error code `78` (`CINECODE_RUNTIME_UNSUPPORTED`).
- **Module Architecture:** Native ESM only (`"type": "module"`).
- **TypeScript Contract:** Native type stripping. Erasable TypeScript syntax is accepted (type annotations, interfaces, type aliases). Non-erasable syntax (enums, namespaces) is not supported. Use explicit file extensions (`.ts` / `.js`) in relative imports.

## Quickstart

Scaffold a clean project with the interactive questionnaire or CLI flags:

```bash
# Using npm
npm create cinecode my-film

# Or with pnpm
pnpm create cinecode my-film --ts
```

Navigate to the project and run the dev server or render a master:

```bash
cd my-film
npm run dev      # Start dev server with Granular HMR
npm run render   # Render all timelines to output/videos/
```

## The Four Project Roots

Every project configuration defines four non-overlapping roots:

```
my-film/
├── cinecode.config.ts  # Project settings and video quality
├── main.ts             # Central manifest registering assets & timelines
├── src/                # [sourceDir] Authored scene and timeline source code
├── media/              # [mediaDir] Source assets (images, audio, fonts, video)
├── output/             # [outputDir] Rendered video, audio, images, scenes
└── .cinecode/cache/    # [cacheDir] Intermediate chunk cache & checkpoints
```

## Configuration & Manifest Contract

### `cinecode.config.ts`

Controls global project settings and output quality. The renderer never silently downgrades output:

```typescript
import { defineConfig } from "cinecode";

export default defineConfig({
  schemaVersion: 2,
  project: {
    entry: "./main.ts",
    sourceDir: "./src",
    mediaDir: "./media",
    outputDir: "./output",
    cacheDir: ".cinecode/cache",
  },
  video: {
    width: 1920,
    height: 1080,
    fps: 30,
    background: "#0a0a0a",
  },
  render: {
    format: "mp4",
    quality: "final",
    codec: "h264",
    preset: "slow",
    concurrency: "auto",
  },
  audio: {
    sampleRate: 48000,
    channels: 2,
  },
});
```

### `main.ts`

The central asset manifest. Every entry references an isolated file under `src/` so it can be generated, previewed, and cached independently:

```typescript
import { defineMain } from "cinecode";

export default defineMain({
  images: [
    { id: "thumbnail", file: "./src/images/thumbnail.ts", format: "png" },
  ],
  audio: [
    { id: "ambient", file: "./src/audio/ambient.ts", duration: 6 },
  ],
  scenes: [
    { id: "intro", file: "./src/scenes/intro.ts", duration: 6 },
  ],
  timelines: [
    { id: "main", duration: 6, sceneRefs: ["intro"], audioRef: ["ambient"] },
  ],
});
```

## Fast Authoring Model

**Animate properties, do not emit a clip per frame.**

Instead of creating hundreds of clips in loops, define persistent visual clips with `keyframes`. A single text or shape clip can span the entire scene while animating opacity, position, scale, or letter spacing smoothly on the fly. This reduces composition JSON data by over 99% and significantly accelerates rendering.

```typescript
import { defineScene, timeline, track, text, shape } from "cinecode";

export default defineScene("intro", 6, () =>
  timeline([
    track("background", [
      shape("rectangle", {
        width: 1920,
        height: 1080,
        fill: "#0a0a0a",
        opacity: 0,
        keyframes: { opacity: [[0, 0], [0.8, 1, "easeOutCubic"]] },
        start: 0,
        duration: 6,
      }),
    ]),
    track("title", [
      text("CINECODE", 96, {
        fill: "#f5f0e8",
        opacity: 0,
        transform: { x: 480, y: 440 },
        keyframes: {
          opacity: [[0, 0], [0.5, 1, "easeOutCubic"]],
          "transform.y": [[0, 480], [0.8, 440, "easeOutExpo"]],
        },
        start: 0.5,
        duration: 5.5,
      }),
    ]),
  ]),
);
```

## Commands

| Command | Purpose | Example |
| --- | --- | --- |
| `cinecode render` | Render timelines or compositions to video | `cinecode render --config ./cinecode.config.ts` |
| `cinecode still` | Render a single frame to PNG or JPEG | `cinecode still --config ./cinecode.config.ts --frame 0` |
| `cinecode dev` | Start development server with Granular HMR | `cinecode dev --config ./cinecode.config.ts` |
| `cinecode preview` | Start read-only preview viewer with camera controls | `cinecode preview --config ./cinecode.config.ts` |
| `cinecode generate` | Interactively generate images, audio, scenes | `cinecode generate image --all` |
| `cinecode validate` | Validate config, compositions, media, and fonts | `cinecode validate --config ./cinecode.config.ts` |
| `cinecode doctor` | Inspect environment and project health | `cinecode doctor --fix` |
| `cinecode clean` | Delete render cache and intermediate chunks | `cinecode clean --cache` |
| `cinecode inspect` | Print resolved timeline tracks and clips | `cinecode inspect --config ./cinecode.config.ts` |

For all 30 canonical commands and detailed flag options, see the [CLI Command Reference](docs/command-reference.md).

## Documentation

- [CLI Command Reference](docs/command-reference.md) — Exhaustive reference of all 30 commands, flags, and exit codes.
- [Configuration Reference](docs/config-reference.md) — Field-by-field reference for `cinecode.config.ts` and `main.ts`.
- [Support Matrix & Limits](docs/support-matrix.md) — Supported Node versions, OS platforms, video/audio formats, and limitations.
- [Architecture & Invariants](docs/architecture.md) — Design contracts, precedence order, zero-copy pipeline, and determinism.
- [Output Formats](docs/output-formats.md) — Specifications for MP4, WebM, ProRes, APNG, GIF, and PDF output.
- [Performance Benchmarks](docs/performance.md) — Shipped size baselines, frame transport timings, and decode benchmarks.
- [Migration Guide](docs/migration.md) — Upgrading from Schema v1 to Schema v2.

## License

MIT
