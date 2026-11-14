export type SsmlEmphasisLevel = "strong" | "moderate" | "reduced" | "none";
export type SsmlInterpretAs = "cardinal" | "ordinal" | "characters" | "date" | "time" | "fraction" | "telephone";

export interface SsmlPhoneme {
  readonly alphabet: string;
  readonly ph: string;
}

export interface SsmlSegment {
  readonly text: string;
  readonly breakBeforeMs: number;
  readonly breakAfterMs: number;
  readonly rate: number;
  readonly pitchSemitones: number;
  readonly volumeDb: number;
  readonly emphasis: SsmlEmphasisLevel;
  readonly sayAs?: SsmlInterpretAs;
  readonly phoneme?: SsmlPhoneme;
}

export interface ParsedSsml {
  readonly language: string;
  readonly voice?: string;
  readonly segments: readonly SsmlSegment[];
  readonly plainText: string;
}

interface ParseState {
  rate: number;
  pitchSemitones: number;
  volumeDb: number;
  emphasis: SsmlEmphasisLevel;
  sayAs?: SsmlInterpretAs;
  phoneme?: SsmlPhoneme;
  substitution?: string;
}

const EMPTY_STATE: ParseState = {
  rate: 1,
  pitchSemitones: 0,
  volumeDb: 0,
  emphasis: "none",
};

const BREAK_STRENGTH_MS: Readonly<Record<string, number>> = {
  none: 0,
  "x-weak": 100,
  weak: 300,
  medium: 500,
  strong: 700,
  "x-strong": 1000,
};

export function isSsml(input: string): boolean {
  return /<\s*(speak|break|prosody|emphasis|say-as|phoneme|sub)\b/i.test(input);
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    attributes[match[1]!.toLowerCase()] = match[3] ?? match[4] ?? "";
  }
  return attributes;
}

export function parseTimeToMs(value: string | undefined, fallbackMs = 0): number {
  if (!value) return fallbackMs;
  const trimmed = value.trim().toLowerCase();
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return fallbackMs;
  if (trimmed.endsWith("ms")) return numeric;
  if (trimmed.endsWith("s")) return numeric * 1000;
  return numeric;
}

export function parseRate(value: string | undefined): number {
  if (!value) return 1;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "x-slow") return 0.5;
  if (trimmed === "slow") return 0.75;
  if (trimmed === "medium" || trimmed === "default") return 1;
  if (trimmed === "fast") return 1.25;
  if (trimmed === "x-fast") return 1.5;
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return trimmed.endsWith("%") ? numeric / 100 : numeric;
}

export function parsePitch(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "x-low") return -6;
  if (trimmed === "low") return -3;
  if (trimmed === "medium" || trimmed === "default") return 0;
  if (trimmed === "high") return 3;
  if (trimmed === "x-high") return 6;
  const semitones = /^([+-]?\d+(?:\.\d+)?)st$/.exec(trimmed);
  if (semitones) return Number.parseFloat(semitones[1]!);
  const hertz = /^([+-]?\d+(?:\.\d+)?)hz$/.exec(trimmed);
  if (hertz) {
    const reference = 200;
    const target = Math.max(1, reference + Number.parseFloat(hertz[1]!));
    return 12 * Math.log2(target / reference);
  }
  const percent = /^([+-]?\d+(?:\.\d+)?)%$/.exec(trimmed);
  if (percent) return 12 * Math.log2(1 + Number.parseFloat(percent[1]!) / 100);
  return 0;
}

export function parseVolumeDb(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "silent") return -96;
  if (trimmed === "x-soft") return -18;
  if (trimmed === "soft") return -9;
  if (trimmed === "medium" || trimmed === "default") return 0;
  if (trimmed === "loud") return 6;
  if (trimmed === "x-loud") return 12;
  const decibels = /^([+-]?\d+(?:\.\d+)?)db$/.exec(trimmed);
  if (decibels) return Number.parseFloat(decibels[1]!);
  const percent = /^([+-]?\d+(?:\.\d+)?)%$/.exec(trimmed);
  if (percent) {
    const gain = Math.max(0.001, Number.parseFloat(percent[1]!) / 100);
    return 20 * Math.log10(gain);
  }
  return 0;
}

function spellCharacters(text: string): string {
  return text.split("").join(" ");
}

function normalizeInterpreter(text: string, interpretAs: SsmlInterpretAs | undefined, language: string): string {
  const trimmed = text.trim();
  if (!interpretAs || trimmed.length === 0) return text;
  const numeric = Number.parseFloat(trimmed.replace(/,/g, ""));
  switch (interpretAs) {
    case "characters":
      return spellCharacters(trimmed);
    case "ordinal": {
      if (!Number.isFinite(numeric)) return trimmed;
      const suffix = numeric % 100 >= 11 && numeric % 100 <= 13
        ? "th"
        : ["th", "st", "nd", "rd"][numeric % 10] ?? "th";
      return `${Math.trunc(numeric)}${suffix}`;
    }
    case "telephone":
      return spellCharacters(trimmed.replace(/[^\d+]/g, ""));
    case "date":
      return trimmed.replace(/[^\d\s/-]/g, "");
    case "time":
      return trimmed.replace(/[^\d\s:]/g, "");
    case "fraction": {
      const [numerator, denominator] = trimmed.split("/");
      return numerator && denominator ? `${numerator} over ${denominator}` : trimmed;
    }
    case "cardinal": {
      if (!Number.isFinite(numeric)) return trimmed;
      return new Intl.NumberFormat(language).format(numeric);
    }
    default:
      return text;
  }
}

export function parseSsml(input: string): ParsedSsml {
  const source = isSsml(input)
    ? input
    : `<speak>${input}</speak>`;
  const segments: SsmlSegment[] = [];
  const stack: ParseState[] = [{ ...EMPTY_STATE }];
  let language = "en-US";
  let voice: string | undefined;
  let pendingBreakMs = 0;
  const readState = (): ParseState => stack[stack.length - 1] ?? EMPTY_STATE;

  const tokenPattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[^>]+>|[^<]+/g;
  let token: RegExpExecArray | null;
  while ((token = tokenPattern.exec(source)) !== null) {
    const value = token[0];
    if (value.startsWith("<!--") || value.startsWith("<?")) continue;

    if (value.startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    if (value.startsWith("<")) {
      const selfClosing = /\/>$/.test(value);
      const content = value.slice(1, selfClosing ? -2 : -1);
      const spaceIndex = content.search(/\s/);
      const tag = (spaceIndex === -1 ? content : content.slice(0, spaceIndex)).toLowerCase();
      const attributes = parseAttributes(spaceIndex === -1 ? "" : content.slice(spaceIndex));
      const current = readState();

      if (tag === "speak") {
        language = attributes["xml:lang"] ?? attributes.lang ?? attributes.language ?? language;
        voice = attributes.voice ?? voice;
        continue;
      }
      if (tag === "break") {
        const duration = parseTimeToMs(attributes.time, BREAK_STRENGTH_MS[(attributes.strength ?? "medium").toLowerCase()] ?? 500);
        pendingBreakMs += Math.max(0, duration);
        continue;
      }
      if (tag === "sub") {
        stack.push({ ...current, substitution: attributes.alias ?? "" });
        continue;
      }
      if (tag === "prosody") {
        stack.push({
          ...current,
          rate: current.rate * parseRate(attributes.rate),
          pitchSemitones: current.pitchSemitones + parsePitch(attributes.pitch),
          volumeDb: current.volumeDb + parseVolumeDb(attributes.volume),
        });
        continue;
      }
      if (tag === "emphasis") {
        const level = (attributes.level ?? "moderate").toLowerCase();
        stack.push({
          ...current,
          emphasis: level === "strong" || level === "reduced" || level === "none" ? level : "moderate",
        });
        continue;
      }
      if (tag === "say-as") {
        stack.push({ ...current, sayAs: (attributes["interpret-as"] ?? attributes.interpretas ?? "cardinal").toLowerCase() as SsmlInterpretAs });
        continue;
      }
      if (tag === "phoneme") {
        stack.push({
          ...current,
          phoneme: { alphabet: attributes.alphabet ?? "ipa", ph: attributes.ph ?? "" },
        });
        continue;
      }
      if (!selfClosing) stack.push({ ...current });
      continue;
    }

    const state = readState();
    const text = state.substitution !== undefined ? state.substitution : normalizeInterpreter(value, state.sayAs, language);
    if (text.trim().length === 0 && pendingBreakMs === 0) {
      if (text.length > 0) {
        segments.push({
          text: " ",
          breakBeforeMs: 0,
          breakAfterMs: 0,
          rate: state.rate,
          pitchSemitones: state.pitchSemitones,
          volumeDb: state.volumeDb,
          emphasis: state.emphasis,
          sayAs: state.sayAs,
          phoneme: state.phoneme,
        });
      }
      continue;
    }
    segments.push({
      text,
      breakBeforeMs: pendingBreakMs,
      breakAfterMs: 0,
      rate: state.rate,
      pitchSemitones: state.pitchSemitones,
      volumeDb: state.volumeDb,
      emphasis: state.emphasis,
      sayAs: state.sayAs,
      phoneme: state.phoneme,
    });
    pendingBreakMs = 0;
  }

  if (pendingBreakMs > 0 && segments.length > 0) {
    const last = segments[segments.length - 1]!;
    segments[segments.length - 1] = { ...last, breakAfterMs: pendingBreakMs };
  }

  const plainText = segments.map((segment) => segment.text).join("").replace(/\s+/g, " ").trim();
  return { language, voice, segments, plainText };
}

export function ssmlToPlainText(input: string): string {
  return parseSsml(input).plainText;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function segmentToEdgeSsmlMarkup(segment: SsmlSegment): string {
  let markup = escapeXml(segment.text);
  if (segment.phoneme && segment.phoneme.ph.length > 0) {
    markup = `<phoneme alphabet="${escapeXml(segment.phoneme.alphabet)}" ph="${escapeXml(segment.phoneme.ph)}">${markup}</phoneme>`;
  }
  if (segment.emphasis !== "none") {
    markup = `<emphasis level="${segment.emphasis}">${markup}</emphasis>`;
  }
  const rate = Math.round(segment.rate * 100);
  markup = `<prosody rate="${rate}%" pitch="${segment.pitchSemitones >= 0 ? "+" : ""}${segment.pitchSemitones.toFixed(1)}st" volume="${segment.volumeDb >= 0 ? "+" : ""}${segment.volumeDb.toFixed(1)}dB">${markup}</prosody>`;
  if (segment.breakBeforeMs > 0) {
    markup = `<break time="${Math.round(segment.breakBeforeMs)}ms"/>${markup}`;
  }
  if (segment.breakAfterMs > 0) {
    markup = `${markup}<break time="${Math.round(segment.breakAfterMs)}ms"/>`;
  }
  return markup;
}

export function buildEdgeSsml(parsed: ParsedSsml): string {
  const body = parsed.segments.map(segmentToEdgeSsmlMarkup).join("");
  const voiceAttribute = parsed.voice ? ` voice="${escapeXml(parsed.voice)}"` : "";
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(parsed.language)}"${voiceAttribute}>${body}</speak>`;
}

export interface SystemSpeechStep {
  readonly text: string;
  readonly pauseBeforeMs: number;
  readonly rate: number;
  readonly pitchSemitones: number;
  readonly volumeDb: number;
}

export function toSystemSpeechSteps(parsed: ParsedSsml): readonly SystemSpeechStep[] {
  return parsed.segments
    .filter((segment) => segment.text.trim().length > 0 || segment.breakBeforeMs > 0)
    .map((segment) => ({
      text: segment.text,
      pauseBeforeMs: segment.breakBeforeMs,
      rate: segment.rate,
      pitchSemitones: segment.pitchSemitones,
      volumeDb: segment.volumeDb,
    }));
}

const VISEME_BY_LETTER: Readonly<Record<string, string>> = {
  a: "aa", b: "PP", c: "kk", d: "DD", e: "E", f: "FF", g: "kk", h: "hh",
  i: "I", j: "JJ", k: "kk", l: "nn", m: "PP", n: "nn", o: "O", p: "PP",
  q: "kk", r: "RR", s: "ss", t: "DD", u: "U", v: "FF", w: "U", x: "ks",
  y: "I", z: "ss",
};

export function visemeForWord(word: string): string {
  for (const letter of word.toLowerCase()) {
    const viseme = VISEME_BY_LETTER[letter];
    if (viseme) return viseme;
  }
  return "sil";
}

export interface WordBoundary {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly viseme: string;
}

export function buildWordBoundaries(text: string, startSeconds: number, durationSeconds: number): readonly WordBoundary[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0 || durationSeconds <= 0) return [];
  const weights = words.map((word) => Math.max(1, word.replace(/[^\p{L}\p{N}]/gu, "").length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = startSeconds;
  return words.map((word, index) => {
    const span = (durationSeconds * (weights[index]! / total));
    const boundary: WordBoundary = {
      text: word,
      startSeconds: cursor,
      endSeconds: cursor + span,
      viseme: visemeForWord(word),
    };
    cursor += span;
    return boundary;
  });
}
