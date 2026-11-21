import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  INPUT_ONLY_FORMATS,
  OUTPUT_FORMATS,
  OUTPUT_PLANS,
  outputPlanFor,
  resolveOutputPlan,
} from "../../core/output-plan.js";
import { formatCapabilityReport, formatSupportIssues, formatsReferenceMarkdown } from "../formats.js";
import { ErrorCode } from "../../errors/index.js";
import { validateManifestShape } from "../../config/zod-schema.js";
import { runCli } from "../../cli/program.js";

const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));

test("the capability table has no contradictions", () => {
  assert.deepEqual(formatSupportIssues(), []);
});

test("every implemented output format names a producer that exists", () => {
  for (const format of OUTPUT_FORMATS) {
    const plan = OUTPUT_PLANS[format];
    const support = formatCapabilityReport().output.find((entry) => entry.format === format && entry.kind !== "other");
    assert.ok(support, format);
    assert.ok(support.producer, `${format} names no producer`);
    assert.ok(existsSync(`${packageRoot}${support.producer}`), `${format} producer ${support.producer} is missing`);
    assert.equal(plan.extension === "" || plan.extension.startsWith("."), true, format);
  }
});

test("planned formats are rejected by the output plan with CC1008 and the same shape", () => {
  const planned = formatCapabilityReport().planned.map((entry) => entry.format);
  assert.deepEqual(planned.sort(), ["archive", "bmp", "tiff"]);
  const messages: string[] = [];
  for (const format of planned) {
    assert.throws(
      () => outputPlanFor(format as never),
      (error: { code?: string; message: string }) => {
        messages.push(error.message);
        return error.code === ErrorCode.CC1008 && error.message.includes(format);
      },
      format,
    );
  }
  for (const message of messages) assert.match(message, /^Unsupported (output )?format/); 
});

test("input-only formats are rejected as render outputs with a named alternative", () => {
  for (const format of INPUT_ONLY_FORMATS) {
    const gates = [
      () => outputPlanFor(format as never),
      () => resolveOutputPlan({ format: format as never }),
    ];
    for (const gate of gates) {
      assert.throws(
        gate,
        (error: { code?: string; message: string }) => {
          assert.equal(error.code, ErrorCode.CC1008, format);
          assert.match(error.message, /input format/, format);
          assert.ok(error.message.includes("mp4"), `${format} names no alternative`);
          return true;
        },
        format,
      );
    }
  }
});

test("every output command shares the one rejection gate", () => {
  const unsupported = [...formatCapabilityReport().planned.map((entry) => entry.format), ...INPUT_ONLY_FORMATS];
  for (const format of unsupported) {
    assert.throws(
      () => resolveOutputPlan({ format: format as never }),
      (error: { code?: string }) => error.code === ErrorCode.CC1008,
      format,
    );
  }
});

test("image entries reject svg instead of silently writing png", () => {
  const result = validateManifestShape({ images: [{ id: "poster", file: "./p.ts", format: "svg" }] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => issue.path.includes("format")));
});

test("the generated docs list every output format and the input capability set", () => {
  const markdown = formatsReferenceMarkdown();
  for (const format of OUTPUT_FORMATS) assert.ok(markdown.includes("| `" + format + "` |"), format);
  assert.match(markdown, /\| `wav` \| audio \| implemented \| both \|/);
  assert.match(markdown, /## Planned formats/);
});

test("formats reports human and machine capability from the same table", async () => {
  const chunks: string[] = [];
  const code = await runCli(["node", "cinecode", "formats", "--json"], {
    stdout: (text) => void chunks.push(text),
    stderr: () => undefined,
  });
  assert.equal(code, 0, chunks.join(""));
  const result = (JSON.parse(chunks.join("")).result ?? {}) as ReturnType<typeof formatCapabilityReport>;
  assert.deepEqual(
    result.output.map((entry) => entry.format),
    [...OUTPUT_FORMATS],
  );
  assert.ok(result.input.some((entry) => entry.format === "wav"));
  assert.ok(result.planned.some((entry) => entry.format === "bmp"));
});
