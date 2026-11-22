# Configuration reference

<!-- Generated automatically from config schema and defaults table. Do not edit manually. -->

Generated from the runtime schema in `packages/cinecode/src/config/zod-schema.ts` and `defaults.ts`.
Unknown keys are rejected at every level. Array item fields use `[]`.
For manifest documentation, see [manifest-reference.md](./manifest-reference.md).

## Project roots and media policy

The four project roots (`sourceDir`, `mediaDir`, `outputDir`, and `cacheDir`) must resolve to
distinct, non-overlapping paths. None can be the project root or parent of another. Media
(`mediaDir`) is strictly read-only except for the opt-in `cinecode media:download` command.
Media references are resolved against `mediaDir` and cannot escape via `..` or symlinks.
Co-located media under `sourceDir` is supported only when `allowCoLocatedMedia: true` is configured.

| Key | Type | Values | Default | Required |
| --- | --- | --- | --- | --- |
| `$schema` | string | — | — | no |
| `extends` | string | — | — | no |
| `schemaVersion` | 1 or 2 | `1`, `2` | — | no |
| `project` | object (entry, sourceDir, mediaDir, outputDir, cacheDir) | — | `{"entry":"./main.ts","sourceDir":"./src","mediaDir":"./media","outputDir":"./output","cacheDir":".cinecode/cache"}` | no |
| `project.entry` | string | — | `"./main.ts"` | no |
| `project.sourceDir` | string | — | `"./src"` | no |
| `project.mediaDir` | string | — | `"./media"` | no |
| `project.outputDir` | string | — | `"./output"` | no |
| `project.cacheDir` | string | — | `".cinecode/cache"` | no |
| `video` | object (width, height, fps, defaultDuration, background) | — | `{"width":1920,"height":1080,"fps":30,"background":"#000000"}` | no |
| `video.width` | integer | — | `1920` | no |
| `video.height` | integer | — | `1080` | no |
| `video.fps` | number | — | `30` | no |
| `video.defaultDuration` | number or string | — | — | no |
| `video.background` | string (pattern) | — | `"#000000"` | no |
| `images` | object (defaultFormat, quality, scaleFactor) | — | `{"defaultFormat":"png","quality":90,"scaleFactor":1}` | no |
| `images.defaultFormat` | "png" \| "jpg" \| "webp" | `"png"`, `"jpg"`, `"webp"` | `"png"` | no |
| `images.quality` | integer | — | `90` | no |
| `images.scaleFactor` | number | — | `1` | no |
| `dev` | object (port, host, open, hmr) | — | `{"port":3000,"host":"127.0.0.1","open":false,"hmr":true}` | no |
| `dev.port` | integer | — | `3000` | no |
| `dev.host` | string | — | `"127.0.0.1"` | no |
| `dev.open` | boolean | — | `false` | no |
| `dev.hmr` | boolean | — | `true` | no |
| `sourceDir` | string | — | — | no |
| `mediaDir` | string | — | — | no |
| `outputDir` | string | — | — | no |
| `cacheDir` | string | — | — | no |
| `binaries` | object (ffmpegPath, ffprobePath) | — | `{}` | no |
| `binaries.ffmpegPath` | string | — | — | no |
| `binaries.ffprobePath` | string | — | — | no |
| `allowCoLocatedMedia` | boolean | — | — | no |
| `cloudMedia` | array<object (url, name, sha256)> | — | — | no |
| `cloudMedia[]` | object (url, name, sha256) | — | — | no |
| `cloudMedia[].url` | string | — | — | yes |
| `cloudMedia[].name` | string | — | — | no |
| `cloudMedia[].sha256` | string | — | — | no |
| `render` | object (fps, resolution, format, quality, codec, crf, preset, hardwareAcceleration, concurrency, chunkSize, memoryBudgetMb, alpha, twoPass, platformPreset, bitrate, colorManagement) | — | `{"fps":30,"resolution":"1920x1080","format":"mp4","quality":"medium","codec":"h264","preset":"slow","hardwareAcceleration":"off","concurrency":"auto","chunkSize":50,"memoryBudgetMb":1024,"colorManagement":{"enabled":false,"workingColorSpace":"srgb","outputColorSpace":"srgb"}}` | no |
| `render.fps` | number | — | `30` | no |
| `render.resolution` | string (pattern) | — | `"1920x1080"` | no |
| `render.format` | "mp4" \| "webm" \| "prores" \| "mkv" \| "avi" \| "gif" \| "apng" \| "png" \| "jpg" \| "webp" \| "pdf" \| "webm-alpha" \| "prores-alpha" | `"mp4"`, `"webm"`, `"prores"`, `"mkv"`, `"avi"`, `"gif"`, `"apng"`, `"png"`, `"jpg"`, `"webp"`, `"pdf"`, `"webm-alpha"`, `"prores-alpha"` | `"mp4"` | no |
| `render.quality` | "draft" \| "preview" \| "medium" \| "final" \| "lossless" \| "low" \| "high" | `"draft"`, `"preview"`, `"medium"`, `"final"`, `"lossless"`, `"low"`, `"high"` | `"medium"` | no |
| `render.codec` | "h264" \| "h265" \| "av1" \| "prores" \| "vp9" \| "ffv1" \| "utvideo" | `"h264"`, `"h265"`, `"av1"`, `"prores"`, `"vp9"`, `"ffv1"`, `"utvideo"` | `"h264"` | no |
| `render.crf` | integer | — | — | no |
| `render.preset` | "ultrafast" \| "superfast" \| "veryfast" \| "faster" \| "fast" \| "medium" \| "slow" \| "slower" \| "veryslow" | `"ultrafast"`, `"superfast"`, `"veryfast"`, `"faster"`, `"fast"`, `"medium"`, `"slow"`, `"slower"`, `"veryslow"` | `"slow"` | no |
| `render.hardwareAcceleration` | "auto" \| "nvenc" \| "videotoolbox" \| "qsv" \| "off" | `"auto"`, `"nvenc"`, `"videotoolbox"`, `"qsv"`, `"off"` | `"off"` | no |
| `render.concurrency` | integer or "auto" | `"auto"` | `"auto"` | no |
| `render.chunkSize` | integer | — | `50` | no |
| `render.memoryBudgetMb` | integer | — | `1024` | no |
| `render.alpha` | boolean | — | — | no |
| `render.twoPass` | boolean | — | — | no |
| `render.platformPreset` | "youtube-1080p" \| "youtube-4k" \| "youtube-shorts" \| "tiktok" \| "instagram-reels" \| "instagram-feed-square" \| "instagram-feed-portrait" \| "instagram-post" \| "linkedin" \| "twitter" \| "vimeo-pro" \| "broadcast-sdi" \| "archival-master" \| "web-gif" \| "web-webp" | `"youtube-1080p"`, `"youtube-4k"`, `"youtube-shorts"`, `"tiktok"`, `"instagram-reels"`, `"instagram-feed-square"`, `"instagram-feed-portrait"`, `"instagram-post"`, `"linkedin"`, `"twitter"`, `"vimeo-pro"`, `"broadcast-sdi"`, `"archival-master"`, `"web-gif"`, `"web-webp"` | — | no |
| `render.bitrate` | integer | — | — | no |
| `render.colorManagement` | object (workingColorSpace, outputColorSpace, enabled) | — | `{"enabled":false,"workingColorSpace":"srgb","outputColorSpace":"srgb"}` | no |
| `render.colorManagement.workingColorSpace` | "srgb" \| "linear-srgb" \| "rec709" \| "acescg" | `"srgb"`, `"linear-srgb"`, `"rec709"`, `"acescg"` | `"srgb"` | no |
| `render.colorManagement.outputColorSpace` | "srgb" \| "rec709" \| "display-p3" \| "rec2020" | `"srgb"`, `"rec709"`, `"display-p3"`, `"rec2020"` | `"srgb"` | no |
| `render.colorManagement.enabled` | boolean | — | `false` | no |
| `audio` | object (sampleRate, channels, masterVolume) | — | `{"sampleRate":48000,"channels":2,"masterVolume":1}` | no |
| `audio.sampleRate` | 22050 or 44100 or 48000 or 96000 | `22050`, `44100`, `48000`, `96000` | `48000` | no |
| `audio.channels` | 1 or 2 or 6 | `1`, `2`, `6` | `2` | no |
| `audio.masterVolume` | number | — | `1` | no |
| `fonts` | array<object (family, src, weight, style)> | — | — | no |
| `fonts[]` | object (family, src, weight, style) | — | — | no |
| `fonts[].family` | string | — | — | yes |
| `fonts[].src` | string | — | — | yes |
| `fonts[].weight` | number or string | — | — | no |
| `fonts[].style` | string | — | — | no |
| `concurrency` | integer or "auto" | `"auto"` | `"auto"` | no |
| `overwrite` | boolean | — | `false` | no |
| `gitignore` | boolean | — | `true` | no |
| `plugins` | array<string or object (source, options, enabled)> | — | — | no |
| `plugins[]` | string or object (source, options, enabled) | — | — | no |
| `plugins[].source` | string | — | — | no |
| `plugins[].options` | object | — | — | no |
| `plugins[].enabled` | boolean | — | — | no |
| `pluginPrecedence` | array<string> | — | — | no |
| `autoDiscoverPlugins` | boolean | — | `true` | no |
| `ignorePatterns` | array<string> | — | `[]` | no |
