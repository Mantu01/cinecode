# Output formats

Generated from `OUTPUT_PLANS` in `src/core/output-plan.ts` and `INPUT_SUPPORT` in `src/media/formats.ts` — do not edit by hand.

| Format | Strategy | Container | Video codecs | Alpha | Audio | Extension |
| --- | --- | --- | --- | --- | --- | --- |
| `mp4` | stream | `mp4` | h264, h265, av1 | no | aac (aac, ac3, eac3, flac) | .mp4 |
| `webm` | stream | `webm` | vp9, av1 | yes (yuva420p) | opus (opus) | .webm |
| `prores` | stream | `mov` | prores | yes (yuva444p10le) | aac (aac, ac3, eac3, flac, pcm_s24le) | .mov |
| `mkv` | stream | `matroska` | h264, h265, av1, vp9, ffv1, utvideo | no | aac (aac, opus, ac3, eac3, flac, pcm_s24le) | .mkv |
| `avi` | stream | `avi` | h264, utvideo | no | pcm_s24le (pcm_s24le, ac3) | .avi |
| `gif` | animation | `gif` | — | no | — | .gif |
| `apng` | animation | `apng` | — | yes (rgba) | — | .apng |
| `png` | sequence | `directory` | — | yes (rgba) | — | — |
| `jpg` | still | `file` | — | no | — | .jpg |
| `webp` | still | `file` | — | yes (yuva420p) | — | .webp |
| `pdf` | document | `pdf` | — | no | — | .pdf |
| `webm-alpha` | stream | `webm` | vp9 | yes (yuva420p) | opus (opus) | .webm |
| `prores-alpha` | stream | `mov` | prores | yes (yuva444p10le) | aac (aac, ac3, eac3, flac, pcm_s24le) | .mov |

## Input formats

Accepted as media input, including formats that are not render outputs.

| Format | Kind | Status | Direction | Producer | Note |
| --- | --- | --- | --- | --- | --- |
| `png` | image | implemented | both | `src/pipeline/image-output.ts` | raster still and frame sequence |
| `jpg` | image | implemented | both | `src/pipeline/image-output.ts` | Single JPEG still of the first requested frame |
| `webp` | image | implemented | both | `src/pipeline/image-output.ts` | Single WebP still with alpha |
| `gif` | image | implemented | both | `src/pipeline/image-output.ts` | single-frame decode; animated GIF is a render output |
| `svg` | image | implemented | input | — | SVG clip input; `export-svg` writes vector frames |
| `wav` | audio | implemented | both | `generate audio` | generated beds are always WAV |
| `mp3` | audio | implemented | input | — | — |
| `flac` | audio | implemented | input | — | — |
| `aac` | audio | implemented | input | — | — |
| `ogg` | audio | implemented | input | — | — |
| `opus` | audio | implemented | input | — | — |
| `m4a` | audio | implemented | input | — | — |

## Command-produced formats

Written by a command, not by the render output table.

| Format | Kind | Status | Direction | Producer | Note |
| --- | --- | --- | --- | --- | --- |
| `frames` | video | implemented | output | `src/pipeline/image-output.ts` | PNG/JPG/WebP frame sequence for interchange |
| `sprite-sheet` | other | implemented | output | `src/encoder/outputs.ts` | texture atlas from rendered frames with metadata |
| `data-export` | other | implemented | output | `src/encoder/data-export.ts` | manifest JSON, clip report, timecode log |

## Planned formats

Not accepted by any command; asking for one is a `CC1008` unsupported-format error.

| Format | Kind | Status | Direction | Producer | Note |
| --- | --- | --- | --- | --- | --- |
| `bmp` | image | planned | input | — | — |
| `tiff` | image | planned | input | — | — |
| `archive` | other | planned | output | — | frame-sequence zip archive |
