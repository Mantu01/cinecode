export type TimeInput = number | string | FramesMarker;

export interface FramesMarker {
  readonly __cinecode_frames: number;
}

export function frames(count: number): FramesMarker {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`frames() requires a whole number >= 0, got ${count}`);
  }
  return { __cinecode_frames: count };
}

export function isFrames(value: TimeInput): value is FramesMarker {
  return typeof value === "object" && value !== null && "__cinecode_frames" in value;
}

export function seconds(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`seconds() requires a finite number >= 0, got ${value}`);
  }
  return value;
}

export const TIMECODE_PATTERN = /^(\d{2,}):(\d{2}):(\d{2}):(\d{2})$/;

export interface ParsedTimecode {
  hours: number;
  minutes: number;
  secondsField: number;
  framesField: number;
}

export function parseTimecode(value: string): ParsedTimecode {
  const match = TIMECODE_PATTERN.exec(value.trim());
  if (match === null) {
    throw new SyntaxError(`timecode must be "HH:MM:SS:FF", got ${JSON.stringify(value)}`);
  }
  const fields = match.slice(1).map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
    number,
    number,
  ];
  const [hours, minutes, secondsField, framesField] = fields;
  if (minutes > 59 || secondsField > 59) {
    throw new SyntaxError(`timecode has a field out of range: ${JSON.stringify(value)}`);
  }
  return { hours, minutes, secondsField, framesField };
}
