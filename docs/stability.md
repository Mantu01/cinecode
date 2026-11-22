# API Surface Stability & Governance

This document defines the stability classification, compatibility commitments, and deprecation policy for Cinecode public surfaces.

---

## 1. Classification Model

Cinecode classifies all exported APIs and CLI interfaces into three tiers:

| Tier | Compatibility Guarantee | Deprecation Notice | Target Audience |
| --- | --- | --- | --- |
| **Stable** | Strictly backward-compatible across SemVer minor/patch | At least 1 minor release before removal in major | All end users & automation |
| **Experimental** | May evolve across minor versions with release notes | Not required | Power users, plugin authors |
| **Internal** | No compatibility guarantee; subject to change | Not required | Core engine implementation only |

---

## 2. Surface Directory

### 2.1 Stable Surfaces

The following subpaths and interfaces are guaranteed stable:

- **Root API (`cinecode`)**:
  - Authoring: `defineComposition`, `defineSequence`, `defineConfig`, `renderComposition`
  - Clip builders: `textClip`, `videoClip`, `imageClip`, `shapeClip`, `audioClip`, `ttsClip`, `subtitleClip`
  - Canvas drawing & PiP: `drawCanvasFrame`, `drawPictureInPicture`
  - Animation & Loops: `interpolate`, `interpolateKeyframes`, `computeLoopOffset`, `createOscillator`
  - Configuration & Schema: `loadConfig`, `validateConfig`, `SCHEMA_VERSION`, `CONFIG_FILE_NAMES`
  - Coded Errors & Degradations: `ErrorCode`, `createError`, `isCinecodeError`, `formatCinecodeError`, `recordDegradation`, `getDegradations`, `clearDegradations`
  - Machine Envelope & Diagnostics: `runReport`, `EXIT_CODES`, `exitCodeForError`, `createLogger`
- **Core Domain (`cinecode/core`)**:
  - Composition and timeline object model
  - Time conversion and grammar utilities (`timeInputToFrames`, `durationToFrames`, `framesToSeconds`)
  - Keyframe evaluation and easing curves
  - Composition diff engine (`diffCompositions`)
- **CLI Commands & Machine Contract**:
  - Command line arguments, flags, and options for all standard verbs (`render`, `generate`, `inspect`, `doctor`, `still`, `dev`, `config`, `init`, `media download`, `upgrade`)
  - Structured machine output envelope format (`--json`):
    ```json
    {
      "schemaVersion": 2,
      "runId": "...",
      "command": "...",
      "timestamp": "...",
      "durationMs": 0,
      "success": true,
      "result": {},
      "degradations": [],
      "errors": []
    }
    ```
  - Exit code mapping (`0` success, `1` user error, `2` validation/config, `3` pipeline/render, `4` system/io).

---

### 2.2 Experimental Surfaces

The following domain subpaths are functional and public but may receive signature adjustments across minor versions as standards evolve:

- `cinecode/effects` — Built-in visual shaders, blurs, color grading, distortion effects
- `cinecode/transitions` — Transition definitions and GLSL blend shaders
- `cinecode/audio` — Synthesizer engines, audio mixing, WAV encoder, DSP graph
- `cinecode/plugin` — Plugin registry, lifecycle hooks, and plugin loader
- `cinecode/pipeline` — Resource planning, global memory cache, render orchestrator
- `cinecode/extensions` — Extension loader and capability hooks
- `cinecode/binary` — System binary probe and resolution
- `cinecode/observability` — Performance tracing and diagnostic reports
- `cinecode/model-3d` — 3D scene graph, OBJ/GLTF parsers, raymarching, displacement
- `cinecode/text-3d` — 3D typography and font mesh generation
- `cinecode/particles` — GPU/CPU particle system simulation
- `cinecode/midi` — MIDI track decoding and timeline mapping
- `cinecode/tts` — Text-to-speech synthesize bindings
- `cinecode/svg` — SVG frame serializer and vector clip rendering
- `cinecode/pdf` — Multi-page PDF document compiler
- `cinecode/dataviz` — Chart rendering (bar, line, pie, area)
- `cinecode/subtitles` — Subtitle parsing (SRT, VTT) and burner renderer

---

### 2.3 Internal Surfaces

Any module not exposed in `package.json#exports` is strictly internal. This includes:

- Multi-process worker harnesses and IPC protocols
- Intermediate buffer pooling and scratch storage internals
- Dev preview server websockets and hot-reload state
- Binary resolution memoization tables

---

## 3. Deprecation Policy

1. **Marking**: Deprecated APIs are tagged with JSDoc `@deprecated` and log a structured degradation warning (`CC7001`) via `recordDegradation()`.
2. **Grace Period**: A deprecated stable interface will remain functional for at least one minor release before removal in the next major version.
3. **Migration Path**: Deprecation notices must provide a clear replacement target in the diagnostic message.
