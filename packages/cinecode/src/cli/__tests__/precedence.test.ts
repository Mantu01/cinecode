import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { explicitPathsOf, normalizeConfig } from "../../config/schema.js";
import { ErrorCode } from "../../errors/index.js";
import {
  resolveRenderParameters,
  formatExplainReport,
  describeExplainReport,
  validatePrecedenceConflicts,
} from "../precedence.js";
import { renderCommand } from "../render.js";
import { runReport } from "../run-report.js";

function makeProject(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "cinecode-precedence-"));
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content);
  }
  return root;
}

test("flag overrides selection", () => {
  const config = normalizeConfig({});
  const { parameters } = resolveRenderParameters({
    flags: { fps: 24, resolution: "1920x1080" },
    selection: { name: "test", fps: 60, width: 1280, height: 720 },
    project: { root: "/test", config, mode: "file", selection: "test" },
  });
  assert.equal(parameters.fps.value, 24);
  assert.equal(parameters.fps.origin, "flag");
  assert.equal(parameters.fps.originLabel, "flag");
  assert.equal(parameters.width.value, 1920);
  assert.equal(parameters.width.origin, "flag");
  assert.equal(parameters.height.value, 1080);
  assert.equal(parameters.height.origin, "flag");
});

test("selection overrides config", () => {
  const config = normalizeConfig({
    video: { width: 1920, height: 1080, fps: 30 },
    render: { resolution: "1920x1080", fps: 30 },
  });
  const { parameters } = resolveRenderParameters({
    selection: { name: "custom", fps: 50, width: 1280, height: 720 },
    project: { root: "/test", config, mode: "file", selection: "custom" },
  });
  assert.equal(parameters.fps.value, 50);
  assert.equal(parameters.fps.origin, "selection");
  assert.equal(parameters.fps.originLabel, "selection");
  assert.equal(parameters.width.value, 1280);
  assert.equal(parameters.width.origin, "selection");
  assert.equal(parameters.height.value, 720);
  assert.equal(parameters.height.origin, "selection");
});

test("config overrides default", () => {
  const raw = { render: { format: "webm", concurrency: 4 } };
  const config = normalizeConfig(raw);
  const { parameters } = resolveRenderParameters({
    selection: { name: "clip" },
    project: { root: "/test", config, mode: "file", selection: "clip" },
    explicit: explicitPathsOf(raw),
  });
  assert.equal(parameters.format.value, "webm");
  assert.equal(parameters.format.origin, "config");
  assert.equal(parameters.format.originLabel, "render.format");
  assert.equal(parameters.concurrency.value, 4);
  assert.equal(parameters.concurrency.origin, "config");
  assert.equal(parameters.concurrency.originLabel, "render.concurrency");
  assert.equal(parameters.twoPass.value, false);
  assert.equal(parameters.twoPass.origin, "default");
});

test("absent flag honors config format and concurrency", () => {
  const raw = { render: { format: "webm", concurrency: 8 } };
  const config = normalizeConfig(raw);
  const { parameters } = resolveRenderParameters({
    selection: { name: "scene" },
    project: { root: "/test", config, mode: "file", selection: "scene" },
    explicit: explicitPathsOf(raw),
  });
  assert.equal(parameters.format.value, "webm");
  assert.equal(parameters.concurrency.value, 8);
});

test("a composition declaring a non-default size and frame rate renders at those values", async () => {
  const root = makeProject({
    "cinecode.config.json": JSON.stringify({
      schemaVersion: 2,
      video: { width: 1920, height: 1080, fps: 30 },
      render: { resolution: "1920x1080", fps: 30 },
    }),
    "comp.ts": `
      export default {
        name: "special",
        width: 1280,
        height: 720,
        fps: 50,
        duration: 2,
        rootTimeline: { tracks: [] },
      };
    `,
  });

  runReport.start("render", true);
  await renderCommand({
    root,
    file: join(root, "comp.ts"),
    all: false,
    preview: false,
    noCache: true,
    fresh: true,
    resume: false,
    overwrite: true,
    dryRun: true,
  });

  const rep = runReport.finish();
  const explain = (rep.result as any).explain;
  assert.ok(explain);
  assert.equal(explain.parameters.width.value, 1280);
  assert.equal(explain.parameters.width.origin, "selection");
  assert.equal(explain.parameters.height.value, 720);
  assert.equal(explain.parameters.height.origin, "selection");
  assert.equal(explain.parameters.fps.value, 50);
  assert.equal(explain.parameters.fps.origin, "selection");
});

test("explain output labels every origin correctly", () => {
  const raw = { render: { format: "webm", concurrency: 6 } };
  const config = normalizeConfig(raw);
  const { explain } = resolveRenderParameters({
    flags: { fps: 60, alpha: true },
    selection: { name: "hero", width: 800, height: 600 },
    project: { root: "/proj", configPath: "/proj/cinecode.config.ts", config, mode: "project", selection: "timeline hero" },
    explicit: explicitPathsOf(raw),
  });

  assert.equal(explain.parameters.fps.originLabel, "flag");
  assert.equal(explain.parameters.alpha.originLabel, "flag");
  assert.equal(explain.parameters.width.originLabel, "selection");
  assert.equal(explain.parameters.height.originLabel, "selection");
  assert.equal(explain.parameters.format.originLabel, "render.format");
  assert.equal(explain.parameters.concurrency.originLabel, "render.concurrency");
  assert.equal(explain.parameters.twoPass.originLabel, "default");
  assert.equal(explain.parameters.colorManagement.originLabel, "default");

  const formatted = formatExplainReport(explain);
  assert.match(formatted, /fps:\s+60 \(origin: flag\)/);
  assert.match(formatted, /width:\s+800 \(origin: selection\)/);
  assert.match(formatted, /format:\s+webm \(origin: render\.format\)/);
  assert.match(formatted, /twoPass:\s+false \(origin: default\)/);
});

test("chunk size and hardware acceleration resolve from flag, config and default", () => {
  const raw = { render: { chunkSize: 48, hardwareAcceleration: "qsv" } };
  const config = normalizeConfig(raw);
  const explicit = explicitPathsOf(raw);
  const fromConfig = resolveRenderParameters({
    selection: { name: "clip" },
    project: { root: "/test", config, mode: "file", selection: "clip" },
    explicit,
  }).parameters;
  assert.equal(fromConfig.chunkSize.value, 48);
  assert.equal(fromConfig.chunkSize.origin, "config");
  assert.equal(fromConfig.hardwareAcceleration.value, "qsv");
  assert.equal(fromConfig.hardwareAcceleration.origin, "config");

  const fromFlag = resolveRenderParameters({
    flags: { chunkSize: 64, hardwareAcceleration: "nvenc" },
    selection: { name: "clip" },
    project: { root: "/test", config, mode: "file", selection: "clip" },
    explicit,
  }).parameters;
  assert.equal(fromFlag.chunkSize.value, 64);
  assert.equal(fromFlag.chunkSize.origin, "flag");
  assert.equal(fromFlag.hardwareAcceleration.value, "nvenc");
  assert.equal(fromFlag.hardwareAcceleration.origin, "flag");

  const defaults = resolveRenderParameters({ selection: { name: "clip" } }).parameters;
  assert.equal(defaults.chunkSize.value, 32);
  assert.equal(defaults.chunkSize.origin, "default");
  assert.equal(defaults.hardwareAcceleration.value, "off");
  assert.equal(defaults.hardwareAcceleration.origin, "default");
});

test("an explicit config platform preset applies every field it owns", () => {
  const raw = { render: { platformPreset: "tiktok" } };
  const config = normalizeConfig(raw);
  const fromConfig = resolveRenderParameters({
    selection: { name: "clip", width: 1920, height: 1080, fps: 60, format: "mp4", codec: "h265" },
    project: { root: "/test", config, mode: "file", selection: "clip" },
    explicit: explicitPathsOf(raw),
  });
  const fromCli = resolveRenderParameters({
    flags: { preset: "tiktok" },
    selection: { name: "clip", width: 1920, height: 1080, fps: 60, format: "mp4", codec: "h265" },
    project: { root: "/test", config: normalizeConfig({}), mode: "file", selection: "clip" },
  });
  for (const field of ["width", "height", "fps", "format", "codec", "crf"] as const) {
    assert.deepEqual(fromConfig.parameters[field].value, fromCli.parameters[field].value, field);
    assert.deepEqual(fromConfig.parameters[field].origin, fromCli.parameters[field].origin, field);
  }
  assert.equal(fromConfig.parameters.width.value, 1080);
  assert.equal(fromConfig.parameters.height.value, 1920);
  assert.equal(fromConfig.parameters.fps.value, 30);
});

test("conflict: format versus alpha fails naming both sources", () => {
  assert.throws(
    () => {
      resolveRenderParameters({
        flags: { format: "mp4", alpha: true },
      });
    },
    (err: any) => {
      assert.equal(err.code, ErrorCode.CC1012);
      assert.match(err.message, /format 'mp4'/);
      assert.match(err.message, /--format/);
      assert.match(err.message, /--alpha/);
      return true;
    },
  );
});

test("conflict: codec versus container fails naming both sources", () => {
  assert.throws(
    () => {
      resolveRenderParameters({
        flags: { format: "mp4", codec: "vp9" },
      });
    },
    (err: any) => {
      assert.equal(err.code, ErrorCode.CC1012);
      assert.match(err.message, /codec 'vp9'/);
      assert.match(err.message, /--codec/);
      assert.match(err.message, /format 'mp4'/);
      assert.match(err.message, /--format/);
      return true;
    },
  );
});

test("conflict: resolution versus preset aspect enforcement fails naming both sources", () => {
  assert.throws(
    () => {
      resolveRenderParameters({
        flags: { preset: "tiktok", resolution: "1920x1080" },
      });
    },
    (err: any) => {
      assert.equal(err.code, ErrorCode.CC1012);
      assert.match(err.message, /1920x1080/);
      assert.match(err.message, /--resolution/);
      assert.match(err.message, /tiktok/);
      return true;
    },
  );
});
