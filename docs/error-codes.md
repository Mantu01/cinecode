# Error Code Reference

<!-- Generated automatically from error codes enum and exit mappings. Do not edit manually. -->

All Cinecode errors use coded identifiers (`CCxxxx`), actionable remediation hints, and deterministic process exit codes.

| Code | Exit Code | Message Template | Remediation / Fix Hint |
| --- | --- | --- | --- |
| `CC0001` | `2` | Invalid command usage: {reason} | Run `cinecode help <command>` for the accepted arguments and flags. |
| `CC1001` | `3` | Configuration missing required key: {key} | Add the missing required field to your config. Run `cinecode doctor` to see all validation errors at once. |
| `CC1002` | `3` | Unknown configuration key: {key}. {suggestion} | Check your config keys against the schema: `cinecode validate --schema`. |
| `CC1003` | `3` | Invalid path for {key}: {path}. {reason} | Resolution must be even numbers and match a known preset. Use `1920x1080`, `1280x720`, `3840x2160`, or specify exact `width` and `height` values. |
| `CC1004` | `3` | Unsupported schema version: {version}. Expected: {expected} | Upgrade your config: add `schemaVersion: 2` and move fields into `project/`, `video/`, `render/` blocks. See migration guide. |
| `CC1005` | `3` | Configuration could not be loaded: {path}. {reason} | Check the resolved config path and that the file parses. Run `cinecode doctor` with the same `--config` to see the loader diagnostic. |
| `CC1006` | `3` | Configuration could not be parsed: {path}. {reason} | Fix the JSON/TypeScript syntax at the reported location, then rerun the command. |
| `CC1007` | `3` | Unsupported configuration format: {path}. Expected .ts, .js, .mjs, .cjs, .mts, .cts or .json | Rename the config to one of: cinecode.config.ts, .js, .mjs, .cjs, .mts, .cts, cinecode.json, or pass a supported file with `--config`. |
| `CC1008` | `3` | Unsupported output format: {format}. Supported: {supported} | Use one of the listed formats. Run `cinecode presets` for platform-specific container choices. |
| `CC1009` | `3` | Project entry file not found: {path} | Create the entry file or point `project.entry` at the existing composition module. |
| `CC1010` | `3` | Invalid project manifest: {path}. {reason} | Fix the manifest module so it exports the declared entries. Run `cinecode check` for the full report. |
| `CC1011` | `3` | Unknown platform preset: {name} | Run `cinecode presets` for the list of valid preset names. |
| `CC1012` | `3` | Invalid option value: {reason} | Check the flag value and its documented format (for example `--resolution 1920x1080` or `--concurrency auto`). |
| `CC1013` | `3` | Validation failed with {count} error(s) | Fix each reported error and rerun the same command; machine output lists them under result.errors. |
| `CC1014` | `2` | Unknown {kind}: {name}. Expected one of: {available} | Check the command help for the accepted values, then rerun with one of them. |
| `CC2001` | `3` | Media file not found: {path} | Verify the file exists at the resolved path. Run `cinecode media:list` to check media registration. Supported extensions: .mp4, .mov, .webm, .png, .jpg, .gif, .wav, .mp3, .ogg |
| `CC2002` | `3` | Unsupported media type: {type} for file: {path} | Use a supported media format. Convert your file with ffmpeg: `ffmpeg -i input.{ext} output.mp4` |
| `CC2003` | `3` | Media file unreadable: {path}. {reason} | Verify the file is not corrupted: run `ffmpeg -i <file>` manually to inspect. Try re-exporting from your source application. |
| `CC2004` | `3` | Media cache entry unreadable: {path}. {reason} | Delete the stale cache entry or run `cinecode clean --cache`; the affected item is re-derived on the next run. |
| `CC2101` | `3` | Multi-camera clip has no resolvable camera: {camera} | Specify a valid camera ID in the multi-camera clip configuration. |
| `CC2201` | `3` | Streaming encoder frameBytes must be positive, got {bytes} | Verify composition width, height, and pixel format produce positive frame size. |
| `CC2202` | `3` | Failed to open ffmpeg stdin for streaming encode | Check ffmpeg installation and system permissions for process pipes. |
| `CC2203` | `3` | Streaming encode failed: {reason} | Check ffmpeg log output and verify codec parameters and output path. |
| `CC2204` | `3` | Streaming encoder is not accepting frames: {reason} | Ensure streaming encoder is initialized and not closed before submitting frames. |
| `CC2205` | `3` | Frame buffer size mismatch: expected {expected} bytes, got {actual} | Verify canvas rendering dimensions match composition dimensions. |
| `CC2206` | `3` | Frame encode write failed: {reason} | Increase memory budget with --memory-budget or check disk space. |
| `CC2301` | `3` | Pixel buffer dimensions must be positive, got {dimensions} | Ensure composition width and height are greater than zero. |
| `CC2501` | `3` | Singular color transform matrix | Check color profile configuration; matrix inversion requires non-zero determinant. |
| `CC2502` | `3` | Unsupported color transform {from} -> {to} | Use supported color spaces (sRGB, Display P3, Rec.2020). |
| `CC2601` | `3` | Frame extraction failed: {reason} | Check video source integrity and ensure ffmpeg is available. |
| `CC2602` | `3` | Frame extraction produced no data at timestamp {time} | Verify requested timestamp is inside the media duration. |
| `CC3001` | `3` | Overlapping clips detected on track {track}: {clip1} and {clip2} | Clips on the same track cannot overlap. Adjust their start times or move one to a different track layer. |
| `CC3002` | `3` | Invalid duration for clip {clip}: {duration}. Duration must be positive | Clip duration must be positive. Set an explicit `duration` or use a non-empty media source. |
| `CC3003` | `3` | Clip {clip} extends outside composition bounds | Trim the clip to fit within the composition duration, or extend the composition with a longer timeline. |
| `CC3004` | `3` | Keyframes for {property} are not sorted by time | Sort keyframes by `atFrames` ascending. Use `sortKeyframes(keyframes)` from 'cinecode' or run `cinecode check --sort-keyframes`. |
| `CC3005` | `3` | Non-deterministic API detected in {context}: {function} | Replace `Math.random()` with seeded random: `import { random } from "cinecode"; const rng = random(seed);` |
| `CC3006` | `3` | Font {family} is missing glyphs for characters: {missing} | Install the font system-wide, embed it via `fontLoading: { strategy: "embed" }`, or use a fallback font with `fontFamilyFallback`. |
| `CC3007` | `3` | Unknown {kind} "{id}". Registered: {available} | Use one of the registered ids, or register the missing entry in `main.ts`. |
| `CC3008` | `3` | Module "{path}" does not export {expected} | Export the expected value (default export, `defineTimeline`, `defineScene`, `defineImage` or `defineAudio`). |
| `CC3009` | `3` | Unreferenced {kind} "{id}": no timeline or scene references it | Reference the entry from a timeline, or keep it as a standalone target; `check` lists it once per command. |
| `CC3010` | `3` | Timeline "{timeline}" references scene "{scene}" but its file replaces the references | A timeline compiles either its file or its sceneRefs, never both; remove one. |
| `CC4001` | `1` | Frame {frame} from clip '{source}' failed to decode: {reason} | Verify the source video is not corrupted. Run `cinecode inspect <file>` to check metadata. Update ffmpeg or re-export from source. |
| `CC4002` | `1` | FFmpeg encoder error: {details} | Try switching codec with `--codec h264`, reducing CRF, or checking that the output path is writable. |
| `CC4003` | `130` | Render cancelled | Render was cancelled by user or timeout. Check process signals and try again. |
| `CC4004` | `1` | Requested output artifact was not produced: {path} | Check the reported output path and rerun with --overwrite. If the encoder failed, the coded error above names the cause. |
| `CC4005` | `1` | Mux failed: {reason} | Verify the temporary video and audio buffers exist and that ffmpeg is installed. Run `cinecode doctor`. |
| `CC4006` | `1` | Render checkpoint unreadable: {path}. {reason} | Delete the stale checkpoint under `.cinecode/cache/checkpoints` or rerun with `--fresh`. |
| `CC4007` | `1` | Render cache entry unreadable: {path}. {reason} | Clear the render cache with `cinecode clean --cache`; frames are recomputed on the next run. |
| `CC4008` | `1` | Output write failed: {path}. {reason} | Check that the output directory exists and is writable, then rerun with --overwrite. |
| `CC4009` | `1` | Render failed for {count} output variant(s): {reason} | Read each variant error above, fix the first cause, and rerun with a single `--variant` to isolate it. |
| `CC4010` | `1` | Frame {frame} failed to render: {reason} | Check clip composition and draw calls for the reported frame, or rerun with --verbose. |
| `CC4011` | `1` | Render chunk {chunk} failed: {reason} | Inspect worker logs or retry with smaller chunk size using --chunk-size. |
| `CC4012` | `1` | Path is ignored: {path} | The path matches a .cinecodeignore rule; remove the rule or choose a different path. |
| `CC5001` | `1` | Audio track '{name}' could not be mixed: {reason} | Check that the audio file format is supported and the sample rate matches the composition ({fps}fps → 48000Hz). Add `--audio-codec aac` if needed. |
| `CC5002` | `1` | Audio synthesis failed for sound '{name}': {reason} | Verify the sound definition is valid — oscillators, envelope, and filter params must be within acceptable ranges. |
| `CC5101` | `1` | Sample rate must be positive for K-weighting: {sampleRate} | Specify standard audio sample rate (44100 or 48000 Hz). |
| `CC5201` | `1` | Demucs stem separation is unavailable: {reason} | Install Demucs with `pip install demucs` or use channel-split fallback. |
| `CC5202` | `1` | Demucs separation failed: {reason} | Inspect audio file format and verify Demucs dependencies. |
| `CC5203` | `1` | Demucs produced no recognised stems in {path} | Check output folder for separated audio files (.wav). |
| `CC5204` | `1` | Stem '{stem}' was not produced for {path} | Verify requested stem name (vocals, drums, bass, other) matches model. |
| `CC5205` | `1` | Channel-split fallback produced no stems | Ensure input audio contains stereo or multi-channel data. |
| `CC5301` | `1` | Audio EQ supports at most {max} bands, got {count} | Reduce the number of equalizer bands to {max} or fewer. |
| `CC5401` | `1` | Text-to-speech engine '{engine}' is unavailable or unsupported offline: {reason} | Use the local 'system' TTS engine or install a local offline synthesis engine. |
| `CC5501` | `1` | Not a valid MIDI file: missing MThd header in {path} | Provide a valid Standard MIDI File (.mid) with MThd header. |
| `CC5601` | `1` | Audio encode validation failed: {reason} | Verify audio sample rate, channels, and codec settings. |
| `CC6001` | `4` | Unsupported URL scheme for cloud media: {url} | Only http:// and https:// schemes are supported for cloud media downloads. |
| `CC6002` | `4` | Download failed for {url}: {reason} | Check network connectivity and retry. If persistent, download the file manually and reference locally. |
| `CC6003` | `4` | Checksum mismatch for {url}: expected {expected}, got {actual} | Redownload the file. The cached copy may have been corrupted during transfer. |
| `CC6004` | `4` | LUT file '{source}' is missing LUT_1D_SIZE or LUT_3D_SIZE | Ensure .cube file conforms to Adobe Cube LUT specification. |
| `CC6005` | `4` | DOMAIN_MAX must be greater than DOMAIN_MIN in '{source}' | Correct DOMAIN_MIN and DOMAIN_MAX in the .cube LUT header. |
| `CC6006` | `4` | LUT size mismatch in '{source}': expected {expected} entries, found {actual} | Verify data lines in .cube file match declared 1D or 3D cube size. |
| `CC6007` | `4` | LUT file '{source}' contains no data | Provide a complete non-empty .cube LUT file. |
| `CC6008` | `4` | Operation requires a 3D LUT, but '{path}' is a 1D LUT | Supply a 3D cube LUT or use 1D application function. |
| `CC6009` | `4` | Publish failed for target '{target}': {reason} | Verify destination path, permissions, or publish registry credentials and retry. |
| `CC6101` | `4` | Overlay application failed: {reason} | Verify overlay dimensions and blend mode settings. |
| `CC6201` | `4` | Unknown procedural texture type: {type} | Use a supported procedural texture type (noise, gradient, grid). |
| `CC6301` | `4` | Unknown typography preset: {preset} | Use a registered typography preset or configure font explicitly. |
| `CC7001` | `78` | Node.js version {version} is not supported. Minimum required: 22.18.0 | Upgrade Node.js to version 22.18.0 or later: `nvm install 22.18.0` then `nvm use 22.18.0`. |
| `CC7002` | `4` | Encoder unavailable: {reason} | Ensure ffmpeg is installed and in PATH. Run `cinecode doctor` to diagnose. |
| `CC7003` | `4` | Folder not writable: {path} | Create the output directory manually or run with elevated permissions: `mkdir -p <path>` |
| `CC7004` | `4` | Environment health check failed: {reason} | Resolve each reported issue, then rerun `cinecode health`; use `cinecode doctor` for remediation hints. |
| `CC7005` | `4` | Memory allocation or byte budget error: {reason} | Increase memory budget with --memory-budget or reduce worker concurrency. |
| `CC7006` | `4` | Worker concurrency recommendation: {reason} | Tune worker concurrency with --concurrency or rely on auto-detected worker count. |
| `CC7100` | `4` | Render memory budget: {details} | Informational diagnostic; no action required. |
| `CC7101` | `4` | Frame transport: {details} | Informational diagnostic; no action required. |
| `CC7102` | `4` | Renderer caches: {details} | Informational diagnostic; no action required. |
| `CC7103` | `4` | Worker startup: {details} | Informational diagnostic; no action required. |
| `CC7104` | `4` | Shared decode: {details} | Informational diagnostic; no action required. |
| `CC7105` | `4` | Streaming pipeline: {details} | Informational diagnostic; no action required. |
| `CC7106` | `4` | Cache identity: {details} | Informational diagnostic; no action required. |
| `CC7107` | `4` | Cache identity inputs: {details} | Informational diagnostic; no action required. |
| `CC7108` | `4` | Render cache GC warning: {details} | Run `cinecode clean --cache` if cache space is constrained. |
| `CC8001` | `3` | Plugin load failed: {plugin}. {reason} | Check that the plugin exports a valid `register()` function and is compatible with this cinecode version. |
| `CC8002` | `3` | Plugin validation failed: {plugin}. {reason} | Fix the plugin's manifest or configuration. Run `cinecode doctor` for details. |
| `CC8003` | `3` | Plugin hook '{hook}' threw in {plugin}: {reason}. Other plugins continued. | Inspect the plugin code for the thrown error. Other plugins will continue loading. |
| `CC8004` | `3` | Plugin dependency not satisfied: {plugin} requires {dependency} ({requirement}). {found} | Install the missing dependency matching the required version range. |
| `CC8005` | `3` | Plugin operation failed: {plugin}. {reason} | Check the package name, package manager availability and network access, then retry the plugin command. |
| `CC8006` | `3` | Plugin warning or degradation: {reason} | Check plugin configuration or update plugin to a compatible version. |
| `CC9001` | `1` | Unexpected failure: {reason} | Rerun with --verbose to print the stack trace, then report the failure with the code and path shown above. |
| `CC9002` | `1` | Threshold exceeded: {reason} | Compare the reported metric with the baseline, fix the regression, or rerun without the fail-on-threshold flag. |
