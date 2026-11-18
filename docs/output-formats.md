# Output formats

Generated from `OUTPUT_PLANS` in `src/core/output-plan.ts` — do not edit by hand.

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
