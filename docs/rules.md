# Cinecode Architecture Rules and Contracts

This document is the single source of truth for project contracts, filesystem shape, determinism guarantees, CLI behavior, preview constraints, and source code standards.

---

## 1. Project Shape and the Four Roots

A Cinecode project is strictly scoped to four isolated, non-overlapping directory roots:

| Root | Config Key | Default Path | Purpose | Access Policy |
| --- | --- | --- | --- | --- |
| **Source** | `sourceDir` | `src/` | Authored code: scenes, timelines, audio definitions, shader modules | Read-only to pipeline |
| **Media** | `mediaDir` | `media/` | Static media assets: videos, audio clips, images, fonts, LUTs | Read-only to pipeline |
| **Output** | `outputDir` | `output/` | Emitted artifacts: rendered videos, still frames, audio mixes | Write-target |
| **Cache** | `cacheDir` | `.cinecode/cache/` | Frame chunks, cache indexes, decoded media buffers, checkpoints | Pipeline managed |

### Invariants:
1. **Four distinct roots:** None of the four roots can be the project root or the parent of another root.
2. **Deterministic boundary:** Every input file read by the pipeline must reside in `sourceDir` or `mediaDir`. Every output file must reside in `outputDir` or `cacheDir`.
3. **No file fabrication:** The engine never creates phantom manifest or config files in user directories without explicit user command consent.

---

## 2. Configuration and Manifest Shape

Cinecode supports two authoring modes:

1. **Project Mode (Standard):**
   - Config file: `cinecode.config.ts` (or `.js` / `.json`) at project root exporting `defineConfig({...})`.
   - Manifest file: `main.ts` inside `sourceDir` exporting `defineMain({ images, audio, scenes, timelines })`.
   - Compositions and timelines are data-only references in `main.ts`; actual definitions live in referenced modular files under `sourceDir`.

2. **File Mode (Standalone):**
   - Invoked via `--file <path>`. Standalone TypeScript/JavaScript file default-exporting a `Composition` object.
   - Operates without a project manifest or configuration file.

---

## 3. Determinism Contract

- **Bit Determinism:** Two renders with identical project inputs, parameters, seed, fonts, and frame window produce identical bytes and identical SHA-256 digests.
- **Cache Identity:** Cache identity hashes every pixel-affecting input: composition tree, clips, effects, fonts, seed, frame window, color space settings, and alpha mode.
- **Alpha Pipeline:** Straight-alpha output is preserved without dark fringes at borders. Alpha mode (`straight` or `none`) is explicitly reported in machine output.
- **Color Pipeline:** Configured working and output color spaces are applied deterministically and reported in the machine result.
- **Forbidden Non-Determinism:** Compositions must never call non-deterministic system functions (`Date.now()`, `Math.random()`, `performance.now()`). Validation reports `CC3005` if detected.

---

## 4. CLI Behavior Standards

1. **Stream Separation:** `stdout` is reserved strictly for machine output (e.g. `--json`). Human progress, diagnostics, spinners, and logs write strictly to `stderr`.
2. **Machine Envelope:** When `--json` is passed, Cinecode emits **exactly one** valid JSON document on `stdout` matching the schema in [machine-output.md](machine-output.md).
3. **Exit Codes:**
   - `0`: Success
   - `1`: General fatal error (`CC9001`, `CC9002`)
   - `2`: CLI usage / syntax error (`CC1001`, `CC1003`, `CC1012`)
   - `3`: Validation error (`CC1002`, `CC1009`, `CC1010`, `CC1013`)
   - `4`: Pipeline / render error (`CC4001` - `CC4009`)
   - `5`: Audio / mixing error (`CC5001`, `CC5101`)
   - `6`: Resource budget error (`CC7001`)
   - `130`: Cancellation via SIGINT / AbortSignal

---

## 5. Preview Server Contract

1. **Loopback Only:** Binds strictly to loopback (`127.0.0.1`). Network binding (`0.0.0.0` or external IP) requires explicit `--allow-network` opt-in.
2. **Read-Only Protocol:** The WebSocket protocol is strictly read-only. Permitted client verbs are `hello`, `ping`, `frame`, and `status:request`.
3. **Transport Rejection:** Non-read-only actions (`play`, `seek`, `scrub`, `toggleLayer`, `edit`) are explicitly rejected with coded error `CC1014`.
4. **Interactive Constraints:** Only 2D zoom/pan and 3D camera orbit are interactive in the viewer. There is no timeline scrubber or layer toggle.
5. **Lifecycle & Clean Dispose:** Per-session frame cache and state are destroyed immediately upon WebSocket disconnect.

---

## 6. Source Code & Engine Invariants

1. **File Size Limit:** Every source file in `packages/cinecode/src` and `packages/create-cinecode/src` must remain strictly **under 400 lines**. Modules exceeding 400 lines must be partitioned into focused sub-modules.
2. **TypeScript Authoring:** Native type stripping only. Non-erasable syntax (enums, namespaces, parameter properties) is forbidden. Relative imports must specify explicit extensions (`.js` or `.ts`).
3. **Coded Errors:** Every error emitted by Cinecode carries a unique `CCxxxx` code from the catalog in [error-codes.md](error-codes.md), a clear cause description, and an actionable `fixHint`.
4. **Zero Git Operations:** The CLI, scaffolder, and core engine never perform git commits, pushes, tags, or branch switches.
