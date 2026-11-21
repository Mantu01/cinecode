# Manifest reference (`main.ts`)

Every root manifest exports `defineMain({ ... })`. Each asset references an isolated source file under `src/`.

| Key | Type | Values | Description | Required |
| --- | --- | --- | --- | --- |
| `images[]` | array<ImageEntry> | — | Standalone still images | no |
| `images[].id` | string | — | Unique identifier referenced by CLI generate | yes |
| `images[].name` | string | — | Human-readable label | no |
| `images[].file` | string | — | Isolated image definition file under `src/` | yes |
| `images[].width` | number | — | Width in pixels | no |
| `images[].height` | number | — | Height in pixels | no |
| `images[].format` | "png" \| "jpg" \| "webp" | `"png"`, `"jpg"`, `"webp"` | Raster output format; vectors use `export-svg` | no |
| `images[].quality` | number | 0–100 | Quality for lossy formats | no |
| `images[].scaleFactor` | number | — | Multiplier for HiDPI/Retina exports | no |
| `images[].background` | string | — | Background colour for the still | no |
| `images[].seed` | number | — | Deterministic seed for procedural images | no |
| `audio[]` | array<AudioEntry> | — | Audio beds and synthesized tracks | no |
| `audio[].id` | string | — | Unique identifier referenced by timelines | yes |
| `audio[].name` | string | — | Human-readable label | no |
| `audio[].file` | string | — | Isolated audio definition file under `src/` | one of `file` or `src` |
| `audio[].src` | string | — | Audio file inside the media root | one of `file` or `src` |
| `audio[].sampleRate` | number | 22050, 44100, 48000, 96000 | Audio sample rate in Hz | no |
| `audio[].channels` | 1 \| 2 | `1`, `2` | Channel layout (mono or stereo) | no |
| `audio[].gain` | number | 0–4 linear (silent to +12 dB) | Placement gain; values outside the range are rejected | no |
| `audio[].duration` | number \| string | — | Duration in seconds or timecode | no |
| `scenes[]` | array<SceneEntry> | — | Visual scenes composed of tracks | no |
| `scenes[].id` | string | — | Unique identifier referenced by timelines | yes |
| `scenes[].name` | string | — | Human-readable label | no |
| `scenes[].file` | string | — | Isolated scene definition file under `src/` | yes |
| `scenes[].duration` | number \| string | — | Scene duration in seconds or timecode; must match the content | no |
| `scenes[].truncate` | boolean | — | Accept a shorter declared duration and report dropped frames | no |
| `scenes[].width` | number | — | Scene width override | no |
| `scenes[].height` | number | — | Scene height override | no |
| `scenes[].fps` | number | — | Scene frame rate override | no |
| `scenes[].background` | string | — | Scene background colour | no |
| `timelines[]` | array<TimelineEntry> | — | Top-level renderable compositions | no |
| `timelines[].id` | string | — | Unique timeline identifier (e.g. "main") | yes |
| `timelines[].name` | string | — | Human-readable title | no |
| `timelines[].file` | string | — | Isolated timeline definition file under `src/` | one of `file` or `sceneRefs` |
| `timelines[].sceneRefs` | array<string> | — | Scene IDs played back to back in array order | one of `file` or `sceneRefs` |
| `timelines[].audioRef` | array<string> | — | Audio beds mixed into the timeline | no |
| `timelines[].duration` | number \| string | — | Duration in seconds or timecode; must fit the content | no |
| `timelines[].truncate` | boolean | — | Accept a shorter declared duration and report dropped frames | no |
| `timelines[].width` | number | — | Timeline width override | no |
| `timelines[].height` | number | — | Timeline height override | no |
| `timelines[].fps` | number | — | Timeline frame rate override | no |
| `timelines[].background` | string | — | Timeline background colour | no |
| `timelines[].format` | string | see [output formats](./output-formats.md) | Render output format override | no |
| `timelines[].codec` | string | see [output formats](./output-formats.md) | Video codec override | no |
| `timelines[].quality` | string | `draft`, `preview`, `medium`, `final`, `lossless`, `low`, `high` | Quality preset override | no |

## Duration and truncation

A declared `duration` never truncates content silently. If the resolved content is longer
than the declaration by more than one frame, validation fails with `CC1010`, naming the
declared duration, the content duration and the frames that would be lost. Add
`truncate: true` to accept the cut: the run records a degradation that reports the frame
count. A declared duration longer than the content is allowed; the trailing time uses the
boundary mode and the run reports an informational note, not a warning.

## Scene sequencing

A timeline compiles either its `file` or its `sceneRefs`, never both. Scenes referenced by
`sceneRefs` play back to back in array order, with no implicit overlap and no implicit
transition. Each scene occupies exactly its resolved content duration; a declared scene
`duration` that differs from that content by more than one frame is an error, not an
overlap into the next scene. Build a cross-scene transition inside one scene file.

## Audio placement

Every registered audio asset referenced by `audioRef` is a bed: it starts at `0` and spans
the whole timeline duration. The manifest has no per-entry offset. `gain` is linear (`0`
silent, `1` unity, up to `4` / +12 dB) and is applied as the placement volume. Generated
audio is always written as WAV; `audio[].format` does not exist. A missing audio `src` is a
validation error that names the entry and the searched path before any decode starts.