# Configuration reference

Generated from the runtime schema in `packages/cinecode/src/config/zod-schema.ts`.
Unknown keys are rejected at every level. Array item fields use `[]`.
For manifest documentation, see [manifest-reference.md](./manifest-reference.md).

| Key | Type | Values | Required |
| --- | --- | --- | --- |
| `$schema` | string | — | no |
| `extends` | string | — | no |
| `schemaVersion` | 1 or 2 | `1`, `2` | no |
| `project` | object (entry, sourceDir, mediaDir, outputDir, cacheDir) | — | no |
| `project.entry` | string | — | no |
| `project.sourceDir` | string | — | no |
| `project.mediaDir` | string | — | no |
| `project.outputDir` | string | — | no |
| `project.cacheDir` | string | — | no |
| `video` | object (width, height, fps, defaultDuration, background) | — | no |
| `video.width` | integer | — | no |
| `video.height` | integer | — | no |
| `video.fps` | number | — | no |
| `video.defaultDuration` | number or string | — | no |
| `video.background` | string (pattern) | — | no |
| `images` | object (defaultFormat, quality, scaleFactor) | — | no |
| `images.defaultFormat` | "png" \| "jpg" \| "webp" | `"png"`, `"jpg"`, `"webp"` | no |
| `images.quality` | integer | — | no |
| `images.scaleFactor` | number | — | no |
| `dev` | object (port, host, open, hmr) | — | no |
| `dev.port` | integer | — | no |
| `dev.host` | string | — | no |
| `dev.open` | boolean | — | no |
| `dev.hmr` | boolean | — | no |
| `sourceDir` | string | — | no |
| `mediaDir` | string | — | no |
| `outputDir` | string | — | no |
| `cacheDir` | string | — | no |
| `binaries` | object (ffmpegPath, ffprobePath) | — | no |
| `binaries.ffmpegPath` | string | — | no |
| `binaries.ffprobePath` | string | — | no |
| `allowCoLocatedMedia` | boolean | — | no |
| `cloudMedia` | array<object (url, name, sha256)> | — | no |
| `cloudMedia[]` | object (url, name, sha256) | — | no |
| `cloudMedia[].url` | string | — | yes |
| `cloudMedia[].name` | string | — | no |
| `cloudMedia[].sha256` | string | — | no |
| `render` | object (fps, resolution, format, quality, codec, crf, preset, hardwareAcceleration, concurrency, chunkSize, memoryBudgetMb, alpha, twoPass, platformPreset, bitrate, colorManagement) | — | no |
| `render.fps` | number | — | no |
| `render.resolution` | string (pattern) | — | no |
| `render.format` | "mp4" \| "webm" \| "prores" \| "mkv" \| "avi" \| "gif" \| "apng" \| "png" \| "jpg" \| "webp" \| "pdf" \| "webm-alpha" \| "prores-alpha" | `"mp4"`, `"webm"`, `"prores"`, `"mkv"`, `"avi"`, `"gif"`, `"apng"`, `"png"`, `"jpg"`, `"webp"`, `"pdf"`, `"webm-alpha"`, `"prores-alpha"` | no |
| `render.quality` | "draft" \| "preview" \| "medium" \| "final" \| "lossless" \| "low" \| "high" | `"draft"`, `"preview"`, `"medium"`, `"final"`, `"lossless"`, `"low"`, `"high"` | no |
| `render.codec` | "h264" \| "h265" \| "av1" \| "prores" \| "vp9" \| "ffv1" \| "utvideo" | `"h264"`, `"h265"`, `"av1"`, `"prores"`, `"vp9"`, `"ffv1"`, `"utvideo"` | no |
| `render.crf` | integer | — | no |
| `render.preset` | "ultrafast" \| "superfast" \| "veryfast" \| "faster" \| "fast" \| "medium" \| "slow" \| "slower" \| "veryslow" | `"ultrafast"`, `"superfast"`, `"veryfast"`, `"faster"`, `"fast"`, `"medium"`, `"slow"`, `"slower"`, `"veryslow"` | no |
| `render.hardwareAcceleration` | "auto" \| "nvenc" \| "videotoolbox" \| "qsv" \| "off" | `"auto"`, `"nvenc"`, `"videotoolbox"`, `"qsv"`, `"off"` | no |
| `render.concurrency` | integer or "auto" | `"auto"` | no |
| `render.chunkSize` | integer | — | no |
| `render.memoryBudgetMb` | integer | — | no |
| `render.alpha` | boolean | — | no |
| `render.twoPass` | boolean | — | no |
| `render.platformPreset` | "youtube-1080p" \| "youtube-4k" \| "youtube-shorts" \| "tiktok" \| "instagram-reels" \| "instagram-feed-square" \| "instagram-feed-portrait" \| "instagram-post" \| "linkedin" \| "twitter" \| "vimeo-pro" \| "broadcast-sdi" \| "archival-master" \| "web-gif" \| "web-webp" | `"youtube-1080p"`, `"youtube-4k"`, `"youtube-shorts"`, `"tiktok"`, `"instagram-reels"`, `"instagram-feed-square"`, `"instagram-feed-portrait"`, `"instagram-post"`, `"linkedin"`, `"twitter"`, `"vimeo-pro"`, `"broadcast-sdi"`, `"archival-master"`, `"web-gif"`, `"web-webp"` | no |
| `render.bitrate` | integer | — | no |
| `render.colorManagement` | object (workingColorSpace, outputColorSpace, enabled) | — | no |
| `render.colorManagement.workingColorSpace` | "srgb" \| "linear-srgb" \| "rec709" \| "acescg" | `"srgb"`, `"linear-srgb"`, `"rec709"`, `"acescg"` | no |
| `render.colorManagement.outputColorSpace` | "srgb" \| "rec709" \| "display-p3" \| "rec2020" | `"srgb"`, `"rec709"`, `"display-p3"`, `"rec2020"` | no |
| `render.colorManagement.enabled` | boolean | — | no |
| `audio` | object (sampleRate, channels, masterVolume) | — | no |
| `audio.sampleRate` | 22050 or 44100 or 48000 or 96000 | `22050`, `44100`, `48000`, `96000` | no |
| `audio.channels` | 1 or 2 or 6 | `1`, `2`, `6` | no |
| `audio.masterVolume` | number | — | no |
| `fonts` | array<object (family, src, weight, style)> | — | no |
| `fonts[]` | object (family, src, weight, style) | — | no |
| `fonts[].family` | string | — | yes |
| `fonts[].src` | string | — | yes |
| `fonts[].weight` | number or string | — | no |
| `fonts[].style` | string | — | no |
| `concurrency` | integer or "auto" | `"auto"` | no |
| `overwrite` | boolean | — | no |
| `gitignore` | boolean | — | no |
| `plugins` | array<string or object (source, options, enabled)> | — | no |
| `plugins[]` | string or object (source, options, enabled) | — | no |
| `plugins[].source` | string | — | no |
| `plugins[].options` | object | — | no |
| `plugins[].enabled` | boolean | — | no |
| `pluginPrecedence` | array<string> | — | no |
| `autoDiscoverPlugins` | boolean | — | no |
| `ignorePatterns` | array<string> | — | no |