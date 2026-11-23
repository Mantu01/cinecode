# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-11-19

### Added

- **Renderer Engine:** Deterministic worker-pool frame rendering with chunked scheduling, checkpoint resume, and bit-for-bit reproducible output.
- **Keyframe Engine:** Property interpolation for visual clips (`opacity`, `transform.x`, `transform.y`, `scale`, `width`, `letterSpacing`) with easing curves and spring physics.
- **Audio Pipeline:** Fixed 4096-frame chunk mixer with lookahead peak limiter (-0.05 dBFS), automated gain, fades, spatial panning, and sidechain ducking.
- **Output Muxing:** Single output-plan driving MP4, WebM, ProRes, MKV, AVI, animated GIF, APNG, PNG sequences, and multi-page PDF with verified alpha decode.
- **Shared Video Decode:** Host-level decode service with contiguous range coalescing and memory/disk caching, eliminating duplicate worker ffmpeg spawns.
- **Config & Manifest Contract:** Two-tier schema architecture (Zod authoring and normalized schema) with four distinct roots (`sourceDir`, `mediaDir`, `outputDir`, `cacheDir`).
- **Safe Migration:** Token-based AST config migration with `--dry-run` and backup support.
- **Plugin Sandbox:** Inert-by-default capability-based security model with explicit grants (`fs:read`, `fs:write`, `child_process`).
- **CLI Suite:** 30 canonical local-only commands including `render`, `still`, `dev`, `preview`, `generate`, `validate`, `doctor`, `health`, `inspect`, and `benchmark`.
- **Machine Output:** Structured single-document JSON envelope (`--json`) with execution status, timings, degradations, and artifacts for CI automation.
- **Canonical Scaffolder:** `create-cinecode` generator producing TypeScript and JavaScript projects with 1:1 parity from canonical templates.

### Removed

- **Network Telemetry & Uptime Probes:** Excised all background telemetry collectors and remote HTTP uptime checks.
- **Remote Marketplace Client:** Removed remote package repository client and external plugin tarball downloads.
- **Cloud Publishing:** Excised AWS S3 and Google Cloud Storage publishing integrations from the default package; local atomic publishing retained.
- **Remote Speech / Cloud TTS:** Removed external cloud text-to-speech services; local offline `system` speech synthesis retained.
- **Interactive Web Editor:** Retired the legacy interactive canvas editor; unified around read-only camera preview with WebSocket controls.
- **Inert Config Options:** Removed unused keys (`project.name`, `video.title`, `render.background`, `telemetry`, `logLevel`) with descriptive error hints.
