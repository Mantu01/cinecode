/**
 * One letter, one concept across every command. A command that needs a short
 * flag for another meaning uses the long flag only, so muscle memory from one
 * command cannot silently change behaviour on the next.
 */
export interface ShortFlagConcept {
  readonly letter: string;
  readonly concept: string;
  /** Long flag names this letter may abbreviate. */
  readonly longs: readonly string[];
}

export const SHORT_FLAG_CONCEPTS: readonly ShortFlagConcept[] = [
  { letter: "c", concept: "composition", longs: ["composition", "composition-name"] },
  { letter: "T", concept: "timeline", longs: ["timeline"] },
  { letter: "s", concept: "scene", longs: ["scene"] },
  { letter: "f", concept: "frame", longs: ["frame"] },
  { letter: "o", concept: "output", longs: ["out", "output-dir"] },
  { letter: "p", concept: "port", longs: ["port"] },
  { letter: "n", concept: "count", longs: ["frames", "count"] },
  { letter: "r", concept: "range", longs: ["range"] },
  { letter: "d", concept: "directory", longs: ["dir"] },
  { letter: "v", concept: "verbose", longs: ["verbose"] },
  { letter: "y", concept: "confirm", longs: ["yes"] },
  { letter: "a", concept: "author", longs: ["author"] },
  { letter: "h", concept: "help", longs: ["help"] },
  { letter: "V", concept: "version", longs: ["version"] },
];

export function conceptForLetter(letter: string): ShortFlagConcept | undefined {
  return SHORT_FLAG_CONCEPTS.find((entry) => entry.letter === letter);
}
