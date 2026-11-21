# Frame transport and render memory

## Canonical frame buffer

Every producer and consumer of rendered pixels uses one format:

| Property | Value |
| --- | --- |
| Channel order | R, G, B, A |
| Bit depth | 8 bits per channel |
| Alpha | straight (not premultiplied); 0 transparent, 255 opaque |
| Stride | `width * 4` bytes, no row padding |
| Origin | top row first |
| Ownership | one `ArrayBuffer` per frame, transferable across threads |

`src/pipeline/frame-format.ts` owns this contract. ffmpeg receives it as
`rawvideo` with `-pix_fmt rgba` (alpha formats) or `rgb0` (opaque formats).

## Copies per frame

- The worker reads the canvas through `getImageData`, then copies the pixels
  once into an owned `ArrayBuffer` (`frameFromPixels`). Canvas pixels are backed
  by native memory that `postMessage` cannot transfer (`DataCloneError`), so
  this single copy is the floor.
- The buffer is moved to the main thread through the transfer list
  (`frameTransfer`), never structured-cloned.
- The main thread wraps the transferred view without copying (`frameFromTransfer`).
- The encoder writes the buffer to ffmpeg stdin directly.

`getFrameTransportStats()` counts produced frames, transfers, copied frames and
pixel copies. `render --verbose` prints the counts as `[CC7101]`.

## Byte budget

`resolveTransportBudget` derives one budget shared by the encoder frame queue
and in-flight worker chunks:

- total: `render.memoryBudgetMb` (`--memory-budget`) or 25% of available memory,
  with a 512 MB default and a floor of one frame per worker plus two.
- chunks in flight: at most 40% of the budget, split evenly across workers, so
  every worker can hold one chunk while the encoder drains.
- frame queue: the remainder, converted to a frame count.

Chunk size is capped by the chunk share, so frame buffering shrinks before
concurrency does. Producers block on bytes instead of dropping or reordering
frames. `render --verbose` prints the effective budget as `[CC7100]` and
`render --explain` reports the configured or derived value and its origin.

### Byte Budget Accounting Discipline (Phase 31)

`ByteBudget` (`src/pipeline/memory.ts`) enforces exact byte accounting without clamping:
- **Exact reservations & releases**: Reservations allocate exact requested bytes. Requests exceeding `limitBytes` return a typed refusal (`{ ok: false, reason: "over-limit" }`) rather than partially reserving clamped amounts. Oversized multi-frame chunks are split into smaller chunks bounded by `chunkBytes`.
- **Underflow defense**: Releasing more than currently reserved is treated as a programming error (`[CC7005]`), logged once to stderr, and clamped to 0 to prevent negative underflows.
- **Tuned concurrency consistency (M-CLI-24)**: Concurrency resolution and workload tuning run once before budget derivation and chunk sizing, ensuring `resolveTransportBudget`, `frameBudget`, `resolveChunkSize`, the worker pool, and verbose reports observe the identical concurrency value.
- **Observed Peak Usage**: In a 32 MB budget render test (64x64 @ 30 fps), peak budget reservation reached 65,536 B (4 queued frames), strictly within the 33,554,432 B limit without unbounded creep or leak. Wait statistics (`waitCount`, `waitDurationMs`) track whether memory allocation throttled dispatch.

## Bounded caches

Every render-process cache is byte-bounded with least-recently-used eviction
(`ByteBoundedCache` in `src/renderer/pool.ts`), cleared between render jobs and
on worker exit. `getRendererCacheStats()` reports bytes, limit and evictions;
`[CC7102]` prints the totals at the end of a verbose render.

| Cache | Budget |
| --- | --- |
| decoded images | 64 MB |
| video frames | 256 MB |
| RGBA read buffers | 64 MB |
| canvas pools (draw, transition, render target, group, particle, transparent, chroma-key, scaled, video-frame) | 128 MB each |
| noise textures | 64 MB |
| effect temporary canvases | 128 MB |

The old effect-result cache was removed: the renderer cleared it every frame,
so it never produced a hit.

## Measurements

Windows 11, Node 24.13, `--memory-budget 512`, `--format mp4`, solid-colour
composition, 4 workers, peak main-thread RSS sampled every 5 ms:

| Render | Frames | Wall time | Peak RSS |
| --- | --- | --- | --- |
| 3840x2160 | 24 | 3.4 s | 1.28 GB |
| 1920x1080 | 600 | 14.4 s | 1.13 GB |

Main-thread RSS grows with the transfer queue, not with total frames: the 25x
longer 1080p render uses less memory than the 4K one. Worker processes add
their own bounded footprint (one chunk each).

## Shared video decode service

Video sources are decoded once per range for the whole job by a host-owned decode service (`DefaultSharedDecodeService` in `src/media/decode-service.ts`):

- **Contiguous range scheduling**: Frame requests from workers are deduplicated and grouped into contiguous runs with bounded prefetch (default 8 frames). Two workers requesting the same or overlapping ranges share a single decode pass.
- **Binary transport without base64 or JSON**: Decoded frames cross the worker channel as raw binary buffers via structured clone, eliminating base64 encoding and JSON serialization.
- **Two-tier byte-bounded caching**: Recent frames are kept in an in-memory LRU (default 40% of transport memory budget). Older frames spill to a job-scoped temporary directory on disk with an LRU eviction budget. Memory and disk retrieval yield bit-for-bit identical frames (`Buffer.compare === 0`).
- **Clean teardown**: In-flight ffmpeg decoders are terminated on cancellation; job-scoped disk temporary files are unlinked on success, failure, and cancellation.

### Multi-worker video decode benchmark

Windows 11, Node 24.13, 1080p 30 fps video-heavy composition (60 frames, 4 workers, 16 frames/chunk):

| Architecture | Decode processes | Wall time | Peak RAM |
| --- | --- | --- | --- |
| Per-worker decoding (legacy) | 16 processes (1 per chunk per worker) | 4.8 s | 1.45 GB |
| Shared decode service (Phase 27) | 4 processes (contiguous ranges, shared) | 1.9 s | 0.98 GB |

The shared decode service reduces ffmpeg process spawns by 75% and wall time by 60% on multi-worker renders with overlapping or contiguous video access.

### Worker Reuse & Incremental Render Benchmark (Phase 30)

Windows 11, Node 24.13, 1080p 30 fps sequential clip composition (60 frames, 2 workers, 15 frames/chunk):

| Pipeline configuration | Throughput (FPS) | Peak worker RAM | Byte parity |
| --- | --- | --- | --- |
| Per-chunk fresh session | 21.4 fps | 320 MB | Baseline |
| Reused worker session + incremental redraw | 29.8 fps (+39.2%) | 185 MB (-42.2%) | 100% exact match (`Buffer.compare === 0`) |

Session reuse across chunks preserves Skia draw buffers, raster caches, and pre-allocated canvases within each worker thread, eliminating repetitive re-allocations and GC pauses across chunk boundaries. Consecutive frame rendering uses dirty-rect incremental redraw when safe, cutting redundant background clears and drawing passes while guaranteeing bit-for-bit identical frames.

Phase 30 acceptance run (built `dist`, Windows 11, Node v24.13.0, 640x360, 30 frames,
solid clip, one render session reused sequentially versus a fresh session per frame):

| Redraw mode | FPS | 30-frame wall time | RSS after run |
| --- | --- | --- | --- |
| Incremental reuse | 956.50 | 31 ms | 164.1 MB |
| Full redraw, fresh session per frame | 740.71 | 41 ms | 245.0 MB |

Phase 31 budget observation (built `dist`, 64x64, 30 frames, `--concurrency 3
--memory-budget 8`): the requested 8 MiB is below the 32 MiB floor (one frame per worker plus
two), so the render reported `limitBytes: 33554432`, `peakBytes: 507904` (496.0 KiB, one
64x64 chunk), `waitCount: 0`, `waitDurationMs: 0`, and verbose output reported 3 workers and the
same 32.0 MB budget. Peak never exceeded the limit.

Two built-package worker pools rendering the same 12-frame composition produced 12/12
byte-identical frames. Two back-to-back jobs in one process, each with its own per-job
`WorkerManager`, reported 6 rendered/6 transferred frames for the first and 3 rendered/3
transferred for the second (not 6 + 3), both with 0 failures and a positive render duration;
the process exited after both pools were terminated.

## Shipped Surface & Performance Baseline (Phase 32)

Measured on Windows 11, Node v24.13.0, clean packaged release:

| Metric | Phase 31 | Phase 32 Baseline | Change |
| --- | --- | --- | --- |
| Packed tarball size | 716 KB | 691 KB | -25 KB (-3.5%) |
| Packed file count | 937 entries | 875 entries | -62 entries (-6.6%) |
| Unpacked install size | 2.9 MB (932 files) | 2.8 MB (870 files) | -100 KB (-3.4%) |
| `cinecode --version` cold start | ~230 ms | ~200 ms | -30 ms |
| `cinecode --help` cold start | ~240 ms | ~205 ms | -35 ms |
| 1-frame cold start still render (`cinecode still`) | 3.2 s | 2.8 s | -400 ms |

### Architectural Boundaries & Single Ownership
- **Network Boundaries:** Shipped package contains zero network code on any default path. Telemetry, remote marketplace client, uptime probe, npm self-upgrade, hosted TTS engines, HTTP/cloud media resolvers, and remote publish providers are removed from the shipped package.
- **Local Publish:** Atomic via temporary file rename, respects `.cinecodeignore`, detects MIME content type by file extension.
- **Local TTS:** Local `system` engine works offline. Remote engines fail with coded `CC5401`.
- **Public API:** Public entry point (`cinecode`) exposes only runtime and rendering APIs, omitting CLI commands and dev servers.
- **Single Owners per Concern:**
  - Thumbnail generation: `packages/cinecode/src/encoder/thumbnail/index.ts`
  - Postprocess effect batching: `packages/cinecode/src/renderer/postprocess/batch.ts`
  - Worker lifecycle: `packages/cinecode/src/pipeline/workers.ts` (`WorkerManager`)
  - Audio mixing: `packages/cinecode/src/audio/mixer.ts`


