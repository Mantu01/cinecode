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


