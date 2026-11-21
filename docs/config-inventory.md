# Configuration field inventory

Every authoring field must reach a consumer. `container` marks blocks whose
children carry the effect. Field paths match `docs/config-reference.md`.

| Field | Normalized location | Observable effect |
| --- | --- | --- |
| `$schema` | untouched | Editor picks the bundled JSON schema; ignored at runtime. |
| `extends` | merged document | `mergeConfigInheritance` merges the parent config before validation. |
| `schemaVersion` | `schemaVersion` | Loader accepts 1-2 and refuses newer versions explicitly. |
| `project` | container | Groups project paths. |
| `project.entry` | `entry`, `project.entry` | Manifest loader and `check` resolve the entry module. |
| `project.sourceDir` | `sourceDir`, `project.sourceDir` | Authored source code root. |
| `project.mediaDir` | `mediaDir`, `project.mediaDir` | Media assets root (video/image/audio/font/LUT). |
| `project.outputDir` | `outputDir`, `project.outputDir` | Render output root. |
| `project.cacheDir` | `cacheDir`, `project.cacheDir` | Render, media and resume cache root. |
| `video` | container | Groups composition geometry. |
| `video.width` | `video.width` | Manifest composition width. |
| `video.height` | `video.height` | Manifest composition height. |
| `video.fps` | `video.fps` | Manifest composition frame rate. |
| `video.defaultDuration` | `video.defaultDuration` | Manifest duration fallback. |
| `video.background` | `video.background` | Manifest composition background. |
| `images` | container | Groups still-image defaults. |
| `images.defaultFormat` | `images.defaultFormat` | Image generation and manifest image format. |
| `images.quality` | `images.quality` | Still-image encoder quality. |
| `images.scaleFactor` | `images.scaleFactor` | Still-image render scale. |
| `dev` | container | Groups dev-server settings. |
| `dev.port` | `dev.port` | `cinecode dev` listen port. |
| `dev.host` | `dev.host` | `cinecode dev` bind host. |
| `dev.open` | `dev.open` | Opens the dev URL in a browser. |
| `dev.hmr` | `dev.hmr` | Enables hot reload. |
| `sourceDir` | `sourceDir` | Authored source code root. |
| `mediaDir` | `mediaDir` | Media assets root. |
| `outputDir` | `outputDir` | Render output root. |
| `cacheDir` | `cacheDir` | Cache root. |
| `allowCoLocatedMedia` | `allowCoLocatedMedia` | Allows media resolution fallback to sourceDir. |
| `cloudMedia` | `cloudMedia` | Cloud media entries offered to the resolver. |
| `cloudMedia[]` | `cloudMedia[]` | One downloadable media entry. |
| `cloudMedia[].url` | `cloudMedia[].url` | Download source. |
| `cloudMedia[].name` | `cloudMedia[].name` | Resolver alias. |
| `cloudMedia[].sha256` | `cloudMedia[].sha256` | Download integrity check. |
| `render` | container | Groups render settings. |
| `render.fps` | `render.fps` | Render command frame-rate override and normalized video fps. |
| `render.resolution` | `render.resolution` | Render command output size; feeds normalized geometry. |
| `render.format` | `render.format` | Container format. |
| `render.quality` | `render.quality` | Encoding profile (CRF and preset defaults). |
| `render.codec` | `render.codec` | Encoder codec arguments. |
| `render.crf` | `render.crf` | Explicit encoder CRF. |
| `render.preset` | `render.preset` | Encoder speed preset. |
| `render.hardwareAcceleration` | `render.hardwareAcceleration` | Encoder backend selection. |
| `render.concurrency` | `render.concurrency` | Worker count. |
| `render.chunkSize` | `render.chunkSize` | Frames per render chunk. |
| `render.memoryBudgetMb` | `render.memoryBudgetMb` | Byte budget for queued frames plus in-flight chunks; `--memory-budget` overrides, otherwise derived from available memory. |
| `render.alpha` | `render.alpha` | Pipeline alpha output plan. |
| `render.twoPass` | `render.twoPass` | Two-pass rate analysis before the final encode. |
| `render.platformPreset` | `render.platformPreset` | Encoder defaults, output fit and file-size compliance. |
| `render.bitrate` | `render.bitrate` | Encoder `-b:v` bitrate. |
| `render.colorManagement` | `render.colorManagement` | Frame color transform. |
| `render.colorManagement.workingColorSpace` | same | Working space of the frame transform. |
| `render.colorManagement.outputColorSpace` | same | Output space of the frame transform. |
| `render.colorManagement.enabled` | same | Enables the transform. |
| `audio` | container | Groups composition audio defaults. |
| `audio.sampleRate` | `audio.sampleRate` | Composition audio sample rate. |
| `audio.channels` | `audio.channels` | Composition audio channel count. |
| `audio.masterVolume` | `audio.masterVolume` | Composition master volume. |
| `fonts` | `fonts` | Font list validated by `check`/`validate` and registered in font loading. |
| `fonts[]` | `fonts[]` | One font entry. |
| `fonts[].family` | same | Font family used for lookup. |
| `fonts[].src` | same | Font file loaded by the renderer. |
| `fonts[].weight` | same | Font weight selection. |
| `fonts[].style` | same | Font style selection. |
| `concurrency` | `concurrency`, `render.concurrency` | Authoring alias for the worker count. |
| `overwrite` | `overwrite` | Output overwrite behaviour. |
| `gitignore` | `gitignore` | Gitignore management in `validate`/`doctor`. |
| `plugins` | `plugins` | Plugin loading list. |
| `plugins[]` | `plugins[]` | One plugin entry (string or object). |
| `plugins[].source` | same | Plugin module specifier. |
| `plugins[].options` | same | Options passed to the plugin. |
| `plugins[].enabled` | same | Skips disabled plugins. |
| `pluginPrecedence` | `pluginPrecedence` | Plugin feature-conflict order. |
| `autoDiscoverPlugins` | `autoDiscoverPlugins` | Plugin auto-discovery toggle. |
| `ignorePatterns` | `ignorePatterns` | Media-index ignore predicate. |

## Removed keys

These keys had no consumer and are rejected with the replacement hint.

| Removed key | Replacement |
| --- | --- |
| `name`, `project.name` | Project identity is not configurable. |
| `video.title`, `video.description`, `video.author`, `video.version`, `video.tags`, `video.license` | Output metadata is not configurable in this release. |
| `video.aspectRatio`, `video.pixelAspectRatio`, `video.colorSpace` | Use `video.width`/`video.height`; color via `render.colorManagement`. |
| `render.background` | Use `video.background`. |
| `render.enforceAspectRatio` | Use `render.platformPreset` or explicit geometry. |
| `render.variants` | Run `cinecode multi-res`. |
| `dev.historyDepth` | Canvas editor owns its history depth. |
| `dev.metricsPort` | Prometheus metrics are served on the dev port at `/metrics`. |
| `logLevel` | Use the CLI `--verbose` flag. |
| `audio.normalize`, `audio.limiter`, `audio.sidechains` | Apply audio processing in the timeline mixer. |
| `security`, `security.pluginVerification`, `security.trustedKeys` | Marketplace client controls verification. |
| `telemetry`, `telemetry.enabled`, `telemetry.endpoint` | Use `cinecode telemetry`. |
| `pluginPermissions` | Sandbox permissions are configured per plugin. |
| `composition` | Select a composition with `--composition`; do not embed it in config. |
