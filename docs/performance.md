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
