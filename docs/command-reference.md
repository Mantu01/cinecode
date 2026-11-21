# CLI Command Reference

<!-- Generated automatically from CLI command metadata. Do not edit manually. -->

Cinecode provides 35 local CLI commands for project authoring, diagnostics, rendering, and asset generation.

Informational commands (`help`, `version`, `license`) print text on standard output only, write nothing on standard error, exit `0` and never emit the machine envelope.

A project entry file (`main.ts`) has exactly one accepted shape: `export default defineMain({ images, audio, scenes, timelines })`. A composition, timeline, scene, image or audio definition in `main.ts` is a contract error; definitions belong in the entry files the manifest references.

## Commands Overview

| Command | Summary | Example |
| --- | --- | --- |
| [`cinecode still`](#still) | Render a single frame to PNG or JPEG | `cinecode still ./composition.ts --frame 0` |
| [`cinecode render`](#render) | Render timelines or a composition to a video | `cinecode render --config ./cinecode.config.ts` |
| [`cinecode render-multi`](#render-multi) | Render one composition at multiple resolutions | `cinecode render-multi ./composition.ts` |
| [`cinecode preview`](#preview) | Start the read-only preview server and open viewer | `cinecode preview --config ./cinecode.config.ts` |
| [`cinecode validate`](#validate) | Validate configuration, compositions, media and fonts | `cinecode validate --config ./cinecode.config.ts` |
| [`cinecode check`](#check) | Validate authoring code before rendering | `cinecode check --config ./cinecode.config.ts` |
| [`cinecode doctor`](#doctor) | Run environment and project health checks | `cinecode doctor --fix` |
| [`cinecode health`](#health) | Report system health for CI | `cinecode health --json` |
| [`cinecode inspect`](#inspect) | Print the resolved timeline for a composition | `cinecode inspect ./composition.ts` |
| [`cinecode clean`](#clean) | Delete cache and output directories | `cinecode clean --cache` |
| [`cinecode media:list`](#medialist) | List media files in the project | `cinecode media:list --config ./cinecode.config.ts` |
| [`cinecode media:download`](#mediadownload) | Download cloud media into the source directory | `cinecode media:download --config ./cinecode.config.ts` |
| [`cinecode create`](#create) | Scaffold a new Cinecode project | `cinecode create my-film` |
| [`cinecode generate`](#generate) | Generate images, audio, scenes or timelines | `cinecode generate image --all` |
| [`cinecode dev`](#dev) | Start the dev server with HMR | `cinecode dev --config ./cinecode.config.ts` |
| [`cinecode formats`](#formats) | List input, output and planned media formats | `cinecode formats --json` |
| [`cinecode presets`](#presets) | List platform deliverable presets | `cinecode presets --json` |
| [`cinecode thumbnail`](#thumbnail) | Write poster images from the best frame | `cinecode thumbnail ./composition.ts` |
| [`cinecode edit`](#edit) | Open a composition in the editor or print it | `cinecode edit ./composition.ts` |
| [`cinecode sync`](#sync) | Verify media, prune cache, report orphans | `cinecode sync --json` |
| [`cinecode compare`](#compare) | Pixel-diff two compositions | `cinecode compare ./a.ts ./b.ts` |
| [`cinecode benchmark`](#benchmark) | Measure frame time, memory and worker capacity | `cinecode benchmark ./composition.ts` |
| [`cinecode upgrade`](#upgrade) | Compare the installed version with npm | `cinecode upgrade` |
| [`cinecode template`](#template) | List or scaffold starter compositions | `cinecode template list` |
| [`cinecode tts`](#tts) | Text-to-speech voice utilities | `cinecode tts voices` |
| [`cinecode plugin`](#plugin) | Manage installed plugins | `cinecode plugin list` |
| [`cinecode diff`](#diff) | Semantic diff between compositions or revisions | `cinecode diff ./a.ts ./b.ts` |
| [`cinecode story`](#story) | Generate a standalone web player bundle | `cinecode story ./main.ts` |
| [`cinecode export-svg`](#export-svg) | Export frames as vector SVG graphics | `cinecode export-svg ./main.ts` |
| [`cinecode audit`](#audit) | Scan dependencies and assets for licences | `cinecode audit --json` |
| [`cinecode alias`](#alias) | Manage shorthand CLI command aliases | `cinecode alias list` |
| [`cinecode init`](#init) | Scaffold a project through a questionnaire | `cinecode init my-film` |
| [`cinecode migrate`](#migrate) | Migrate the config schema to the latest version | `cinecode migrate ./cinecode.config.ts` |
| [`cinecode check-ignore`](#check-ignore) | Check paths against .cinecodeignore rules | `cinecode check-ignore ./output/intro.mp4` |
| [`cinecode publish`](#publish) | Publish a rendered output to a destination | `cinecode publish ./output/videos/intro.mp4` |

## Command Details

### `cinecode still` {#still}

Render a single frame to PNG or JPEG

**Usage:** `cinecode still ./composition.ts --frame 0`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--file <path>` | Standalone composition file (file mode) | `—` |
| `-c, --composition <name>` | Composition name (requires --file) | `—` |
| `-T, --timeline <id>` | Timeline id from main.ts | `—` |
| `-s, --scene <id>` | Scene id from main.ts | `—` |
| `-f, --frame <number>` | Frame number | `—` |
| `--time <time>` | Time (HH:MM:SS:FF, HH:MM:SS, MM:SS, 12.5s, 250ms, 12.5 (seconds), 30f or frames(30) (frame index)) | `—` |
| `-o, --out <path>` | Output file path | `—` |
| `--format <format>` | Output format: png, jpg, webp | `—` |
| `--resolution <WIDTHxHEIGHT>` | Override resolution | `—` |
| `--seed <number>` | Random seed | `—` |
| `--dry-run` | Print render plan without rendering | `false` |
| `--explain` | Print resolved parameters and their origins without rendering | `false` |

### `cinecode render` {#render}

Render timelines (main.ts) or a standalone composition file to MP4

**Usage:** `cinecode render --config ./cinecode.config.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--file <path>` | Standalone composition file (file mode) | `—` |
| `-c, --composition <name>` | Composition name (requires --file) | `—` |
| `-T, --timeline <id>` | Render a single timeline from main.ts | `—` |
| `-s, --scene <id>` | Render a single scene from main.ts | `—` |
| `--all` | Render every timeline | `false` |
| `--preview` | Render preview quality (faster) | `false` |
| `--quality <level>` | Quality: draft \| preview \| medium \| final \| lossless \| low \| high | `—` |
| `--codec <codec>` | Video codec: h264 \| h265 \| av1 \| prores \| vp9 \| ffv1 \| utvideo | `—` |
| `--crf <number>` | Override CRF (0 = lossless) | `—` |
| `--fps <number>` | Override FPS | `—` |
| `--resolution <WIDTHxHEIGHT>` | Override resolution | `—` |
| `-o, --out <path>` | Output file path | `—` |
| `--from <time>` | Start time (HH:MM:SS:FF, HH:MM:SS, MM:SS, 12.5s, 250ms, 12.5 (seconds), 30f or frames(30) (frame index)) | `—` |
| `--to <time>` | End time (HH:MM:SS:FF, HH:MM:SS, MM:SS, 12.5s, 250ms, 12.5 (seconds), 30f or frames(30) (frame index)) | `—` |
| `--concurrency <number\|auto>` | Number of worker threads | `—` |
| `--memory-budget <mb>` | Render memory budget in MiB (frames queued + chunks in flight) | `—` |
| `--chunk-size <frames>` | Frames per worker chunk (overrides the heuristic) | `—` |
| `--hardware-acceleration <mode>` | Encoder backend: auto \| nvenc \| videotoolbox \| qsv \| off | `—` |
| `--no-cache` | Disable render cache | `—` |
| `--fresh` | Ignore resume state, start fresh | `false` |
| `--resume` | Resume from the last durable render checkpoint | `false` |
| `--overwrite` | Overwrite existing output file | `false` |
| `--allow-invalid` | Render even when timeline validation reports fatal issues (recorded as a degradation) | `false` |
| `--strict` | Fail when text glyphs fall back to another font family | `false` |
| `--dry-run` | Print render plan without rendering | `false` |
| `--seed <number>` | Random seed | `—` |
| `--format <format>` | Output format: mp4, webm, prores, mkv, avi, gif, apng, png, jpg, webp, pdf, webm-alpha, prores-alpha | `—` |
| `--preset <name>` | Platform preset (youtube-1080p, youtube-4k, youtube-shorts, tiktok, instagram-reels, instagram-feed-square, instagram-feed-portrait, instagram-post, linkedin, twitter, vimeo-pro, broadcast-sdi, archival-master, web-gif, web-webp) | `—` |
| `--list-presets` | List available platform presets | `false` |
| `--gif-quality <n>` | GIF quality 1-8 (controls palette size) | `—` |
| `--gif-dither <mode>` | GIF dithering: floyd-steinberg, sierra-2, atkinson, none | `—` |
| `--gif-max-frames <n>` | Maximum frames in GIF output | `—` |
| `--lut <path>` | Path to a .cube LUT file for color grading | `—` |
| `--effects <list>` | Comma-separated list of effects to apply (blur,bloom,chromatic-aberration) | `—` |
| `--alpha` | Render with alpha channel (transparent background) | `—` |
| `--two-pass` | Enable two-pass video encoding | `—` |
| `--bitrate <rate>` | Video bitrate target (e.g. 5000k) | `—` |
| `--with-audio` | Keep an audio stream even when the mix is silent | `false` |
| `--audio-codec <codec>` | Audio codec: aac, opus, ac3, eac3, flac, pcm_s24le | `—` |
| `--audio-bitrate <kbps>` | Audio bitrate in kbps for lossy codecs | `—` |
| `--color-management <space>` | Color management mode: srgb or linear | `—` |
| `--explain` | Print resolved parameters and their origins without rendering | `false` |
| `--no-effects` | Disable all effects (fastest render) | `—` |

### `cinecode render-multi` {#render-multi}

Render one composition at multiple resolutions in a single run

**Usage:** `cinecode render-multi ./composition.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `-c, --composition <name>` | Composition name | `—` |
| `--variants <list>` | Comma-separated variants (480p,720p,1080p,WIDTHxHEIGHT) | `480p,720p,1080p` |
| `-o, --out <dir>` | Output directory | `—` |
| `--seed <number>` | Random seed | `—` |
| `--concurrency <number>` | Worker count | `—` |

### `cinecode preview` {#preview}

Start the read-only preview server and open viewer

**Usage:** `cinecode preview --config ./cinecode.config.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `-p, --port <number>` | Port to listen on | `—` |
| `--host <host>` | Host to bind | `—` |
| `--open` | Open the preview in the browser | `true` |
| `--no-open` | Do not automatically open browser | `false` |
| `--no-hmr` | Disable the HMR socket push | `—` |

### `cinecode validate` {#validate}

Validate configuration, compositions, media, and fonts

**Usage:** `cinecode validate --config ./cinecode.config.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--strict` | Treat warnings as errors | `false` |
| `--fix` | Auto-fix issues (currently: .gitignore) | `false` |

### `cinecode check` {#check}

Validate authoring code before rendering (no frames, no encode) — the CI pre-render gate

**Usage:** `cinecode check --config ./cinecode.config.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--strict` | Treat warnings as errors | `false` |

### `cinecode doctor` {#doctor}

Run environment and project health checks

**Usage:** `cinecode doctor --fix`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--fix` | Auto-fix issues where possible | `false` |

### `cinecode health` {#health}

Report ffmpeg, Node, worker, disk and canvas acceleration health (offline)

**Usage:** `cinecode health --json`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--cache <dir>` | Cache directory to inspect | `—` |
| `--strict` | Exit non-zero when any issue is detected | `—` |

### `cinecode inspect` {#inspect}

Print resolved timeline for a composition

**Usage:** `cinecode inspect ./composition.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--file <path>` | Standalone composition file (file mode) | `—` |
| `-c, --composition <name>` | Composition name (requires --file) | `—` |
| `--timeline <id>` | Timeline id from main.ts | `—` |
| `--scene <id>` | Scene id from main.ts | `—` |
| `-f, --frame <number>` | Show clips active at frame | `—` |
| `--time <time>` | Show clips active at time (HH:MM:SS:FF, HH:MM:SS, MM:SS, 12.5s, 250ms, 12.5 (seconds), 30f or frames(30) (frame index)) | `—` |
| `--deep` | Generate deep dependency graph across audio, visual, and effects | `false` |
| `--format <format>` | Graph output format: dot, mermaid, ascii | `—` |

### `cinecode clean` {#clean}

Delete cache and/or output directories

**Usage:** `cinecode clean --cache`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--output` | Also empty output directory | `false` |
| `--all` | Clean both cache and output | `false` |
| `--force` | Skip confirmation prompt | `false` |
| `--dry-run` | Print what would be deleted without deleting | `false` |
| `--prune-stale-days <days>` | Prune cache entries unreferenced for N days instead of deleting everything | `—` |

### `cinecode media:list` {#medialist}

List all media files in the project

**Usage:** `cinecode media:list --config ./cinecode.config.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `-o, --out <path>` | Output file path | `—` |

### `cinecode media:download` {#mediadownload}

Download cloud media files into media directory

**Usage:** `cinecode media:download --config ./cinecode.config.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--force` | Re-download existing files | `false` |
| `--confirm` | Explicitly allow network downloads | `—` |
| `--only <name>` | Download only the specified entry | `—` |

### `cinecode create` {#create}

Create a new Cinecode project

**Usage:** `cinecode create my-film`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--ts` | Use TypeScript (default) | `false` |
| `--js` | Use JavaScript | `false` |
| `--fps <number>` | Frames per second | `30` |
| `--resolution <preset\|WxH>` | Resolution preset or WxH | `1920x1080` |
| `--no-git` | Skip git initialization | `—` |
| `--local-link` | Link local workspace dependency | `false` |
| `--skip-install` | Skip dependency installation | `false` |
| `--force` | Proceed even if directory is not empty | `false` |
| `--dry-run` | Print plan without writing files | `false` |
| `-v, --verbose` | Verbose output | `false` |

### `cinecode generate` {#generate}

Generate images, audio, scenes, or timelines from main.ts

**Usage:** `cinecode generate image --all`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--id <id...>` | Only generate the given ids | `—` |
| `--all` | Generate everything without prompting | `false` |
| `-y, --yes` | Skip prompts and generate everything | `false` |
| `--out <dir>` | Output directory override | `—` |
| `--seed <number>` | Random seed | `—` |
| `--concurrency <number\|auto>` | Number of worker threads | `—` |
| `--overwrite` | Overwrite existing files | `false` |
| `--silent` | Suppress progress output | `false` |
| `--dry-run` | Resolve targets without writing | `false` |

### `cinecode dev` {#dev}

Start the dev server with granular HMR for scenes, images, and audio

**Usage:** `cinecode dev --config ./cinecode.config.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `-p, --port <number>` | Port to listen on | `—` |
| `--host <host>` | Host to bind | `—` |
| `--open` | Open the preview in the browser | `false` |
| `--no-hmr` | Disable the HMR socket push | `—` |

### `cinecode formats` {#formats}

List input, output and planned media formats

**Usage:** `cinecode formats --json`

### `cinecode presets` {#presets}

List platform deliverable presets (YouTube, TikTok, Instagram, X)

**Usage:** `cinecode presets --json`

### `cinecode thumbnail` {#thumbnail}

Pick the best frame of a composition and write poster images

**Usage:** `cinecode thumbnail ./composition.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `-c, --composition <name>` | Composition name | `—` |
| `-o, --output-dir <dir>` | Output directory | `—` |
| `-n, --count <number>` | Number of candidates to list | `5` |
| `-f, --frame <number>` | Force a specific frame | `—` |
| `--format <png\|jpg\|webp>` | Image format | `png` |
| `--seed <number>` | Random seed | `0` |

### `cinecode edit` {#edit}

Open a composition in your editor, or print it as JSON

**Usage:** `cinecode edit ./composition.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--editor <command>` | Editor command to launch | `—` |

### `cinecode sync` {#sync}

Verify referenced media exists, prune stale cache entries and report orphans

**Usage:** `cinecode sync --json`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `-d, --dir <path>` | Project directory | `.` |
| `--cache <dir>` | Media cache directory | `—` |
| `--no-prune` | Keep stale cache entries | `—` |
| `--no-plugins` | Skip plugin auto-discovery | `—` |
| `--ignore <pattern>` | Additional ignore pattern | `` |
| `--no-default-ignores` | Disable built-in ignore patterns | `—` |
| `--dry-run` | Preview sync operations without uploading, downloading or deleting | `false` |
| `--delete-orphans` | Delete detected orphaned assets | `false` |
| `-y, --yes` | Confirm destructive deletion of orphaned assets | `false` |

### `cinecode compare` {#compare}

Render two compositions and report per-frame pixel differences

**Usage:** `cinecode compare ./a.ts ./b.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `-n, --frames <number>` | Frames to compare | `60` |
| `--seed <number>` | Deterministic seed | `—` |
| `--diff <path>` | Write a side-by-side diff image of the worst frame | `—` |
| `--composition-a <name>` | Composition name in first file | `—` |
| `--composition-b <name>` | Composition name in second file | `—` |

### `cinecode benchmark` {#benchmark}

Measure per-frame render time, peak memory and regression tracking

**Usage:** `cinecode benchmark ./composition.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `-c, --composition-name <name>` | Composition name | `—` |
| `-n, --frames <number>` | Frames per run | `30` |
| `--runs <number>` | Number of runs | `3` |
| `--seed <number>` | Deterministic seed | `—` |
| `--compare-baseline` | Compare results against historical baseline | `false` |
| `--fail-on-regression` | Exit with error code 1 if performance regresses > 5% | `false` |
| `--save-baseline` | Save this benchmark run as official baseline | `false` |

### `cinecode upgrade` {#upgrade}

Check npm for a newer cinecode release

**Usage:** `cinecode upgrade`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--confirm` | Explicitly allow the npm network request | `—` |

### `cinecode template` {#template}

List or scaffold starter compositions

**Usage:** `cinecode template list`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--open` | Open the generated file in your editor | `—` |

### `cinecode tts` {#tts}

Text-to-speech voice utilities

**Usage:** `cinecode tts voices`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--list-voices` | List available voices | `false` |
| `--language <code>` | Filter voices by language or locale | `—` |
| `--search <text>` | Search voice names, locales and styles | `—` |
| `--provider <name>` | Filter voices by provider | `—` |

### `cinecode plugin` {#plugin}

Inspect and scaffold local Cinecode plugins

**Usage:** `cinecode plugin list`

### `cinecode diff` {#diff}

Semantic comparison between two compositions or git revisions

**Usage:** `cinecode diff ./a.ts ./b.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--format <format>` | Output format: text or markdown (use --json for machine output) | `text` |
| `--side-by-side` | Display terminal diff side-by-side | `false` |

### `cinecode story` {#story}

Generate a standalone interactive web player bundle for team review

**Usage:** `cinecode story ./main.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `-o, --out <dir>` | Output directory for web bundle | `./dist/story` |
| `--title <title>` | Story title | `Cinecode Review` |
| `--board <path>` | Storyboard JSON path (auto-detects ./storyboard.json) | `—` |

### `cinecode export-svg` {#export-svg}

Export composition frames as high-precision vector SVG graphics

**Usage:** `cinecode export-svg ./main.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `-f, --frame <number>` | Single frame number to export | `0` |
| `-r, --range <range>` | Frame range to export (e.g. 0-60) | `—` |
| `-o, --out <path>` | Output directory or file path | `./dist/svg` |
| `--viewBox-precision <digits>` | Coordinate precision digits | `3` |
| `--optimize` | Run SVGO optimization passes | `false` |
| `-c, --composition <name>` | Composition name | `—` |

### `cinecode audit` {#audit}

Scan dependencies, plugins, and media assets for licenses and security vulnerabilities

**Usage:** `cinecode audit --json`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--allow-copyleft` | Do not fail on copyleft licenses (e.g. GPL, AGPL) | `false` |

### `cinecode alias` {#alias}

Manage shorthand CLI command aliases

**Usage:** `cinecode alias list`

### `cinecode init` {#init}

Scaffold a new Cinecode project

**Usage:** `cinecode init my-film`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--ts` | Use TypeScript (default) | `false` |
| `--js` | Use JavaScript | `false` |
| `--fps <number>` | Frames per second | `30` |
| `--resolution <preset\|WxH>` | Resolution preset or WxH | `1920x1080` |
| `--no-git` | Skip git initialization | `—` |
| `--local-link` | Link local workspace dependency | `false` |
| `--skip-install` | Skip dependency installation | `false` |
| `--force` | Proceed even if directory is not empty | `false` |
| `--dry-run` | Print plan without writing files | `false` |
| `-v, --verbose` | Verbose output | `false` |

### `cinecode migrate` {#migrate}

Automatically migrate cinecode.config schema to the latest version

**Usage:** `cinecode migrate ./cinecode.config.ts`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--dry-run` | Preview the migration without writing files | `false` |
| `--backup` | Create a backup file (.bak) before modifying | `false` |
| `-y, --yes` | Skip interactive confirmation prompt for in-place migration | `false` |

### `cinecode check-ignore` {#check-ignore}

Check if paths match .cinecodeignore exclusion rules

**Usage:** `cinecode check-ignore ./output/intro.mp4`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `-v, --verbose` | Show detailed rule matching and line numbers | `false` |

### `cinecode publish` {#publish}

Publish a rendered output locally to a destination directory

**Usage:** `cinecode publish ./output/videos/intro.mp4`

#### Options

| Option | Description | Default |
| --- | --- | --- |
| `--dest <dir>` | Local destination directory | `—` |

## Platform presets

Generated from the single preset table; `--preset`, `render.platformPreset` and `presets --json` use the same values.

| ID | Size | FPS | Format | Codec | CRF | Encoder preset | Audio | Max file size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `youtube-1080p` | 1920x1080 | 30 | mp4 | h264 | 18 | fast | aac 192 kbps | none |
| `youtube-4k` | 3840x2160 | 30 | mp4 | h265 | 15 | medium | aac 384 kbps | none |
| `youtube-shorts` | 1080x1920 | 30 | mp4 | h264 | 20 | fast | aac 128 kbps | none |
| `tiktok` | 1080x1920 | 30 | mp4 | h264 | 20 | veryfast | aac 128 kbps | 287 MB |
| `instagram-reels` | 1080x1920 | 30 | mp4 | h264 | 20 | fast | aac 128 kbps | 400 MB |
| `instagram-feed-square` | 1080x1080 | 30 | mp4 | h264 | 20 | fast | aac 128 kbps | none |
| `instagram-feed-portrait` | 1080x1350 | 30 | mp4 | h264 | 20 | fast | aac 128 kbps | none |
| `instagram-post` | 1080x1080 | 30 | mp4 | h264 | 20 | fast | aac 128 kbps | none |
| `linkedin` | 1920x1080 | 30 | mp4 | h264 | 20 | fast | aac 128 kbps | none |
| `twitter` | 1920x1080 | 30 | mp4 | h264 | 20 | superfast | aac 128 kbps | 512 MB |
| `vimeo-pro` | 1920x1080 | 24 | mp4 | h264 | 15 | slow | aac 320 kbps | none |
| `broadcast-sdi` | 1920x1080 | 25 | prores | prores | 0 | slow | pcm_s24le 2304 kbps | none |
| `archival-master` | 1920x1080 | 24 | prores-alpha | prores | 0 | slow | pcm_s24le 2304 kbps | none |
| `web-gif` | 500x500 | 15 | gif | h264 | 0 | medium | none | 5 MB |
| `web-webp` | 1080x1080 | 30 | webp | h264 | 0 | medium | none | none |

## Validation warnings

`check` and `inspect` report these warnings once per command. `check --strict` turns every warning into a failure with exit code `3`.

| Code | Meaning |
| --- | --- |
| `CC3009` | An image, audio or scene entry is not referenced by any timeline. The entry stays valid as a direct `generate` or `render` target. |
| `CC3010` | A timeline declares `sceneRefs` that its `file` replaces. Remove one source. |

## Exit Codes

All CLI commands exit with standard codes indicating outcome:

| Code | Status | Meaning |
| --- | --- | --- |
| `0` | **success** | command completed |
| `1` | **runtime** | render, pipeline or unexpected failure |
| `2` | **usage** | invalid arguments, flags or command |
| `3` | **validation** | config, media, timeline or plugin validation failure |
| `4` | **environment** | missing binary or network failure |
| `78` | **unsupportedRuntime** | Node.js version below the declared minimum (exit 78, no other work done) |
| `130` | **cancelled** | cancelled by user or timeout |
