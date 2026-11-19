# Architecture and System Invariants

This document serves as the canonical reference for architectural invariants, single ownership, configuration precedence, determinism guarantees, error handling, and resource budgets enforced across Cinecode (Phases 01–33).

## 1. The Project Contract and Four Distinct Roots

Every Cinecode project operates over four distinct directories defined in `cinecode.config.ts`:

```
my-film/
├── cinecode.config.ts  # Project settings and video quality
├── main.ts             # Central manifest registering assets & timelines
├── src/                # [sourceDir] Authored scene and timeline code
├── media/              # [mediaDir] Source assets (images, audio, fonts, video)
├── output/             # [outputDir] Rendered video, audio, images, scenes
└── .cinecode/cache/    # [cacheDir] Intermediate render chunks, checkpoints
```

### Invariants:
1. **Four distinct roots:** `sourceDir`, `mediaDir`, `outputDir`, and `cacheDir` must resolve to distinct, non-overlapping paths. None can be the project root or parent of another.
2. **Deterministic discovery:** Root discovery resolves either the explicit `--root`, explicit `--config`, or traverses upward to find `cinecode.config.ts`. If not found, commands fail with coded error `CC1001`.
3. **No monorepo probing:** Scaffolding and commands never search parent monorepo directories for templates or configs.
4. **Clean source tree:** Output and cache directories are ignored by default. Authored source and shipped media readme files are always tracked.

## 2. Precedence Order

When resolving configuration options (e.g. dimensions, FPS, quality, codec), Cinecode evaluates sources in a strictly defined precedence order:

$$\text{CLI Flag} > \text{Deliverable Preset} > \text{Config Key} > \text{Built-in Default}$$

- **CLI Flag:** Explicit user command-line flags (e.g. `--resolution 3840x2160`, `--quality lossless`).
- **Deliverable Preset:** Selected preset (e.g. `youtube-4k`, `tiktok`).
- **Config Key:** Value declared in `cinecode.config.ts`.
- **Built-in Default:** Safe baseline (1920x1080, 30 fps, H.264, final quality).

Run `cinecode render --explain` to inspect the exact origin of every resolved parameter.

## 3. Determinism Guarantees

Cinecode guarantees bit-for-bit reproducible renders given the same source inputs:

1. **Deterministic time:** Frame times are derived strictly from frame index and rational frame rate: `time = frame / fps`.
2. **Forbidden non-determinism:** Compositions must never call non-deterministic system functions (`Date.now()`, `Math.random()`, `performance.now()`). `cinecode validate` scans compositions and reports `CC3005` if non-deterministic functions are found.
3. **Seeded pseudorandomness:** Effects requiring randomness (noise, particles) take an explicit `seed` parameter.
4. **Cache identity digest:** Render cache checkpoints compute a digest of the input entry code, config parameters, and resolved media timestamps. Any change invalidates cached chunks cleanly.

## 4. Zero-Copy Frame Transport and Memory Model

Rendered pixels follow a strict transfer contract across thread boundaries:

1. **Canonical format:** RGBA, 8 bits per channel, straight alpha, tightly packed with stride `width * 4`, top row first.
2. **One copy floor:** Canvas pixels are read via `getImageData()` into an owned `ArrayBuffer` exactly once.
3. **Transfer list:** The buffer is transferred (`postMessage(msg, [buffer])`) without structured cloning.
4. **Direct pipe:** The main thread streams transferred frame views directly into ffmpeg's stdin without intermediate allocation.

### Memory Budgeting:
- Total budget: Configured via `--memory-budget` or `render.memoryBudgetMb` (default 512 MB, or 25% of system RAM).
- In-flight worker chunk share: Capped at 40% of the budget, divided evenly across worker threads.
- Encoder frame queue: The remaining 60% of the budget.
- Chunk size automatically shrinks before concurrency is reduced, preventing out-of-memory crashes on 4K renders.

## 5. Single Ownership of Critical Concerns

Every subsystem in Cinecode has exactly one authoritative owner:

| Concern | Authoritative Module | Invariant |
| --- | --- | --- |
| **Output Formats** | `packages/cinecode/src/core/output-plan.ts` | One canonical table defines all containers, codecs, and alpha rules. |
| **Audio Mixing** | `packages/cinecode/src/audio/mixer.ts` | 4096-frame chunk mixing with ring-buffer lookahead limiter. |
| **Worker Lifecycle** | `packages/cinecode/src/pipeline/workers.ts` | Single `WorkerManager` manages worker lifecycle and cleanup. |
| **Video Decoding** | `packages/cinecode/src/media/shared-decode.ts` | Host-level decode service coalesces frame requests across workers. |
| **Keyframe Interpolation** | `packages/cinecode/src/core/keyframes/engine.ts` | Pure property interpolation resolving time-to-frame keyframes. |
| **Error Handling** | `packages/cinecode/src/errors/index.ts` | Single coded error model (`CCxxxx`) with path, location, and fix hints. |

## 6. Error Model and Machine Output

- **Coded Errors:** Every error emitted by Cinecode carries a unique `CCxxxx` code, a human message, a fix hint, and source location (file, line, column).
- **Graceful Degradation:** Non-fatal anomalies (e.g. mono downmix, system font fallback) record a degradation entry without aborting the render. Under `--strict`, degradations are treated as fatal errors.
- **Machine Output:** Running any command with `--json` outputs a single newline-delimited JSON document matching `docs/machine-output.md` containing execution status, artifacts, degradations, and timing.
