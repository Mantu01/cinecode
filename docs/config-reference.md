# Configuration reference

Generated from the runtime Zod schema in `packages/cinecode/src/config/zod-schema.ts`.
Unknown keys are rejected at every level. Array item fields use `[]`.

| Key | Type | Values | Required |
| --- | --- | --- | --- |
| `$schema` | string | — | no |
| `extends` | string | — | no |
| `schemaVersion` | 1 or 2 | `1`, `2` | no |
| `name` | string | — | no |
| `project` | object (name, entry, sourceDir, outputDir, cacheDir) | — | no |
| `project.name` | string | — | no |
| `project.entry` | string | — | no |
| `project.sourceDir` | string | — | no |
| `project.outputDir` | string | — | no |
| `project.cacheDir` | string | — | no |
| `video` | object (title, description, author, version, tags, license, width, height, aspectRatio, fps, defaultDuration, background, colorSpace, pixelAspectRatio) | — | no |
| `video.title` | string | — | no |
| `video.description` | string | — | no |
| `video.author` | string | — | no |
| `video.version` | string | — | no |
| `video.tags` | array<string> | — | no |
| `video.license` | string | — | no |
| `video.width` | integer | — | no |
| `video.height` | integer | — | no |
| `video.aspectRatio` | "16:9" \| "9:16" \| "1:1" \| "4:3" \| "21:9" | `"16:9"`, `"9:16"`, `"1:1"`, `"4:3"`, `"21:9"` | no |
| `video.fps` | number | — | no |
| `video.defaultDuration` | number or string | — | no |
| `video.background` | string (pattern) | — | no |
| `video.colorSpace` | "srgb" \| "rec709" \| "display-p3" | `"srgb"`, `"rec709"`, `"display-p3"` | no |
| `video.pixelAspectRatio` | number | — | no |
| `images` | object (defaultFormat, quality, scaleFactor) | — | no |
| `images.defaultFormat` | "png" \| "jpg" \| "webp" \| "svg" | `"png"`, `"jpg"`, `"webp"`, `"svg"` | no |
| `images.quality` | integer | — | no |
| `images.scaleFactor` | number | — | no |
| `dev` | object (port, host, open, hmr, historyDepth, metricsPort) | — | no |
| `dev.port` | integer | — | no |
| `dev.host` | string | — | no |
| `dev.open` | boolean | — | no |
| `dev.hmr` | boolean | — | no |
| `dev.historyDepth` | integer | — | no |
| `dev.metricsPort` | integer | — | no |
| `sourceDir` | string | — | no |
| `outputDir` | string | — | no |
| `cacheDir` | string | — | no |
| `cloudMedia` | array<object (url, name, sha256)> | — | no |
| `cloudMedia[]` | object (url, name, sha256) | — | no |
| `cloudMedia[].url` | string | — | yes |
| `cloudMedia[].name` | string | — | no |
| `cloudMedia[].sha256` | string | — | no |
| `render` | object (fps, resolution, format, background, quality, codec, crf, preset, hardwareAcceleration, concurrency, chunkSize, alpha, twoPass, platformPreset, enforceAspectRatio, variants, colorManagement) | — | no |
| `render.fps` | number | — | no |
| `render.resolution` | string (pattern) | — | no |
| `render.format` | "mp4" \| "webm" \| "prores" \| "mkv" \| "avi" \| "gif" \| "apng" \| "png" \| "jpg" \| "webp" \| "avif" \| "pdf" \| "webm-alpha" \| "prores-alpha" | `"mp4"`, `"webm"`, `"prores"`, `"mkv"`, `"avi"`, `"gif"`, `"apng"`, `"png"`, `"jpg"`, `"webp"`, `"avif"`, `"pdf"`, `"webm-alpha"`, `"prores-alpha"` | no |
| `render.background` | string | — | no |
| `render.quality` | "draft" \| "preview" \| "medium" \| "final" \| "lossless" \| "low" \| "high" | `"draft"`, `"preview"`, `"medium"`, `"final"`, `"lossless"`, `"low"`, `"high"` | no |
| `render.codec` | "h264" \| "h265" \| "av1" \| "prores" \| "vp9" \| "ffv1" \| "utvideo" | `"h264"`, `"h265"`, `"av1"`, `"prores"`, `"vp9"`, `"ffv1"`, `"utvideo"` | no |
| `render.crf` | integer | — | no |
| `render.preset` | "ultrafast" \| "superfast" \| "veryfast" \| "faster" \| "fast" \| "medium" \| "slow" \| "slower" \| "veryslow" | `"ultrafast"`, `"superfast"`, `"veryfast"`, `"faster"`, `"fast"`, `"medium"`, `"slow"`, `"slower"`, `"veryslow"` | no |
| `render.hardwareAcceleration` | "auto" \| "nvenc" \| "videotoolbox" \| "qsv" \| "off" | `"auto"`, `"nvenc"`, `"videotoolbox"`, `"qsv"`, `"off"` | no |
| `render.concurrency` | integer or "auto" | `"auto"` | no |
| `render.chunkSize` | integer | — | no |
| `render.alpha` | boolean | — | no |
| `render.twoPass` | boolean | — | no |
| `render.platformPreset` | "youtube-1080p" \| "youtube-4k" \| "tiktok" \| "instagram-reels" \| "instagram-post" \| "twitter" \| "custom" | `"youtube-1080p"`, `"youtube-4k"`, `"tiktok"`, `"instagram-reels"`, `"instagram-post"`, `"twitter"`, `"custom"` | no |
| `render.enforceAspectRatio` | boolean | — | no |
| `render.variants` | array<object (label, width, height, scaleFactor, crf, codec)> | — | no |
| `render.variants[]` | object (label, width, height, scaleFactor, crf, codec) | — | no |
| `render.variants[].label` | string | — | yes |
| `render.variants[].width` | integer | — | no |
| `render.variants[].height` | integer | — | no |
| `render.variants[].scaleFactor` | number | — | no |
| `render.variants[].crf` | integer | — | no |
| `render.variants[].codec` | "h264" \| "h265" \| "av1" \| "prores" \| "vp9" \| "ffv1" \| "utvideo" | `"h264"`, `"h265"`, `"av1"`, `"prores"`, `"vp9"`, `"ffv1"`, `"utvideo"` | no |
| `render.colorManagement` | object (workingColorSpace, outputColorSpace, enabled) | — | no |
| `render.colorManagement.workingColorSpace` | "srgb" \| "linear-srgb" \| "rec709" \| "acescg" | `"srgb"`, `"linear-srgb"`, `"rec709"`, `"acescg"` | no |
| `render.colorManagement.outputColorSpace` | "srgb" \| "rec709" \| "display-p3" \| "rec2020" | `"srgb"`, `"rec709"`, `"display-p3"`, `"rec2020"` | no |
| `render.colorManagement.enabled` | boolean | — | no |
| `audio` | object (sampleRate, channels, masterVolume, normalize, limiter, sidechains) | — | no |
| `audio.sampleRate` | 22050 or 44100 or 48000 or 96000 | `22050`, `44100`, `48000`, `96000` | no |
| `audio.channels` | 1 or 2 or 6 | `1`, `2`, `6` | no |
| `audio.masterVolume` | number | — | no |
| `audio.normalize` | boolean | — | no |
| `audio.limiter` | object (enabled, thresholdDb) | — | no |
| `audio.limiter.enabled` | boolean | — | no |
| `audio.limiter.thresholdDb` | number | — | no |
| `audio.sidechains` | array<object (targetTrackName, sidechainTrackName, threshold, ratio, attackMs, releaseMs)> | — | no |
| `audio.sidechains[]` | object (targetTrackName, sidechainTrackName, threshold, ratio, attackMs, releaseMs) | — | no |
| `audio.sidechains[].targetTrackName` | string | — | yes |
| `audio.sidechains[].sidechainTrackName` | string | — | yes |
| `audio.sidechains[].threshold` | number | — | no |
| `audio.sidechains[].ratio` | number | — | no |
| `audio.sidechains[].attackMs` | number | — | no |
| `audio.sidechains[].releaseMs` | number | — | no |
| `fonts` | array<object (family, src, weight, style)> | — | no |
| `fonts[]` | object (family, src, weight, style) | — | no |
| `fonts[].family` | string | — | yes |
| `fonts[].src` | string | — | yes |
| `fonts[].weight` | number or string | — | no |
| `fonts[].style` | string | — | no |
| `concurrency` | integer or "auto" | `"auto"` | no |
| `logLevel` | "silent" \| "error" \| "warn" \| "info" \| "debug" | `"silent"`, `"error"`, `"warn"`, `"info"`, `"debug"` | no |
| `overwrite` | boolean | — | no |
| `gitignore` | boolean | — | no |
| `plugins` | array<string or object (source, options, enabled)> | — | no |
| `plugins[]` | string or object (source, options, enabled) | — | no |
| `plugins[].source` | string | — | no |
| `plugins[].options` | object | — | no |
| `plugins[].enabled` | boolean | — | no |
| `pluginPrecedence` | array<string> | — | no |
| `pluginPermissions` | object | — | no |
| `security` | object (pluginVerification, trustedKeys) | — | no |
| `security.pluginVerification` | "strict" \| "warn" \| "off" | `"strict"`, `"warn"`, `"off"` | no |
| `security.trustedKeys` | array<string> | — | no |
| `telemetry` | object (enabled, endpoint) | — | no |
| `telemetry.enabled` | boolean | — | no |
| `telemetry.endpoint` | string | — | no |
| `autoDiscoverPlugins` | boolean | — | no |
| `ignorePatterns` | array<string> | — | no |
| `composition` | any | — | no |
