# Changelog

All notable changes to the Cinecode monorepo and its packages will be documented in this file.

## [1.0.0] - 2026-11-19

### Highlights

- **Cinecode Framework (`cinecode`):** Initial stable 1.0.0 release of the local-only code-first media generation framework.
  - Multi-process worker pool rendering with reproducible chunk scheduling.
  - Comprehensive clip model (video, audio, text, image, shape, tts, subtitles).
  - Time, keyframe, and easing animation engines.
  - Fixed 4096-frame chunk audio mixer with limiter and ducking.
  - Unified output planner supporting MP4, WebM, ProRes, MKV, AVI, APNG, GIF, and PDF.
  - Local-only CLI with 30 canonical commands and structured machine JSON envelope (`--json`).
  - Preflight validation engine and doctor health diagnostic system.
  - Interactive read-only preview host with WebSocket live reload.
  - Zero network leakage; strict opt-in network boundaries on `media download` and `upgrade`.
- **Project Scaffolder (`create-cinecode`):** Initial stable 1.0.0 release.
  - Interactive project generator for TypeScript and JavaScript templates.
  - Configurable FPS, resolution, git initialization, and package installation.
