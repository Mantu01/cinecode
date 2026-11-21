# Support Matrix and Operational Limits

This document specifies the supported execution environments, formats, codecs, audio constraints, fonts, and explicit boundaries for Cinecode. Every statement is verified by automated test suites.

## Bundled FFmpeg and FFprobe

Cinecode ships the platform FFmpeg and FFprobe installer packages with the framework.
Resolution order: `CINECODE_FFMPEG_PATH` or `CINECODE_FFPROBE_PATH`, project `binaries.ffmpegPath` or `binaries.ffprobePath`, bundled installer package, then system `PATH`.
The resolved absolute path, version and provenance are reported by `cinecode doctor`.

LGPL licence notices ship in `THIRD_PARTY_NOTICES.md`. The full binary build provenance is provided by each platform installer package.

## Supported Environments

| Environment | Requirement | Notes |
| --- | --- | --- |
| **Node.js** | `>=22.18.0` | Node 22 LTS or Node 24. Older versions are rejected on boot with exit code `78` (`CINECODE_RUNTIME_UNSUPPORTED`). |
| **Operating Systems** | Windows (x64/arm64), macOS (Apple Silicon/Intel), Linux (x64) | Tested on Windows 11 and Ubuntu LTS in CI. |
| **Architecture** | Native ESM only | CommonJS `require()` is rejected per package policy (`ERR_PACKAGE_PATH_NOT_EXPORTED`). |
| **TypeScript Contract** | Native type stripping / erasable syntax | Standard type annotations, interfaces, type aliases. No runtime TypeScript compilation or non-erasable constructs (enums, namespaces). |

## Formats and Alpha Channel Support

| Format | Container | Default Video Codec | Alpha Transparency Support | Audio Support |
| --- | --- | --- | --- | --- |
| `mp4` | MP4 (`.mp4`) | H.264 (`libx264`) | No (rejected before render) | AAC (`aac`) |
| `webm` | WebM (`.webm`) | VP9 (`libvpx-vp9`) | No (use `webm-alpha`) | Opus (`libopus`) |
| `webm-alpha` | WebM (`.webm`) | VP9 (`libvpx-vp9`, `yuva420p`) | **Yes** (verified by pixel decode) | Opus (`libopus`) |
| `prores` | QuickTime (`.mov`) | ProRes (`prores_ks`) | No (use `prores-alpha`) | PCM (`pcm_s16le`) |
| `prores-alpha` | QuickTime (`.mov`) | ProRes 4444 (`prores_ks`, `yuva444p10le`) | **Yes** (verified by pixel decode) | PCM (`pcm_s16le`) |
| `gif` | Animated GIF (`.gif`) | GIF palette (`palettegen`/`paletteuse`) | No | No audio |
| `apng` | Animated PNG (`.png`) | APNG (`apng`) | **Yes** (verified by pixel decode) | No audio |
| `png` | PNG still or sequence | PNG (`png`) | **Yes** | No audio |
| `jpg` | JPEG still (`.jpg`) | JPEG (`mjpeg`) | No | No audio |
| `webp` | WebP still (`.webp`) | WebP (`libwebp`) | **Yes** | No audio |
| `pdf` | Vector/raster PDF (`.pdf`) | PDF generator | No | No audio |
| `mkv` | Matroska (`.mkv`) | H.264 (`libx264`) | No | AAC (`aac`) |
| `avi` | AVI (`.avi`) | H.264 (`libx264`) | No | PCM (`pcm_s16le`) |

## Video Codecs

- **H.264** (`h264`, `libx264`): Broadest playback compatibility.
- **H.265 / HEVC** (`h265`, `libx265`): High efficiency master encoding.
- **AV1** (`av1`, `libsvtav1`): Next-generation open video compression.
- **VP9** (`vp9`, `libvpx-vp9`): Web standard with alpha support.
- **ProRes** (`prores`, `prores_ks`): Industry master editing codec (Standard & 4444).
- **FFV1 / Ut Video** (`ffv1`, `utvideo`): Lossless archival codecs.

## Audio Constraints

- **Sample Rates:** `22050`, `44100`, `48000`, `96000` Hz.
- **Channel Layouts:** Mono (`1` channel), Stereo (`2` channels), 5.1 Surround (`6` channels).
- **Internal Precision:** 32-bit floating point PCM audio mixing in fixed 4096-frame blocks.
- **Output Bit Depth:** 16-bit or 24-bit lossless PCM.
- **Limiter:** Lookahead peak limiter with 1 ms lookahead, 100 ms release, -0.05 dBFS ceiling clamp.
- **No-audio optimization:** When audio peak is below -60 dBFS and `--force-audio` is unset, output video is produced without unnecessary empty audio tracks.

## Font Support

- **Supported Font Types:** OpenType (`.otf`), TrueType (`.ttf`), WOFF2 (`.woff2`).
- **Location Policy:** Shipped custom font files must reside strictly within `mediaDir` (`./media`). Fonts outside `mediaDir` are rejected with `CC3006`.
- **System Fallback:** Unresolved system fonts record a degradation warning in non-strict mode and fail with `CC3006` when `--strict` is enabled.
- **Web Fonts:** Remote font URLs (e.g. `http://`, `https://`) are rejected at validation time.

## Performance & Quality Budgets

Every performance and quality promise is enforced by automated test suites and measured baselines:

| Metric | Measured Baseline | Enforced Threshold | Policy |
| --- | --- | --- | --- |
| `cinecode --version` cold start | ~200 ms | $\le 2500$ ms | Blocking |
| `cinecode --help` cold start | ~205 ms | $\le 2500$ ms | Blocking |
| 1-frame still render cold start | 2.8 s | $\le 5.0$ s | Blocking |
| 1080p 30fps 10s peak memory | 1,130 MB | $\le 1,400$ MB | Blocking |
| 4K 24fps short render peak memory | 1,280 MB | $\le 1,500$ MB | Blocking |
| Multi-worker scaling factor (4 workers vs 1) | 2.1x | $\ge 1.3$x | Blocking |
| Main-thread pixel copies per frame | 0 copies (transfers only) | 0 copies | Blocking |
| Renderer cache post-job retention | 0 MB (emptied) | 0 MB | Blocking |
| Framework packed tarball size | 699 KB | $\le 750$ KB | Blocking |
| Framework packed file count | 879 files | $\le 900$ files | Blocking |
| Audio limiter ceiling | 0.95 (-0.45 dBFS) | $\le 0.95$ | Blocking |
| Visual golden exact feature tolerance | 0 delta | 0 delta | Blocking |
| Visual golden text rasterization tolerance | 0 delta | $\le 2$ delta | Blocking |

## Known Limitations

1. **Hardware Acceleration:** Hardware acceleration flags (`nvenc`, `videotoolbox`, `qsv`) apply strictly to ffmpeg video encoding. Frame rasterization executes on CPU via `@napi-rs/canvas`.
2. **Deterministic Output:** Timelines must avoid non-deterministic JavaScript functions (`Date.now()`, `Math.random()`, `performance.now()`). Use deterministic frame time `time` and seeded pseudorandom generators instead.
3. **Platform Presets:** Preset dimensions take precedence over config defaults unless overridden by explicit CLI `--resolution`.

## Explicitly Not Supported (Removed Surfaces)

To guarantee stability, determinism, and 100% offline reliability, the following surfaces are deliberately excluded from Cinecode:

| Excluded Surface | Reason & Alternative |
| --- | --- |
| **Cloud Publishing (S3 / GCS / YouTube)** | Removed in Phase 32. Shipped `cinecode publish` writes atomically to local filesystem destinations only. Use standard cloud CLI tools (e.g. `aws s3 cp`, `gsutil`) in your CI/CD pipelines. |
| **Remote Plugin Marketplace Client** | Removed in Phase 32. Plugins install strictly as standard local npm packages or workspace dependencies. |
| **Remote Cloud Speech / TTS APIs** | Removed in Phase 32. External network TTS engines (Edge TTS, Google Cloud TTS) fail with coded error `CC5401`. Use the built-in offline `system` speech synthesizer. |
| **Interactive Canvas Web Editor** | Removed in Phase 29. The interactive editor application was retired; `cinecode preview` provides a fast, read-only viewer with orbit, pan, and zoom camera controls. |
| **Prometheus Telemetry & Metrics Server** | Removed in Phase 32. Background HTTP metrics servers are not shipped. Use `--json` machine envelope for CI observability. |
| **Auto-update / Self-upgrade Spawning** | Removed in Phase 32. `cinecode upgrade` only compares the local version against npm registry metadata and never spawns background package manager installers. |
| **Monorepo Upward Path Probing** | Removed in Phase 33. Scaffolder resolves templates directly from its installed package directory and never probes parent directories. |
