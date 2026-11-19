# Manifest reference (`main.ts`)

Every root manifest exports `defineMain({ ... })`. Each asset references an isolated source file under `src/`.

| Key | Type | Values | Description | Required |
| --- | --- | --- | --- | --- |
| `images[]` | array<ImageEntry> | — | Standalone still images | no |
| `images[].id` | string | — | Unique identifier referenced by CLI generate | yes |
| `images[].name` | string | — | Human-readable label | no |
| `images[].file` | string | — | Isolated image definition file under `src/` | no |
| `images[].width` | number | — | Width in pixels | no |
| `images[].height` | number | — | Height in pixels | no |
| `images[].format` | "png" \| "jpg" \| "webp" \| "svg" | `"png"`, `"jpg"`, `"webp"`, `"svg"` | Output still format | no |
| `images[].quality` | number | 0–100 | Quality for lossy formats | no |
| `images[].scaleFactor` | number | — | Multiplier for HiDPI/Retina exports | no |
| `audio[]` | array<AudioEntry> | — | Audio beds and synthesized tracks | no |
| `audio[].id` | string | — | Unique identifier referenced by timelines | yes |
| `audio[].name` | string | — | Human-readable label | no |
| `audio[].file` | string | — | Isolated audio definition file under `src/` | no |
| `audio[].kind` | "voice" \| "music" \| "sfx" \| "other" | `"voice"`, `"music"`, `"sfx"`, `"other"` | Category of audio asset | no |
| `audio[].sampleRate` | number | 22050, 44100, 48000, 96000 | Audio sample rate in Hz | no |
| `audio[].channels` | 1 \| 2 | `1`, `2` | Channel layout (mono or stereo) | no |
| `audio[].gain` | number | — | Base gain multiplier | no |
| `audio[].duration` | number \| string | — | Duration in seconds or timecode | no |
| `scenes[]` | array<SceneEntry> | — | Visual scenes composed of tracks | no |
| `scenes[].id` | string | — | Unique identifier referenced by timelines | yes |
| `scenes[].name` | string | — | Human-readable label | no |
| `scenes[].file` | string | — | Isolated scene definition file under `src/` | no |
| `scenes[].duration` | number \| string | — | Scene duration in seconds or timecode | no |
| `timelines[]` | array<TimelineEntry> | — | Top-level renderable compositions | no |
| `timelines[].id` | string | — | Unique timeline identifier (e.g. "main") | yes |
| `timelines[].name` | string | — | Human-readable title | no |
| `timelines[].duration` | number \| string | — | Duration in seconds or timecode | no |
| `timelines[].sceneRefs` | array<string> | — | Array of scene IDs in playback order | no |
| `timelines[].audioRef` | array<string> | — | Array of audio IDs mixed into timeline | no |