/**
 * The one time grammar. Every option and manifest field that accepts a time or
 * frame position parses here.
 *
 *   HH:MM:SS:FF   timecode with frames; FF must be below the frame rate
 *   HH:MM:SS      timecode without frames
 *   MM:SS         timecode without hours
 *   12.5s, 250ms  decimal seconds with an explicit unit
 *   12.5          decimal seconds without a unit (bare integers are seconds)
 *   30f, frames(30)  explicit frame index
 */
export const TIME_GRAMMAR =
  "HH:MM:SS:FF, HH:MM:SS, MM:SS, 12.5s, 250ms, 12.5 (seconds), 30f or frames(30) (frame index)";

export interface ParsedTime {
  /** Absolute frame index at the caller's frame rate. */
  readonly frame: number;
  readonly seconds: number;
}

export type TimeParseResult = { readonly ok: true; readonly time: ParsedTime } | { readonly ok: false; readonly error: string };

function fail(input: string, reason: string): TimeParseResult {
  return { ok: false, error: `Invalid time "${input}": ${reason}. Accepted forms: ${TIME_GRAMMAR}.` };
}

function fromSeconds(seconds: number, fps: number): TimeParseResult {
  if (!Number.isFinite(seconds)) return fail(String(seconds), "not a finite number");
  return { ok: true, time: { frame: Math.round(seconds * fps), seconds } };
}

/** Parses one time or frame position. Nothing is guessed: unknown text is an error. */
export function parseTimeInput(input: string, fps: number): TimeParseResult {
  const text = input.trim();
  if (text.length === 0) return fail(input, "empty value");
  if (!Number.isFinite(fps) || fps <= 0) return fail(input, `frame rate ${fps} is not positive`);

  if (text.includes(":")) {
    const parts = text.split(":");
    if (parts.length < 2 || parts.length > 4) return fail(input, "a timecode has two to four colon-separated parts");
    const validParts = parts.length === 4
      ? parts.every((part) => /^\d+$/.test(part))
      : parts.slice(0, -1).every((p) => /^\d+$/.test(p)) && /^\d+(?:\.\d+)?$/.test(parts[parts.length - 1]!);
    if (!validParts) return fail(input, "timecode parts must be whole numbers");
    const numbers = parts.map(Number);
    const frames = parts.length === 4 ? numbers.pop()! : undefined;
    const [hours, minutes, seconds] = parts.length === 4 ? numbers : parts.length === 3 ? numbers : [0, ...numbers];
    if (minutes! >= 60 || seconds! >= 60) return fail(input, "minutes and seconds must be below 60");
    if (frames !== undefined && frames >= fps) return fail(input, `frame ${frames} is at or above the ${fps} fps frame rate`);
    const wholeSeconds = hours! * 3600 + minutes! * 60 + seconds!;
    return {
      ok: true,
      time: { frame: Math.round(wholeSeconds * fps + (frames ?? 0)), seconds: wholeSeconds + (frames ?? 0) / fps },
    };
  }

  const frameMatch = /^frames\((\d+)\)$/i.exec(text) ?? /^(\d+)f$/i.exec(text);
  if (frameMatch) {
    const frame = Number(frameMatch[1]);
    return { ok: true, time: { frame, seconds: frame / fps } };
  }

  const unitMatch = /^(\d+(?:\.\d+)?)(ms|s)$/i.exec(text);
  if (unitMatch) {
    const value = Number(unitMatch[1]);
    return fromSeconds(unitMatch[2]!.toLowerCase() === "ms" ? value / 1000 : value, fps);
  }

  if (/^\d+(?:\.\d+)?$/.test(text)) return fromSeconds(Number(text), fps);

  return fail(input, "the value matches no accepted form");
}

/** Frame index for the caller's frame rate; throws no error, never returns NaN. */
export function parseTimeFrame(input: string, fps: number): number {
  const result = parseTimeInput(input, fps);
  if (!result.ok) throw new Error(result.error);
  return result.time.frame;
}

/** Duration value (number or string) as positive seconds; used by manifest entries. */
export function parseDurationInput(
  value: number | string,
  fps: number,
): { readonly ok: true; readonly seconds: number } | { readonly ok: false; readonly error: string } {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: `Duration must be a finite positive number, got ${value}` };
    return { ok: true, seconds: value };
  }
  const parsed = parseTimeInput(value, fps);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.time.seconds <= 0) return { ok: false, error: `Duration must be positive, got ${parsed.time.seconds}s` };
  return { ok: true, seconds: parsed.time.seconds };
}
