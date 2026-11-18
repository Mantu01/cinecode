export enum ErrorCode {
  CC0001 = "CC0001",
  CC1001 = "CC1001",
  CC1002 = "CC1002",
  CC1003 = "CC1003",
  CC1004 = "CC1004",
  CC1005 = "CC1005",
  CC1006 = "CC1006",
  CC1007 = "CC1007",
  CC1008 = "CC1008",
  CC1009 = "CC1009",
  CC1010 = "CC1010",
  CC1011 = "CC1011",
  CC1012 = "CC1012",
  CC1013 = "CC1013",
  CC1014 = "CC1014",
  CC2001 = "CC2001",
  CC2002 = "CC2002",
  CC2003 = "CC2003",
  CC2004 = "CC2004",
  CC3001 = "CC3001",
  CC3002 = "CC3002",
  CC3003 = "CC3003",
  CC3004 = "CC3004",
  CC3005 = "CC3005",
  CC3006 = "CC3006",
  CC3007 = "CC3007",
  CC3008 = "CC3008",
  CC4001 = "CC4001",
  CC4002 = "CC4002",
  CC4003 = "CC4003",
  CC4004 = "CC4004",
  CC4005 = "CC4005",
  CC4006 = "CC4006",
  CC4007 = "CC4007",
  CC4008 = "CC4008",
  CC4009 = "CC4009",
  CC5001 = "CC5001",
  CC5002 = "CC5002",
  CC6001 = "CC6001",
  CC6002 = "CC6002",
  CC6003 = "CC6003",
  CC7001 = "CC7001",
  CC7002 = "CC7002",
  CC7003 = "CC7003",
  CC7004 = "CC7004",
  CC8001 = "CC8001",
  CC8002 = "CC8002",
  CC8003 = "CC8003",
  CC8004 = "CC8004",
  CC8005 = "CC8005",
  CC9001 = "CC9001",
  CC9002 = "CC9002",
}

export const ErrorMessages: Record<ErrorCode, string> = {
  [ErrorCode.CC0001]: "Invalid command usage: {reason}",
  [ErrorCode.CC1001]: "Configuration missing required key: sourceDir",
  [ErrorCode.CC1002]: "Unknown configuration key: {key}. {suggestion}",
  [ErrorCode.CC1003]: "Invalid path for {key}: {path}. {reason}",
  [ErrorCode.CC1004]: "Unsupported schema version: {version}. Expected: {expected}",
  [ErrorCode.CC1005]: "Configuration could not be loaded: {path}. {reason}",
  [ErrorCode.CC1006]: "Configuration could not be parsed: {path}. {reason}",
  [ErrorCode.CC1007]: "Unsupported configuration format: {path}. Expected .ts, .js, .mjs, .cjs, .mts, .cts or .json",
  [ErrorCode.CC1008]: "Unsupported output format: {format}. Supported: {supported}",
  [ErrorCode.CC1009]: "Project entry file not found: {path}",
  [ErrorCode.CC1010]: "Invalid project manifest: {path}. {reason}",
  [ErrorCode.CC1011]: "Unknown platform preset: {name}",
  [ErrorCode.CC1012]: "Invalid option value: {reason}",
  [ErrorCode.CC1013]: "Validation failed with {count} error(s)",
  [ErrorCode.CC1014]: "Unknown {kind}: {name}. Expected one of: {available}",
  [ErrorCode.CC2001]: "Media file not found: {path}",
  [ErrorCode.CC2002]: "Unsupported media type: {type} for file: {path}",
  [ErrorCode.CC2003]: "Media file unreadable: {path}. {reason}",
  [ErrorCode.CC2004]: "Media cache entry unreadable: {path}. {reason}",
  [ErrorCode.CC3001]: "Overlapping clips detected on track {track}: {clip1} and {clip2}",
  [ErrorCode.CC3002]: "Invalid duration for clip {clip}: {duration}. Duration must be positive",
  [ErrorCode.CC3003]: "Clip {clip} extends outside composition bounds",
  [ErrorCode.CC3004]: "Keyframes for {property} are not sorted by time",
  [ErrorCode.CC3005]: "Non-deterministic API detected in {context}: {function}",
  [ErrorCode.CC3006]: "Font {family} is missing glyphs for characters: {missing}",
  [ErrorCode.CC3007]: "Unknown {kind} \"{id}\". Registered: {available}",
  [ErrorCode.CC3008]: "Module \"{path}\" does not export {expected}",
  [ErrorCode.CC4001]: "Frame {frame} from clip '{source}' failed to decode: {reason}",
  [ErrorCode.CC4002]: "FFmpeg encoder error: {details}",
  [ErrorCode.CC4003]: "Render cancelled",
  [ErrorCode.CC4004]: "Requested output artifact was not produced: {path}",
  [ErrorCode.CC4005]: "Mux failed: {reason}",
  [ErrorCode.CC4006]: "Render checkpoint unreadable: {path}. {reason}",
  [ErrorCode.CC4007]: "Render cache entry unreadable: {path}. {reason}",
  [ErrorCode.CC4008]: "Output write failed: {path}. {reason}",
  [ErrorCode.CC4009]: "Render failed for {count} output variant(s): {reason}",
  [ErrorCode.CC5001]: "Audio track '{name}' could not be mixed: {reason}",
  [ErrorCode.CC5002]: "Audio synthesis failed for sound '{name}': {reason}",
  [ErrorCode.CC6001]: "Unsupported URL scheme for cloud media: {url}",
  [ErrorCode.CC6002]: "Download failed for {url}: {reason}",
  [ErrorCode.CC6003]: "Checksum mismatch for {url}: expected {expected}, got {actual}",
  [ErrorCode.CC7001]: "Node.js version {version} is not supported. Minimum required: 20",
  [ErrorCode.CC7002]: "Encoder unavailable: {reason}",
  [ErrorCode.CC7003]: "Folder not writable: {path}",
  [ErrorCode.CC7004]: "Environment health check failed: {reason}",
  [ErrorCode.CC8001]: "Plugin load failed: {plugin}. {reason}",
  [ErrorCode.CC8002]: "Plugin validation failed: {plugin}. {reason}",
  [ErrorCode.CC8003]: "Plugin hook '{hook}' threw in {plugin}: {reason}. Other plugins continued.",
  [ErrorCode.CC8004]:
    "Plugin dependency not satisfied: {plugin} requires {dependency} ({requirement}). {found}",
  [ErrorCode.CC8005]: "Plugin operation failed: {plugin}. {reason}",
  [ErrorCode.CC9001]: "Unexpected failure: {reason}",
  [ErrorCode.CC9002]: "Threshold exceeded: {reason}",
};

export interface ErrorLocation {
  file?: string;
  line?: number;
  column?: number;
  clip?: string;
  track?: string;
  time?: string;
}

export interface CinecodeError extends Error {
  readonly code: ErrorCode;
  readonly location?: ErrorLocation;
  readonly fixHint?: string;
  readonly severity: "error" | "warning";
  readonly cause?: unknown;
}

export interface ErrorOptions {
  readonly location?: ErrorLocation;
  readonly fixHint?: string;
  readonly severity?: "error" | "warning";
  readonly cause?: unknown;
}

/** Fix hints for every error code. Concrete, copy-pasteable remediation steps. */
const FIX_HINTS: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.CC0001]: "Run `cinecode help <command>` for the accepted arguments and flags.",
  [ErrorCode.CC1001]:
    "Add the missing required field to your config. Run `cinecode doctor` to see all validation errors at once.",
  [ErrorCode.CC1002]: "Check your config keys against the schema: `cinecode validate --schema`.",
  [ErrorCode.CC1003]:
    "Resolution must be even numbers and match a known preset. Use `1920x1080`, `1280x720`, `3840x2160`, or specify exact `width` and `height` values.",
  [ErrorCode.CC1004]:
    "Upgrade your config: add `schemaVersion: 2` and move fields into `project/`, `video/`, `render/` blocks. See migration guide.",
  [ErrorCode.CC1005]:
    "Check the resolved config path and that the file parses. Run `cinecode doctor` with the same `--config` to see the loader diagnostic.",
  [ErrorCode.CC1006]:
    "Fix the JSON/TypeScript syntax at the reported location, then rerun the command.",
  [ErrorCode.CC1007]:
    "Rename the config to `cinecode.config.ts` or `cinecode.config.json`, or pass a supported file with `--config`.",
  [ErrorCode.CC1008]:
    "Use one of the listed formats. Run `cinecode presets` for platform-specific container choices.",
  [ErrorCode.CC1009]:
    "Create the entry file or point `project.entry` at the existing composition module.",
  [ErrorCode.CC1010]:
    "Fix the manifest module so it exports the declared entries. Run `cinecode check` for the full report.",
  [ErrorCode.CC1011]: "Run `cinecode presets` for the list of valid preset names.",
  [ErrorCode.CC1012]:
    "Check the flag value and its documented format (for example `--resolution 1920x1080` or `--concurrency auto`).",
  [ErrorCode.CC1013]: "Fix each reported error and rerun the same command; machine output lists them under result.errors.",
  [ErrorCode.CC1014]: "Check the command help for the accepted values, then rerun with one of them.",
  [ErrorCode.CC2001]:
    "Verify the file exists at the resolved path. Run `cinecode media:list` to check media registration. Supported extensions: .mp4, .mov, .webm, .png, .jpg, .gif, .wav, .mp3, .ogg",
  [ErrorCode.CC2002]:
    "Use a supported media format. Convert your file with ffmpeg: `ffmpeg -i input.{ext} output.mp4`",
  [ErrorCode.CC2003]:
    "Verify the file is not corrupted: run `ffmpeg -i <file>` manually to inspect. Try re-exporting from your source application.",
  [ErrorCode.CC2004]:
    "Delete the stale cache entry or run `cinecode clean --cache`; the affected item is re-derived on the next run.",
  [ErrorCode.CC3001]:
    "Clips on the same track cannot overlap. Adjust their start times or move one to a different track layer.",
  [ErrorCode.CC3002]:
    "Clip duration must be positive. Set an explicit `duration` or use a non-empty media source.",
  [ErrorCode.CC3003]:
    "Trim the clip to fit within the composition duration, or extend the composition with a longer timeline.",
  [ErrorCode.CC3004]:
    "Sort keyframes by `atFrames` ascending. Use `sortKeyframes(keyframes)` from `cinecode/core/keyframes` or run `cinecode check --sort-keyframes`.",
  [ErrorCode.CC3005]:
    'Replace `Math.random()` with seeded random: `import { random } from "cinecode/core/random"; const rng = random(seed);`',
  [ErrorCode.CC3006]:
    'Install the font system-wide, embed it via `fontLoading: { strategy: "embed" }`, or use a fallback font with `fontFamilyFallback`.',
  [ErrorCode.CC3007]:
    "Use one of the registered ids, or register the missing entry in `main.ts`.",
  [ErrorCode.CC3008]:
    "Export the expected value (default export, `defineTimeline`, `defineScene`, `defineImage` or `defineAudio`).",
  [ErrorCode.CC4001]:
    "Verify the source video is not corrupted. Run `cinecode inspect <file>` to check metadata. Update ffmpeg or re-export from source.",
  [ErrorCode.CC4002]:
    "Try switching codec with `--codec h264`, reducing CRF, or checking that the output path is writable.",
  [ErrorCode.CC4003]:
    "Render was cancelled by user or timeout. Check process signals and try again.",
  [ErrorCode.CC4004]:
    "Check the reported output path and rerun with --overwrite. If the encoder failed, the coded error above names the cause.",
  [ErrorCode.CC4005]:
    "Verify the temporary video and audio buffers exist and that ffmpeg is installed. Run `cinecode doctor`.",
  [ErrorCode.CC4006]:
    "Delete the stale checkpoint under `.cinecode/cache/checkpoints` or rerun with `--fresh`.",
  [ErrorCode.CC4007]:
    "Clear the render cache with `cinecode clean --cache`; frames are recomputed on the next run.",
  [ErrorCode.CC4008]:
    "Check that the output directory exists and is writable, then rerun with --overwrite.",
  [ErrorCode.CC4009]:
    "Read each variant error above, fix the first cause, and rerun with a single `--variant` to isolate it.",
  [ErrorCode.CC5001]:
    "Check that the audio file format is supported and the sample rate matches the composition ({fps}fps → 48000Hz). Add `--audio-codec aac` if needed.",
  [ErrorCode.CC5002]:
    "Verify the sound definition is valid — oscillators, envelope, and filter params must be within acceptable ranges.",
  [ErrorCode.CC6001]: "Only http:// and https:// schemes are supported for cloud media downloads.",
  [ErrorCode.CC6002]:
    "Check network connectivity and retry. If persistent, download the file manually and reference locally.",
  [ErrorCode.CC6003]:
    "Redownload the file. The cached copy may have been corrupted during transfer.",
  [ErrorCode.CC7001]: "Upgrade Node.js to version 20 or later: `nvm install 20` then `nvm use 20`.",
  [ErrorCode.CC7002]: "Ensure ffmpeg is installed and in PATH. Run `cinecode doctor` to diagnose.",
  [ErrorCode.CC7003]:
    "Create the output directory manually or run with elevated permissions: `mkdir -p <path>`",
  [ErrorCode.CC7004]:
    "Resolve each reported issue, then rerun `cinecode health`; use `cinecode doctor` for remediation hints.",
  [ErrorCode.CC8001]:
    "Check that the plugin exports a valid `register()` function and is compatible with this cinecode version.",
  [ErrorCode.CC8002]:
    "Fix the plugin's manifest or configuration. Run `cinecode doctor` for details.",
  [ErrorCode.CC8003]:
    "Inspect the plugin code for the thrown error. Other plugins will continue loading.",
  [ErrorCode.CC8004]: "Install the missing dependency matching the required version range.",
  [ErrorCode.CC8005]:
    "Check the package name, package manager availability and network access, then retry the plugin command.",
  [ErrorCode.CC9001]:
    "Rerun with --verbose to print the stack trace, then report the failure with the code and path shown above.",
  [ErrorCode.CC9002]:
    "Compare the reported metric with the baseline, fix the regression, or rerun without the fail-on-threshold flag.",
};

export function createError(
  code: ErrorCode,
  params: Record<string, string | number> = {},
  options: ErrorOptions = {},
): CinecodeError {
  let message = ErrorMessages[code] ?? "Unknown error";
  for (const [key, value] of Object.entries(params)) {
    message = message.split(`{${key}}`).join(String(value).replace(/[{}]/g, "\\$&"));
  }

  const error = new Error(message, options.cause === undefined ? undefined : { cause: options.cause }) as CinecodeError & {
    code: ErrorCode;
    location?: ErrorLocation;
    fixHint?: string;
    severity: "error" | "warning";
  };
  error.code = code;
  error.location = options.location;
  error.fixHint = options.fixHint ?? FIX_HINTS[code];
  error.severity = options.severity ?? "error";
  return error;
}

export function wrapError(
  error: unknown,
  code: ErrorCode,
  params: Record<string, string | number> = {},
  options: ErrorOptions = {},
): CinecodeError {
  if (isCinecodeError(error)) return error;
  return createError(code, params, { ...options, cause: options.cause ?? error });
}

export function errorPath(error: CinecodeError): string | undefined {
  return error.location?.file;
}

export function formatError(error: CinecodeError, verbose = false, color = true): string {
  const parts: string[] = [];
  const red = color ? "\x1b[31m" : "";
  const yellow = color ? "\x1b[33m" : "";
  const gray = color ? "\x1b[90m" : "";
  const reset = color ? "\x1b[0m" : "";
  const bold = color ? "\x1b[1m" : "";

  const severityBadge =
    error.severity === "error" ? `${red}✗ Error${reset}` : `${yellow}⚠ Warning${reset}`;
  parts.push(`${severityBadge}: ${bold}[${error.code}]${reset} ${error.message}`);

  if (error.location) {
    const locParts: string[] = [];
    if (error.location.file) locParts.push(error.location.file);
    if (error.location.line !== undefined) locParts.push(String(error.location.line));
    if (error.location.column !== undefined) locParts.push(String(error.location.column));
    if (error.location.clip) locParts.push(`clip ${error.location.clip}`);
    if (error.location.track) locParts.push(`track ${error.location.track}`);
    if (error.location.time) locParts.push(error.location.time);
    if (locParts.length > 0) {
      parts.push(`  ${gray}Location${reset}: ${locParts.join(":")}`);
    }
  } else {
    parts.push(`  ${gray}Location${reset}: runtime (check stack trace for source)`);
  }

  if (error.fixHint) {
    parts.push(`  ${yellow}Fix${reset}: ${error.fixHint}`);
  }

  if (verbose && error.cause instanceof Error && error.cause.message !== error.message) {
    parts.push(`  ${gray}Cause${reset}: ${error.cause.message}`);
  }

  if (verbose && error.stack) {
    parts.push(`\n${error.stack}`);
  }

  return parts.join("\n");
}

/** Categorizes an error by its code prefix into a phase name. */
export function categorizeError(code: string): string {
  const prefix = code.slice(0, 3);
  const map: Record<string, string> = {
    CC1: "config",
    CC2: "media",
    CC3: "authoring",
    CC4: "render",
    CC5: "audio",
    CC6: "plugin",
    CC7: "dev",
    CC8: "plugin",
  };
  return map[prefix] ?? "general";
}

/** Formats all errors from a check/validation run, grouped by category. */
export function formatErrorReport(errors: CinecodeError[]): string {
  if (errors.length === 0) return "";

  const byCategory = new Map<string, CinecodeError[]>();
  for (const error of errors) {
    const cat = categorizeError(error.code);
    const existing = byCategory.get(cat) ?? [];
    existing.push(error);
    byCategory.set(cat, existing);
  }

  const formatted: string[] = [];
  for (const [category, categoryErrors] of byCategory) {
    formatted.push(`\n${"=".repeat(60)}`);
    formatted.push(`${category.toUpperCase()} ERRORS (${categoryErrors.length})`);
    formatted.push("=".repeat(60));
    for (const error of categoryErrors) {
      formatted.push(formatError(error));
    }
  }

  formatted.push(`\n${"=".repeat(60)}`);
  formatted.push(`Total: ${errors.length} issue(s)`);
  formatted.push("=".repeat(60));

  return formatted.join("\n");
}

export function isCinecodeError(error: unknown): error is CinecodeError {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^CC\d{4}$/.test(code);
}
