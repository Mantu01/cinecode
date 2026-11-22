export interface InstrumentationCounters {
  processSpawns: number;
  framesDecoded: number;
  framesFromCache: number;
  bytesTransferred: number;
}

const counters: InstrumentationCounters = {
  processSpawns: 0,
  framesDecoded: 0,
  framesFromCache: 0,
  bytesTransferred: 0,
};

export function getInstrumentationCounters(): Readonly<InstrumentationCounters> {
  return { ...counters };
}

export function recordProcessSpawn(): void {
  counters.processSpawns++;
}

export function recordFramesDecoded(count: number, bytes: number): void {
  counters.framesDecoded += count;
  counters.bytesTransferred += bytes;
}

export function recordFramesFromCache(count = 1, bytes = 0): void {
  counters.framesFromCache += count;
  counters.bytesTransferred += bytes;
}

export function resetInstrumentationCounters(): void {
  counters.processSpawns = 0;
  counters.framesDecoded = 0;
  counters.framesFromCache = 0;
  counters.bytesTransferred = 0;
}
