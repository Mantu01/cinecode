# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-11-13

### Added

- Renderer engine: worker-pool frame rendering with chunked scheduling, resume support, frame error policies, and a circuit breaker
- Memory budgeting for render chunks with soft warnings and hard over-budget errors
- Audio pipeline: mixing, spatial panning, reverb, sidechain ducking, beat detection, MIDI transport sync, and text-to-speech clips
- 3D system: glTF model loading, camera controls, lighting presets, and WebGPU-first rendering with canvas fallback
- Particle system: collision boundaries, velocity smoothing, debug overlays, and MIDI-synced emitters
- Subtitles: ASS/SSA parsing alongside SRT/VTT, with crossfade dissolve between entries
- Config migration engine with dry-run mode and env var substitution (`${VAR}` / `${VAR:-default}`)
- Plugin sandbox: capability policies, denied globals, module allowlist, and violation reporting
- Marketplace client: registry search, package download with retry/backoff, tarball extraction, and signature verification
- Observability: Prometheus metrics server (`/metrics`, `/health`) and NDJSON structured logging (`--json`)
- CLI: storyboarding from `storyboard.json`, publish to local/S3/GCS destinations, dev-server metrics
- Canvas interaction protocol: WebSocket client for external control of the dev-server canvas
- JSON Schema generation with CI schema-drift verification
- Packaging: `exports`, `typesVersions`, ESM build, and schema artifact in `files`
- Examples: basic API manifest project, launch intro, procedural shorts, and SQL-driven video

### Fixed

- Color parsing, hold easing, timecode FPS detection, and audio import regressions
- Canvas pool memory growth and duplicate type declarations
- Worker memory-budget accounting: in-flight allocations now scale the budget by concurrency and report usage at violation time
