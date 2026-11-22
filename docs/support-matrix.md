# Support Matrix and Operational Limits

<!-- Generated automatically from runtime constants. Do not edit manually. -->

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

| Format | Container | Default Video Codec | Alpha Transparency Support | Audio Support | Extension |
| --- | --- | --- | --- | --- | --- |
| `mp4` | `mp4` (.mp4) | `h264` | No | aac | .mp4 |
| `webm` | `webm` (.webm) | `vp9` | No | opus | .webm |
| `prores` | `mov` (.mov) | `prores` | No | aac | .mov |
| `mkv` | `matroska` (.mkv) | `h264` | No | aac | .mkv |
| `avi` | `avi` (.avi) | `h264` | No | pcm_s24le | .avi |
| `gif` | `gif` (.gif) | `—` | No | No audio | .gif |
| `apng` | `apng` (.apng) | `—` | **Yes** (rgba) | No audio | .apng |
| `png` | `undefined` (—) | `—` | **Yes** (rgba) | No audio | — |
| `jpg` | `undefined` (.jpg) | `—` | No | No audio | .jpg |
| `webp` | `undefined` (.webp) | `—` | **Yes** (yuva420p) | No audio | .webp |
| `pdf` | `pdf` (.pdf) | `—` | No | No audio | .pdf |
| `webm-alpha` | `webm` (.webm) | `vp9` | **Yes** (yuva420p) | opus | .webm |
| `prores-alpha` | `mov` (.mov) | `prores` | **Yes** (yuva444p10le) | aac | .mov |

## Audio Constraints

- **Sample Rates:** `22050`, `44100`, `48000`, `96000` Hz.
- **Channel Layouts:** Mono (`1` channel), Stereo (`2` channels), 5.1 Surround (`6` channels).
- **Internal Precision:** 32-bit floating point PCM audio mixing in fixed 4096-frame blocks.
- **Output Bit Depth:** 16-bit or 24-bit lossless PCM.
- **Limiter:** Lookahead peak limiter with 1 ms lookahead, 100 ms release, -0.05 dBFS ceiling clamp.
- **No-audio optimization:** When audio peak is below -60 dBFS and `--force-audio` is unset, output video is produced without unnecessary empty audio tracks.

## Font Support

- **Supported Font Types:** OpenType (`.otf`), TrueType (`.ttf`), WOFF2 (`.woff2`).
