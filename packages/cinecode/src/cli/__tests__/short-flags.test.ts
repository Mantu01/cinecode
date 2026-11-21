import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SHORT_FLAG_CONCEPTS } from "../short-flags.js";
import { COMMANDS } from "../command-registry.js";

const commandReference = fileURLToPath(new URL("../../../../../docs/command-reference.md", import.meta.url));

test("one letter means one concept in the table", () => {
  const byLetter = new Map<string, string>();
  const concepts = new Set<string>();
  for (const entry of SHORT_FLAG_CONCEPTS) {
    assert.equal(byLetter.get(entry.letter), undefined, entry.letter);
    assert.equal(concepts.has(entry.concept), false, entry.concept);
    byLetter.set(entry.letter, entry.concept);
    concepts.add(entry.concept);
  }
});

test("the generated reference uses the table letters for the table concepts", () => {
  const reference = readFileSync(commandReference, "utf8");
  const rows = reference.matchAll(/^\| `(-([A-Za-z]), --([a-z0-9-]+)[^`]*)` \|/gm);
  const shorts = new Map<string, Set<string>>();
  for (const row of rows) {
    const letter = row[2]!;
    const long = row[3]!;
    if (!shorts.has(letter)) shorts.set(letter, new Set());
    shorts.get(letter)!.add(long);
  }
  for (const [letter, longs] of shorts) {
    const concept = SHORT_FLAG_CONCEPTS.find((entry) => entry.letter === letter);
    assert.ok(concept, `documented short flag -${letter} has no concept`);
    for (const long of longs) assert.ok(concept.longs.includes(long), `-${letter} is documented for --${long}`);
  }
});

test("no command reinstates a retired short flag or the deprecated alias", async () => {
  for (const spec of COMMANDS) {
    const command = await spec.load();
    const flags = command.options.map((option) => option.flags).join(" ");
    assert.doesNotMatch(flags, /--props/, spec.name);
    assert.doesNotMatch(flags, /-v, --variants/, spec.name);
  }
  const reference = readFileSync(commandReference, "utf8");
  assert.doesNotMatch(reference, /--props/);
  assert.doesNotMatch(reference, /-v, --variants/);
});
