# CLI Command Reference

<!-- Generated automatically from CLI command metadata. Do not edit manually. -->

Cinecode provides 30 canonical CLI commands for project authoring, diagnostics, rendering, and asset generation.

Informational commands (`help`, `version`, `licence`) print text on standard output only, write nothing on standard error, exit `0` and never emit the machine envelope.

A project entry file (`main.ts`) has exactly one accepted shape: `export default defineMain({ images, audio, scenes, timelines })`. A composition, timeline, scene, image or audio definition in `main.ts` is a contract error; definitions belong in the entry files the manifest references.

## Commands Overview

| Command | Category | Summary | Example |
| --- | --- | --- | --- |
| [`cinecode dev`](#dev) | `product` | Start the dev server with HMR | `cinecode dev --config ./cinecode.config.ts` |
| [`cinecode preview`](#preview) | `product` | Start the read-only preview server and open viewer | `cinecode preview --config ./cinecode.config.ts` |
| [`cinecode render`](#render) | `product` | Render timelines or a composition to a video | `cinecode render --config ./cinecode.config.ts` |
| [`cinecode still`](#still) | `product` | Render a single frame to PNG or JPEG | `cinecode still ./composition.ts --frame 0` |
| [`cinecode generate`](#generate) | `product` | Generate images, audio, scenes or timelines | `cinecode generate image --all` |
| [`cinecode validate`](#validate) | `product` | Validate configuration, compositions, media and fonts | `cinecode validate --config ./cinecode.config.ts` |
| [`cinecode clean`](#clean) | `product` | Delete cache and output directories | `cinecode clean --cache` |
| [`cinecode init`](#init) | `product` | Scaffold a new Cinecode project | `cinecode init my-film` |
| [`cinecode doctor`](#doctor) | `product` | Run environment and project health checks | `cinecode doctor --fix` |
| [`cinecode inspect`](#inspect) | `product` | Print the resolved timeline for a composition | `cinecode inspect ./composition.ts` |
| [`cinecode media`](#media) | `resource` | Manage project media files and cloud assets | `cinecode media list` |
| [`cinecode plugin`](#plugin) | `resource` | Manage installed plugins | `cinecode plugin list` |
| [`cinecode formats`](#formats) | `resource` | List input, output and planned media formats | `cinecode formats --json` |
| [`cinecode presets`](#presets) | `resource` | List platform deliverable presets | `cinecode presets --json` |
| [`cinecode thumbnail`](#thumbnail) | `resource` | Write poster images from the best frame | `cinecode thumbnail ./composition.ts` |
| [`cinecode export-svg`](#export-svg) | `resource` | Export frames as vector SVG graphics | `cinecode export-svg ./main.ts` |
| [`cinecode story`](#story) | `resource` | Generate a standalone web player bundle | `cinecode story ./main.ts` |
| [`cinecode tts`](#tts) | `resource` | Text-to-speech voice utilities | `cinecode tts voices` |
| [`cinecode compare`](#compare) | `resource` | Pixel-diff two compositions | `cinecode compare ./a.ts ./b.ts` |
| [`cinecode diff`](#diff) | `resource` | Semantic diff between compositions or revisions | `cinecode diff ./a.ts ./b.ts` |
| [`cinecode audit`](#audit) | `maintenance` | Scan dependencies and assets for licences | `cinecode audit --json` |
| [`cinecode benchmark`](#benchmark) | `maintenance` | Measure frame time, memory and worker capacity | `cinecode benchmark ./composition.ts` |
| [`cinecode migrate`](#migrate) | `maintenance` | Migrate the config schema to the latest version | `cinecode migrate ./cinecode.config.ts` |
| [`cinecode check-ignore`](#check-ignore) | `maintenance` | Check paths against .cinecodeignore rules | `cinecode check-ignore ./output/intro.mp4` |
| [`cinecode alias`](#alias) | `maintenance` | Manage shorthand CLI command aliases | `cinecode alias list` |
| [`cinecode publish`](#publish) | `maintenance` | Publish a rendered output to a destination | `cinecode publish ./output/videos/intro.mp4` |
| [`cinecode upgrade`](#upgrade) | `maintenance` | Compare the installed version with npm | `cinecode upgrade` |
| [`cinecode help`](#help) | `informational` | Show help for Cinecode commands | `cinecode help` |
| [`cinecode version`](#version) | `informational` | Show the Cinecode version | `cinecode version` |
| [`cinecode licence`](#licence) | `informational` | Show license information | `cinecode licence` |

## Command Details

### `cinecode dev` {#dev}

Start the dev server with HMR

- **Category:** `product`
- **Kind:** `read`
- **Surface Contract:** Reads: `[cinecode.config.ts, source timelines and assets]`, Writes: `[.cinecode/cache, .cinecode/spool]`
- **Requires Project:** `yes` (Selector: `optional`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `-p, --port <number>` | `number` | `3000` | Port to listen on | [1..65535] |
| `--host <host>` | `string` | `"127.0.0.1"` | Host to bind | — |
| `--open` | `boolean` | `false` | Open the preview in the browser | — |
| `--no-hmr` | `boolean` | `false` | Disable the HMR socket push | — |

#### Examples

```bash
cinecode dev --config ./cinecode.config.ts
```

### `cinecode preview` {#preview}

Start the read-only preview server and open viewer

- **Category:** `product`
- **Kind:** `read`
- **Surface Contract:** Reads: `[cinecode.config.ts, source timelines and assets]`, Writes: `[.cinecode/cache]`
- **Requires Project:** `yes` (Selector: `optional`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `-p, --port <number>` | `number` | `3000` | Port to listen on | [1..65535] |
| `--host <host>` | `string` | `"127.0.0.1"` | Host to bind | — |
| `--open` | `boolean` | `false` | Open the preview in the browser | — |
| `-T, --timeline <id>` | `string` | — | Timeline id from main.ts | — |
| `-s, --scene <id>` | `string` | — | Scene id from main.ts | — |

#### Examples

```bash
cinecode preview --config ./cinecode.config.ts
```

### `cinecode render` {#render}

Render timelines or a composition to a video

- **Category:** `product`
- **Kind:** `write`
- **Surface Contract:** Reads: `[cinecode.config.ts, source timelines and assets, .cinecode/cache]`, Writes: `[output video file, .cinecode/cache, .cinecode/spool]`
- **Requires Project:** `yes` (Selector: `selection`)
- **Aliases:** `render-multi`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--file <path>` | `path` | — | Standalone composition file (file mode) | — |
| `-c, --composition <name>` | `string` | — | Composition name (requires --file) | — |
| `-T, --timeline <id>` | `string` | — | Timeline id from main.ts | — |
| `-s, --scene <id>` | `string` | — | Scene id from main.ts | — |
| `--all` | `boolean` | `false` | Render every timeline (default when no selector is given) | — |
| `--preview` | `boolean` | `false` | Render preview quality (faster, appends .preview suffix) | — |
| `-o, --out <path>` | `path` | — | Output file path | — |
| `--from <time>` | `string` | — | Start time | — |
| `--to <time>` | `string` | — | End time (clamped with degradation CC4001 if exceeding duration) | — |
| `--format <format>` | `enum` | — | Output container format: mp4, mov, webm, gif, prores, wav, mp3 | `mp4`, `mov`, `webm`, `gif`, `prores`, `wav`, `mp3` |
| `--codec <codec>` | `enum` | — | Video codec: h264, h265, prores, vp9, av1, raw | `h264`, `h265`, `prores`, `vp9`, `av1`, `raw` |
| `-q, --quality <level>` | `enum` | — | Output quality level | `draft`, `preview`, `medium`, `final`, `lossless`, `low`, `high` |
| `--crf <n>` | `number` | — | Constant Rate Factor (0-51) | [0..51] |
| `--preset <name>` | `string` | — | Platform preset (youtube-1080p, youtube-4k, youtube-shorts, tiktok, instagram-reels, instagram-feed-square, instagram-feed-portrait, instagram-post, linkedin, twitter, vimeo-pro, broadcast-sdi, archival-master, web-gif, web-webp) | — |
| `--fps <n>` | `number` | — | Override composition framerate | [1..240] |
| `--resolution <WIDTHxHEIGHT>` | `string` | — | Override resolution | — |
| `--resolutions <list>` | `string` | — | Comma-separated resolutions to render | — |
| `--variants <list>` | `string` | — | Comma-separated variants to render | — |
| `--concurrency <n|auto>` | `string` | `"auto"` | Worker thread concurrency | — |
| `--chunk-size <frames>` | `number` | — | Frames per worker chunk | [1..10000] |
| `--hardware-acceleration <mode>` | `enum` | — | Encoder backend: auto, nvenc, videotoolbox, vaapi, none | `auto`, `nvenc`, `videotoolbox`, `vaapi`, `none` |
| `-r, --range <range>` | `string` | — | Frame range to render (e.g. 0-100) | — |
| `--dry-run` | `boolean` | `false` | Print render plan without rendering | — |
| `--fresh` | `boolean` | `false` | Ignore caches and render every frame anew | — |
| `--resume` | `boolean` | `false` | Resume from the last durable render checkpoint | — |
| `--no-cache` | `boolean` | `false` | Do not read or write the frame cache | — |
| `--overwrite` | `boolean` | `false` | Overwrite output file if it exists | — |
| `--allow-invalid` | `boolean` | `false` | Render even when timeline validation reports fatal issues | — |
| `--strict` | `boolean` | `false` | Fail when text glyphs fall back to another font family | — |
| `--seed <number>` | `number` | — | Random seed | [0..+∞] |
| `--memory-budget <bytes>` | `string` | `"1GB"` | Max memory for chunk buffers (e.g. 2GB, 512MB) | — |
| `--no-effects` | `boolean` | `false` | Disable all effects (fastest render) | — |
| `--effects <list>` | `string` | — | Comma-separated list of effects to apply | — |
| `--alpha` | `boolean` | `false` | Render with alpha channel (transparent background) | — |
| `--two-pass` | `boolean` | `false` | Enable two-pass video encoding | — |
| `--bitrate <rate>` | `string` | — | Video bitrate target (e.g. 5000k) | — |
| `--with-audio` | `boolean` | `false` | Keep an audio stream even when the mix is silent | — |
| `--audio-codec <codec>` | `enum` | — | Audio codec: aac, opus, ac3, eac3, flac, pcm_s24le | `aac`, `opus`, `ac3`, `eac3`, `flac`, `pcm_s24le` |
| `--audio-bitrate <kbps>` | `number` | — | Audio bitrate in kbps for lossy codecs | [8..1024] |
| `--color-management <space>` | `enum` | — | Color management mode: srgb or linear | `srgb`, `linear` |
| `--lut <path>` | `path` | — | Path to a .cube LUT file for color grading | — |
| `--gif-quality <n>` | `number` | — | GIF quality 1-8 | [1..8] |
| `--gif-dither <mode>` | `enum` | — | GIF dithering | `floyd-steinberg`, `sierra-2`, `atkinson`, `none` |
| `--gif-max-frames <n>` | `number` | — | Maximum frames in GIF output | [1..+∞] |
| `--list-presets` | `boolean` | `false` | List available platform presets | — |
| `--explain` | `boolean` | `false` | Print resolved parameters and their origins without rendering | — |

#### Examples

```bash
cinecode render --config ./cinecode.config.ts
cinecode render --file ./composition.ts
```

### `cinecode still` {#still}

Render a single frame to PNG or JPEG

- **Category:** `product`
- **Kind:** `write`
- **Surface Contract:** Reads: `[cinecode.config.ts, source timelines and assets]`, Writes: `[output image file]`
- **Requires Project:** `yes` (Selector: `selection`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--file <path>` | `path` | — | Standalone composition file (file mode) | — |
| `-c, --composition <name>` | `string` | — | Composition name (requires --file) | — |
| `-T, --timeline <id>` | `string` | — | Timeline id from main.ts | — |
| `-s, --scene <id>` | `string` | — | Scene id from main.ts | — |
| `-f, --frame <number>` | `number` | — | Frame number | [0..+∞] |
| `--time <time>` | `string` | — | Time (00:00:01.000) | — |
| `-o, --out <path>` | `path` | — | Output file path | — |
| `--format <format>` | `enum` | — | Output format: png, jpg, jpeg, webp | `png`, `jpg`, `jpeg`, `webp` |
| `--resolution <WIDTHxHEIGHT>` | `string` | — | Override resolution | — |
| `--seed <number>` | `number` | — | Random seed | [0..+∞] |
| `--dry-run` | `boolean` | `false` | Print render plan without rendering | — |
| `--explain` | `boolean` | `false` | Print resolved parameters and their origins without rendering | — |

#### Examples

```bash
cinecode still ./composition.ts --frame 0
```

### `cinecode generate` {#generate}

Generate images, audio, scenes or timelines

- **Category:** `product`
- **Kind:** `write`
- **Surface Contract:** Reads: `[prompt or input script, cinecode.config.ts]`, Writes: `[generated composition file]`
- **Requires Project:** `yes` (Selector: `none`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--id <id...>` | `string` | — | Only generate the given ids | — |
| `--all` | `boolean` | `false` | Generate everything without prompting | — |
| `-y, --yes` | `boolean` | `false` | Skip prompts and generate everything | — |
| `--out <dir>` | `path` | — | Output directory override | — |
| `--seed <number>` | `number` | — | Random seed | [0..+∞] |
| `--concurrency <number>` | `number` | `2` | Concurrent generations | [1..64] |
| `--dry-run` | `boolean` | `false` | Preview actions without generating | — |
| `--format <fmt>` | `string` | — | Media format override | — |
| `--force` | `boolean` | `false` | Regenerate even if files exist | — |

#### Examples

```bash
cinecode generate image --all
```

### `cinecode validate` {#validate}

Validate configuration, compositions, media and fonts

- **Category:** `product`
- **Kind:** `read`
- **Surface Contract:** Reads: `[cinecode.config.ts, source timelines and assets]`, Writes: `[none]`
- **Requires Project:** `yes` (Selector: `none`)
- **Aliases:** `check`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--mode <mode>` | `enum` | `"all"` | Validation mode: all, authoring-only, media, fonts | `all`, `authoring-only`, `media`, `fonts` |
| `--strict` | `boolean` | `false` | Treat warnings as errors | — |
| `--fix` | `boolean` | `false` | Auto-fix issues where possible | — |

#### Examples

```bash
cinecode validate --config ./cinecode.config.ts
```

### `cinecode clean` {#clean}

Delete cache and output directories

- **Category:** `product`
- **Kind:** `destructive`
- **Surface Contract:** Reads: `[.cinecode/cache, .cinecode/spool]`, Writes: `[.cinecode/cache, .cinecode/spool]`
- **Requires Project:** `yes` (Selector: `none`)
- **Aliases:** `sync`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--cache` | `boolean` | `false` | Empty cache directory | — |
| `--output` | `boolean` | `false` | Also empty output directory | — |
| `--all` | `boolean` | `false` | Clean both cache and output | — |
| `-y, --yes` | `boolean` | `false` | Skip confirmation prompt | — |
| `--force` | `boolean` | `false` | Skip confirmation prompt | — |
| `--dry-run` | `boolean` | `false` | Print what would be deleted without deleting | — |
| `--prune` | `boolean` | `false` | Prune stale cache entries | — |
| `--delete-orphans` | `boolean` | `false` | Delete detected orphaned assets | — |
| `--prune-stale-days <days>` | `number` | — | Prune cache entries unreferenced for N days instead of deleting everything | [0..+∞] |

#### Examples

```bash
cinecode clean --cache
```

### `cinecode init` {#init}

Scaffold a new Cinecode project

- **Category:** `product`
- **Kind:** `write`
- **Surface Contract:** Reads: `[target directory]`, Writes: `[project files, cinecode.config.ts, package.json]`
- **Requires Project:** `no`
- **Aliases:** `create`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `-t, --template <name>` | `string` | — | Project template name | — |
| `-n, --name <name>` | `string` | — | Project name | — |
| `-y, --yes` | `boolean` | `false` | Skip interactive questionnaire and use defaults | — |
| `--ts` | `boolean` | `true` | Use TypeScript | — |
| `--js` | `boolean` | `false` | Use JavaScript | — |
| `--fps <number>` | `number` | `30` | Frames per second | [1..240] |
| `--resolution <preset|WxH>` | `string` | `"1920x1080"` | Resolution preset or WxH | — |
| `--no-git` | `boolean` | `false` | Skip git initialization | — |
| `--skip-install` | `boolean` | `false` | Skip dependency installation | — |
| `--force` | `boolean` | `false` | Proceed even if directory is not empty | — |
| `--dry-run` | `boolean` | `false` | Print plan without writing files | — |

#### Examples

```bash
cinecode init my-film
```

### `cinecode doctor` {#doctor}

Run environment and project health checks

- **Category:** `product`
- **Kind:** `read`
- **Surface Contract:** Reads: `[system environment, ffmpeg binary, node binary, cinecode.config.ts]`, Writes: `[.gitignore (with --fix), .cinecode/cache (with --fix)]`
- **Requires Project:** `no`
- **Aliases:** `health`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--fix` | `boolean` | `false` | Auto-fix issues where possible | — |
| `--strict` | `boolean` | `false` | Exit non-zero when any issue is detected | — |
| `--cache <dir>` | `path` | — | Cache directory to inspect | — |

#### Examples

```bash
cinecode doctor --fix
```

### `cinecode inspect` {#inspect}

Print the resolved timeline for a composition

- **Category:** `product`
- **Kind:** `read`
- **Surface Contract:** Reads: `[cinecode.config.ts, source composition]`, Writes: `[none]`
- **Requires Project:** `yes` (Selector: `optional`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--file <path>` | `path` | — | Standalone composition file (file mode) | — |
| `-c, --composition <name>` | `string` | — | Composition name (requires --file) | — |
| `--timeline <id>` | `string` | — | Timeline id from main.ts | — |
| `--scene <id>` | `string` | — | Scene id from main.ts | — |
| `-f, --frame <number>` | `number` | — | Show clips active at frame | [0..+∞] |
| `--time <time>` | `string` | — | Show clips active at time | — |
| `--deep` | `boolean` | `false` | Generate deep dependency graph across audio, visual, and effects | — |
| `--format <format>` | `enum` | — | Graph output format: dot, mermaid, ascii | `dot`, `mermaid`, `ascii` |
| `--depth <number>` | `number` | `3` | Max clip nesting depth to display | [1..100] |

#### Examples

```bash
cinecode inspect ./composition.ts
```

### `cinecode media` {#media}

Manage project media files and cloud assets

- **Category:** `resource`
- **Kind:** `read`
- **Surface Contract:** Reads: `[cinecode.config.ts, media sources, network (download)]`, Writes: `[media directory, .cinecode/cache]`
- **Requires Project:** `yes` (Selector: `none`)
- **Aliases:** `media:list`, `media:download`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--type <video|audio|image>` | `enum` | — | Filter by media type | `video`, `audio`, `image` |
| `--missing` | `boolean` | `false` | Show only missing referenced media files | — |
| `-o, --out <path>` | `path` | — | Output file path | — |
| `--force` | `boolean` | `false` | Re-download existing files | — |
| `--confirm` | `boolean` | `false` | Explicitly allow network downloads | — |
| `--only <name>` | `string` | — | Download only the specified entry | — |

#### Examples

```bash
cinecode media list
cinecode media download
```

### `cinecode plugin` {#plugin}

Manage installed plugins

- **Category:** `resource`
- **Kind:** `read`
- **Surface Contract:** Reads: `[cinecode.config.ts, package.json, plugin manifests]`, Writes: `[plugin files (scaffold)]`
- **Requires Project:** `no`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--type <type>` | `enum` | `"effect"` | Plugin template type: effect, transition, audio-effect, clip-type | `effect`, `transition`, `audio-effect`, `clip-type` |
| `--desc <description>` | `string` | `""` | Plugin description | — |
| `-a, --author <author>` | `string` | `""` | Author name | — |

#### Examples

```bash
cinecode plugin list
```

### `cinecode formats` {#formats}

List input, output and planned media formats

- **Category:** `resource`
- **Kind:** `read`
- **Surface Contract:** Reads: `[ffmpeg encoders, system codecs]`, Writes: `[none]`
- **Requires Project:** `no`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| — | — | — | No command-specific options | — |

#### Examples

```bash
cinecode formats --json
```

### `cinecode presets` {#presets}

List platform deliverable presets

- **Category:** `resource`
- **Kind:** `read`
- **Surface Contract:** Reads: `[built-in presets, cinecode.config.ts]`, Writes: `[none]`
- **Requires Project:** `no`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--list-presets` | `boolean` | `false` | List available platform presets | — |

#### Examples

```bash
cinecode presets --json
```

### `cinecode thumbnail` {#thumbnail}

Write poster images from the best frame

- **Category:** `resource`
- **Kind:** `write`
- **Surface Contract:** Reads: `[source composition, cinecode.config.ts]`, Writes: `[thumbnail image file]`
- **Requires Project:** `yes` (Selector: `optional`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `-c, --composition <name>` | `string` | — | Composition name | — |
| `-o, --output-dir <dir>` | `path` | — | Output directory | — |
| `-n, --count <number>` | `number` | `3` | Number of candidates to list | [1..100] |
| `-f, --frame <number>` | `number` | — | Force a specific frame | [0..+∞] |
| `--format <png|jpg|webp>` | `enum` | `"png"` | Image format: png, jpg, webp | `png`, `jpg`, `webp` |
| `--seed <number>` | `number` | — | Random seed | [0..+∞] |

#### Examples

```bash
cinecode thumbnail ./composition.ts
```

### `cinecode export-svg` {#export-svg}

Export frames as vector SVG graphics

- **Category:** `resource`
- **Kind:** `write`
- **Surface Contract:** Reads: `[source composition, cinecode.config.ts]`, Writes: `[output svg file]`
- **Requires Project:** `yes` (Selector: `optional`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `-f, --frame <number>` | `number` | `0` | Single frame number to export | [0..+∞] |
| `-r, --range <range>` | `string` | — | Frame range to export (e.g. 0-60) | — |
| `-o, --out <path>` | `path` | `"./dist/svg"` | Output directory or file path | — |
| `--viewBox-precision <digits>` | `number` | `3` | Coordinate precision digits | [0..10] |
| `--optimize` | `boolean` | `false` | Run SVGO optimization passes | — |
| `-c, --composition <name>` | `string` | — | Composition name | — |

#### Examples

```bash
cinecode export-svg ./main.ts
```

### `cinecode story` {#story}

Generate a standalone web player bundle

- **Category:** `resource`
- **Kind:** `write`
- **Surface Contract:** Reads: `[cinecode.config.ts, source composition]`, Writes: `[storyboard image files]`
- **Requires Project:** `yes` (Selector: `optional`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `-o, --out <dir>` | `path` | `"./dist/story"` | Output directory for web bundle | — |
| `--title <title>` | `string` | `"Cinecode Review"` | Story title | — |
| `--board <path>` | `path` | — | Storyboard JSON path (auto-detects ./storyboard.json) | — |

#### Examples

```bash
cinecode story ./main.ts
```

### `cinecode tts` {#tts}

Text-to-speech voice utilities

- **Category:** `resource`
- **Kind:** `read`
- **Surface Contract:** Reads: `[text input, cinecode.config.ts, tts models]`, Writes: `[output audio file]`
- **Requires Project:** `no`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--list-voices` | `boolean` | `false` | List available voices | — |
| `--language <code>` | `string` | — | Filter voices by language or locale | — |
| `--search <text>` | `string` | — | Search voice names, locales and styles | — |
| `--provider <name>` | `string` | — | Filter voices by provider | — |

#### Examples

```bash
cinecode tts voices
```

### `cinecode compare` {#compare}

Pixel-diff two compositions

- **Category:** `resource`
- **Kind:** `read`
- **Surface Contract:** Reads: `[source compositions, cinecode.config.ts]`, Writes: `[diff image file (optional)]`
- **Requires Project:** `no`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `-n, --frames <number>` | `number` | `10` | Frames to compare | [1..10000] |
| `--seed <number>` | `number` | `42` | Deterministic seed | [0..+∞] |
| `--diff <path>` | `path` | — | Write a side-by-side diff image of the worst frame | — |
| `--composition-a <name>` | `string` | — | Composition name in first file | — |
| `--composition-b <name>` | `string` | — | Composition name in second file | — |

#### Examples

```bash
cinecode compare ./a.ts ./b.ts
```

### `cinecode diff` {#diff}

Semantic diff between compositions or revisions

- **Category:** `resource`
- **Kind:** `read`
- **Surface Contract:** Reads: `[source composition files, git revisions]`, Writes: `[none]`
- **Requires Project:** `no`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--format <format>` | `enum` | `"text"` | Output format: text or markdown | `text`, `markdown` |
| `--side-by-side` | `boolean` | `false` | Display terminal diff side-by-side | — |

#### Examples

```bash
cinecode diff ./a.ts ./b.ts
```

### `cinecode audit` {#audit}

Scan dependencies and assets for licences

- **Category:** `maintenance`
- **Kind:** `read`
- **Surface Contract:** Reads: `[rendered video file, ffmpeg binary]`, Writes: `[audit report file (optional)]`
- **Requires Project:** `yes` (Selector: `none`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--allow-copyleft` | `boolean` | `false` | Do not fail on copyleft licenses (e.g. GPL, AGPL) | — |

#### Examples

```bash
cinecode audit --json
```

### `cinecode benchmark` {#benchmark}

Measure frame time, memory and worker capacity

- **Category:** `maintenance`
- **Kind:** `read`
- **Surface Contract:** Reads: `[cinecode.config.ts, source composition]`, Writes: `[benchmark baseline file (optional)]`
- **Requires Project:** `yes` (Selector: `optional`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `-c, --composition-name <name>` | `string` | — | Composition name | — |
| `-n, --frames <number>` | `number` | `60` | Frames per run | [1..100000] |
| `--runs <number>` | `number` | `3` | Number of runs | [1..100] |
| `--seed <number>` | `number` | `42` | Deterministic seed | [0..+∞] |
| `--compare-baseline` | `boolean` | `false` | Compare results against historical baseline | — |
| `--fail-on-regression` | `boolean` | `false` | Exit with error code 1 if performance regresses > 5% | — |
| `--save-baseline` | `boolean` | `false` | Save this benchmark run as official baseline | — |

#### Examples

```bash
cinecode benchmark ./composition.ts
```

### `cinecode migrate` {#migrate}

Migrate the config schema to the latest version

- **Category:** `maintenance`
- **Kind:** `destructive`
- **Surface Contract:** Reads: `[cinecode.config.ts]`, Writes: `[migrated config file, backup file (.bak)]`
- **Requires Project:** `yes` (Selector: `none`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `-o, --out <path>` | `path` | — | Write migrated config to a new file instead of replacing in-place | — |
| `--backup` | `boolean` | `false` | Create a backup file (.bak) before modifying | — |
| `-y, --yes` | `boolean` | `false` | Skip interactive confirmation prompt for in-place migration | — |
| `--dry-run` | `boolean` | `false` | Print migrated config to stdout without modifying files | — |

#### Examples

```bash
cinecode migrate ./cinecode.config.ts
```

### `cinecode check-ignore` {#check-ignore}

Check paths against .cinecodeignore rules

- **Category:** `maintenance`
- **Kind:** `read`
- **Surface Contract:** Reads: `[.cinecodeignore, target paths]`, Writes: `[none]`
- **Requires Project:** `yes` (Selector: `none`)

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| — | — | — | No command-specific options | — |

#### Examples

```bash
cinecode check-ignore ./output/intro.mp4
```

### `cinecode alias` {#alias}

Manage shorthand CLI command aliases

- **Category:** `maintenance`
- **Kind:** `read`
- **Surface Contract:** Reads: `[.cinecode/profiles.json, cinecode.config.ts]`, Writes: `[.cinecode/profiles.json]`
- **Requires Project:** `no`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| — | — | — | No command-specific options | — |

#### Examples

```bash
cinecode alias list
```

### `cinecode publish` {#publish}

Publish a rendered output to a destination

- **Category:** `maintenance`
- **Kind:** `write`
- **Surface Contract:** Reads: `[rendered output file]`, Writes: `[destination directory]`
- **Requires Project:** `no`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `-d, --dest <dir>` | `path` | — | Local destination directory | — |
| `--tag <tag>` | `string` | — | Tag or release identifier | — |

#### Examples

```bash
cinecode publish ./output/videos/intro.mp4
```

### `cinecode upgrade` {#upgrade}

Compare the installed version with npm

- **Category:** `maintenance`
- **Kind:** `network`
- **Surface Contract:** Reads: `[package.json, npm registry]`, Writes: `[package.json, node_modules]`
- **Requires Project:** `no`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--confirm` | `boolean` | `false` | Explicitly allow the npm network request | — |

#### Examples

```bash
cinecode upgrade
```

### `cinecode help` {#help}

Show help for Cinecode commands

- **Category:** `informational`
- **Kind:** `read`
- **Surface Contract:** Reads: `[command registry]`, Writes: `[stdout]`
- **Requires Project:** `no`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| `--all` | `boolean` | `false` | Show all commands including maintenance and informational | — |

#### Examples

```bash
cinecode help
cinecode help render
cinecode help --all
```

### `cinecode version` {#version}

Show the Cinecode version

- **Category:** `informational`
- **Kind:** `read`
- **Surface Contract:** Reads: `[package.json]`, Writes: `[stdout]`
- **Requires Project:** `no`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| — | — | — | No command-specific options | — |

#### Examples

```bash
cinecode version
```

### `cinecode licence` {#licence}

Show license information

- **Category:** `informational`
- **Kind:** `read`
- **Surface Contract:** Reads: `[LICENSE file]`, Writes: `[stdout]`
- **Requires Project:** `no`
- **Aliases:** `license`

#### Options

| Flag | Type | Default | Description | Bounds / Choices |
| --- | --- | --- | --- | --- |
| — | — | — | No command-specific options | — |

#### Examples

```bash
cinecode licence
cinecode license
```
