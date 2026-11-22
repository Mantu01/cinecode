import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cinecodeDir = path.join(root, "packages", "cinecode");
const distResolver = path.join(cinecodeDir, "dist", "esm", "cli", "project-resolver.js");
const distRender = path.join(cinecodeDir, "dist", "esm", "cli", "render.js");
const distGenerate = path.join(cinecodeDir, "dist", "esm", "cli", "generate.js");
const distStill = path.join(cinecodeDir, "dist", "esm", "cli", "still.js");
const distExportSvg = path.join(cinecodeDir, "dist", "esm", "cli", "export-svg.js");
const distInspect = path.join(cinecodeDir, "dist", "esm", "cli", "inspect.js");
const distPrecedence = path.join(cinecodeDir, "dist", "esm", "cli", "precedence.js");
const distDefine = path.join(cinecodeDir, "dist", "esm", "core", "define", "definitions.js");
const distDegradations = path.join(cinecodeDir, "dist", "esm", "errors", "degradations.js");
const distErrors = path.join(cinecodeDir, "dist", "esm", "errors", "codes.js");
const distReport = path.join(cinecodeDir, "dist", "esm", "cli", "run-report.js");

// Build if necessary
execFileSync(process.execPath, [path.join(cinecodeDir, "scripts", "build.mjs")], {
  cwd: cinecodeDir,
  stdio: "inherit",
});

const { createProjectResolver } = await import(pathToFileURL(distResolver).href);
const { orchestrateRender, renderCommand } = await import(pathToFileURL(distRender).href);
const { generateCommand } = await import(pathToFileURL(distGenerate).href);
const { stillCommand } = await import(pathToFileURL(distStill).href);
const { exportSvgCommand } = await import(pathToFileURL(distExportSvg).href);
const { inspectCommand } = await import(pathToFileURL(distInspect).href);
const { resolveRenderParameters } = await import(pathToFileURL(distPrecedence).href);
const { pendingDegradations, resetDiagnostics } = await import(pathToFileURL(distDegradations).href);
const { ErrorCode } = await import(pathToFileURL(distErrors).href);
const { runReport } = await import(pathToFileURL(distReport).href);

let errors = 0;
function fail(msg) {
  console.error(`check-render-unification error: ${msg}`);
  errors++;
}

const tmpDir = path.join(root, ".tmp-render-unification-check");
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

// Setup a mock project
const mockConfigPath = path.join(tmpDir, "cinecode.config.json");
const mockMainPath = path.join(tmpDir, "main.js");
const mockFileCompPath = path.join(tmpDir, "standalone.js");

writeFileSync(
  mockConfigPath,
  JSON.stringify({
    project: { entry: "./main.js" },
    render: { format: "mp4", fps: 30 },
    overwrite: false,
  }),
);

writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ type: "module" }));

writeFileSync(path.join(tmpDir, "intro.js"), `
import { defineScene } from "${pathToFileURL(distDefine).href}";
export default defineScene("intro-scene", 1, () => ({ tracks: [{ kind: "video", clips: [{ type: "solid", color: "#000000", start: 0, duration: 1 }] }] }));
`);

writeFileSync(path.join(tmpDir, "hero.js"), `
import { defineTimeline } from "${pathToFileURL(distDefine).href}";
export default defineTimeline(() => ({ tracks: [{ kind: "video", clips: [{ type: "solid", color: "#000000", start: 0, duration: 2 }] }] }));
`);

writeFileSync(path.join(tmpDir, "credits.js"), `
import { defineTimeline } from "${pathToFileURL(distDefine).href}";
export default defineTimeline(() => ({ tracks: [{ kind: "video", clips: [{ type: "solid", color: "#000000", start: 0, duration: 1 }] }] }));
`);

writeFileSync(
  mockMainPath,
  `
import { defineMain } from "${pathToFileURL(distDefine).href}";
export default defineMain({
  timelines: [
    { id: "hero", name: "Hero Timeline", duration: 2, file: "./hero.js" },
    { id: "credits", name: "Credits", duration: 1, file: "./credits.js" },
  ],
  scenes: [
    { id: "intro-scene", name: "Intro", duration: 1, file: "./intro.js" },
  ],
});
`
);

writeFileSync(
  mockFileCompPath,
  `
export default {
  name: "StandAloneComp",
  width: 1280,
  height: 720,
  fps: 30,
  duration: 2,
  rootTimeline: { tracks: [{ kind: "video", clips: [{ type: "solid", color: "#000000", start: 0, duration: 2 }] }] },
};
`
);

try {
  // 1. Selection rule: bare render with no selector renders all timelines
  {
    const resolver = createProjectResolver({
      root: tmpDir,
      config: mockConfigPath,
      requireSelection: false,
      allowAll: true,
    });
    const resolution = await resolver.resolve();
    if (resolution.selection.kind !== "all" || resolution.selection.ids.length !== 2) {
      fail(`Expected bare render to resolve all timelines (2), got kind: ${resolution.selection.kind}, count: ${resolution.selection.ids.length}`);
    }
    if (!resolution.selection.ids.includes("hero") || !resolution.selection.ids.includes("credits")) {
      fail(`Expected hero and credits in all selection, got ${resolution.selection.ids.join(", ")}`);
    }
  }

  // 2. Selection rule: --all is a synonym for default
  {
    const resolver = createProjectResolver({
      root: tmpDir,
      config: mockConfigPath,
      all: true,
      requireSelection: false,
      allowAll: true,
    });
    const resolution = await resolver.resolve();
    if (resolution.selection.kind !== "all" || resolution.selection.ids.length !== 2) {
      fail(`Expected --all to resolve all timelines (2), got kind: ${resolution.selection.kind}`);
    }
  }

  // 3. Selection rule: timeline, scene and file are mutually exclusive
  {
    try {
      const resolver = createProjectResolver({
        root: tmpDir,
        config: mockConfigPath,
        timeline: "hero",
        scene: "intro-scene",
      });
      await resolver.resolve();
      fail("Expected conflict between --timeline and --scene to throw");
    } catch (err) {
      if (!String(err).includes("Conflicting selectors")) {
        fail(`Expected Conflicting selectors error, got ${err}`);
      }
    }

    try {
      const resolver = createProjectResolver({
        root: tmpDir,
        file: mockFileCompPath,
        timeline: "hero",
      });
      await resolver.resolve();
      fail("Expected conflict between --file and --timeline to throw");
    } catch (err) {
      if (!String(err).includes("cannot be combined with --file")) {
        fail(`Expected cannot be combined with --file error, got ${err}`);
      }
    }
  }

  // 4. Selection rule: empty manifest with no selector throws CC1010 listing paths
  {
    const emptyProjDir = path.join(tmpDir, "empty-proj");
    mkdirSync(emptyProjDir, { recursive: true });
    const emptyConfig = path.join(emptyProjDir, "cinecode.config.json");
    const emptyMain = path.join(emptyProjDir, "main.js");
    writeFileSync(emptyConfig, JSON.stringify({ project: { entry: "./main.js" } }));
    writeFileSync(emptyMain, `import { defineMain } from "${pathToFileURL(distDefine).href}";\nexport default defineMain({ timelines: [] });\n`);

    try {
      const resolver = createProjectResolver({
        root: emptyProjDir,
        config: emptyConfig,
        requireSelection: false,
        allowAll: true,
      });
      await resolver.resolve();
      fail("Expected empty manifest with no selector to throw CC1010");
    } catch (err) {
      if (err.code !== ErrorCode.CC1010) {
        fail(`Expected CC1010 for empty manifest, got ${err.code}`);
      }
      if (!err.message.includes("main.js") || !err.message.includes("cinecode.config.json")) {
        fail(`Expected CC1010 message to include main.js and config path, got ${err.message}`);
      }
    }
  }

  // 5. Still and Inspect require a selector and fail when absent
  {
    try {
      const resolver = createProjectResolver({
        root: tmpDir,
        config: mockConfigPath,
        requireSelection: true,
        allowAll: false,
      });
      await resolver.resolve();
      fail("Expected requireSelection: true with no selector to throw");
    } catch (err) {
      if (err.code !== ErrorCode.CC1012 && err.code !== ErrorCode.CC0001) {
        fail(`Expected selection error code (CC1012/CC0001), got ${err.code}`);
      }
    }
  }

  // 6. Generate requires explicit selector in non-interactive mode
  {
    try {
      await generateCommand("timeline", {
        root: tmpDir,
        config: mockConfigPath,
      });
      fail("Expected generateCommand without selector in non-interactive mode to throw CC0001");
    } catch (err) {
      if (err.code !== ErrorCode.CC0001 || !String(err.message).includes("explicit selector")) {
        fail(`Expected CC0001 explicit selector required error, got ${err.code}: ${err.message}`);
      }
    }
  }

  // 7. Negative frames and invalid export ranges are usage errors (CC0001)
  {
    // still negative frame
    try {
      await stillCommand({
        file: mockFileCompPath,
        frame: -5,
      });
      fail("Expected still with frame -5 to throw CC0001");
    } catch (err) {
      if (err.code !== ErrorCode.CC0001) {
        fail(`Expected CC0001 for still negative frame, got ${err.code}`);
      }
    }

    // still out-of-range frame
    try {
      await stillCommand({
        file: mockFileCompPath,
        frame: 9999,
      });
      fail("Expected still with frame 9999 to throw CC0001");
    } catch (err) {
      if (err.code !== ErrorCode.CC0001) {
        fail(`Expected CC0001 for still out-of-range frame, got ${err.code}`);
      }
    }

    // export-svg unordered range (10-5)
    try {
      await exportSvgCommand(mockFileCompPath, { range: "10-5" });
      fail("Expected export-svg range 10-5 to throw CC0001");
    } catch (err) {
      if (err.code !== ErrorCode.CC0001 || !err.message.includes("greater than")) {
        fail(`Expected CC0001 greater than for export-svg range 10-5, got ${err.code}: ${err.message}`);
      }
    }

    // export-svg non-numeric range
    try {
      await exportSvgCommand(mockFileCompPath, { range: "foo-bar" });
      fail("Expected export-svg range foo-bar to throw CC0001");
    } catch (err) {
      if (err.code !== ErrorCode.CC0001) {
        fail(`Expected CC0001 for export-svg non-numeric range, got ${err.code}`);
      }
    }

    // export-svg negative frame
    try {
      await exportSvgCommand(mockFileCompPath, { frame: -1 });
      fail("Expected export-svg frame -1 to throw CC0001");
    } catch (err) {
      if (err.code !== ErrorCode.CC0001) {
        fail(`Expected CC0001 for export-svg frame -1, got ${err.code}`);
      }
    }

    // export-svg out of range frame
    try {
      await exportSvgCommand(mockFileCompPath, { frame: 9999 });
      fail("Expected export-svg frame 9999 to throw CC0001");
    } catch (err) {
      if (err.code !== ErrorCode.CC0001) {
        fail(`Expected CC0001 for export-svg frame 9999, got ${err.code}`);
      }
    }
  }

  // 8. Single vs multiple output path rules
  {
    // Multiple targets: --out must be a directory (cannot be existing file)
    const existingFile = path.join(tmpDir, "blocker.txt");
    writeFileSync(existingFile, "hello");

    const resolver = createProjectResolver({
      root: tmpDir,
      config: mockConfigPath,
      requireSelection: false,
      allowAll: true,
    });
    const resolution = await resolver.resolve();

    const targets = [
      { id: "hero", name: "Hero", kind: "timeline", composition: { name: "hero", width: 1280, height: 720, fps: 30, duration: 1, rootTimeline: { tracks: [] } } },
      { id: "credits", name: "Credits", kind: "timeline", composition: { name: "credits", width: 1280, height: 720, fps: 30, duration: 1, rootTimeline: { tracks: [] } } },
    ];

    try {
      await orchestrateRender(resolution, targets, {
        out: existingFile,
        dryRun: true,
        all: true,
        preview: false,
        fresh: false,
        resume: false,
        noCache: false,
      });
      fail("Expected multiple targets with file out path to throw CC1003");
    } catch (err) {
      if (err.code !== ErrorCode.CC1003 || !err.message.includes("directory path must not be an existing file")) {
        fail(`Expected CC1003 directory path must not be an existing file, got ${err.code}: ${err.message}`);
      }
    }

    // Single target: --out must be a file (cannot be existing directory)
    const existingSubdir = path.join(tmpDir, "sub-directory");
    mkdirSync(existingSubdir, { recursive: true });

    try {
      await orchestrateRender(resolution, [targets[0]], {
        out: existingSubdir,
        dryRun: true,
        all: false,
        preview: false,
        fresh: false,
        resume: false,
        noCache: false,
      });
      fail("Expected single target with directory out path to throw CC1003");
    } catch (err) {
      if (err.code !== ErrorCode.CC1003 || !err.message.includes("file path must not be an existing directory")) {
        fail(`Expected CC1003 file path must not be an existing directory, got ${err.code}: ${err.message}`);
      }
    }
  }

  // 9. Single-target output extension correction with warning
  {
    let warned = false;
    const originalWarn = runReport.warn.bind(runReport);
    runReport.warn = (code, msg, file) => {
      if (code === ErrorCode.CC1012 && msg.includes("Output extension for format 'mp4' should be '.mp4'")) {
        warned = true;
      }
      return originalWarn(code, msg, file);
    };

    const resolver = createProjectResolver({
      root: tmpDir,
      config: mockConfigPath,
      requireSelection: false,
      allowAll: true,
    });
    const resolution = await resolver.resolve();
    const singleTarget = [
      { id: "hero", name: "Hero", kind: "timeline", composition: { name: "hero", width: 1280, height: 720, fps: 30, duration: 1, rootTimeline: { tracks: [{ kind: "video", clips: [{ type: "solid", color: "#000000", start: 0, duration: 1 }] }] } } },
    ];

    await orchestrateRender(resolution, singleTarget, {
      out: path.join(tmpDir, "custom-hero.mov"),
      dryRun: true,
      all: false,
      preview: false,
      fresh: false,
      resume: false,
      noCache: false,
    });

    runReport.warn = originalWarn;

    if (!warned) {
      fail("Expected single target with mismatched extension .mov to emit CC1012 warning correcting to .mp4");
    }
  }

  // 10. Frame-window clamping policy: clamps and records CC4001
  {
    resetDiagnostics();
    const { parameters } = resolveRenderParameters({
      flags: { to: 9999 },
      selection: { duration: 2, fps: 30 },
    });

    if (parameters.frameWindow.value.to !== 60) {
      fail(`Expected toFrame 9999 to be clamped to 60, got ${parameters.frameWindow.value.to}`);
    }

    const degs = pendingDegradations();
    const hasCC4001 = degs.some((d) => d.code === ErrorCode.CC4001 && d.what.includes("frame window"));
    if (!hasCC4001) {
      fail("Expected CC4001 degradation recorded when frame window exceeds duration");
    }

    // Negative from frame
    try {
      resolveRenderParameters({
        flags: { from: -10 },
        selection: { duration: 2, fps: 30 },
      });
      fail("Expected resolveRenderParameters with negative from to throw CC0001");
    } catch (err) {
      if (err.code !== ErrorCode.CC0001) {
        fail(`Expected CC0001 for negative from, got ${err.code}`);
      }
    }
  }

  // 11. Inspect deep mode respects machine output
  {
    let deepMachineResult = null;
    const origResult = runReport.result.bind(runReport);
    runReport.result = (payload) => {
      if (payload && payload.deep === true && payload.graph) {
        deepMachineResult = payload;
      }
      return origResult(payload);
    };

    await inspectCommand({
      file: mockFileCompPath,
      deep: true,
      json: true,
    });

    runReport.result = origResult;

    if (!deepMachineResult || !deepMachineResult.graph.includes("Composition Dependency Tree")) {
      fail("Expected inspect --deep --json to return structured document with graph");
    }
  }

} finally {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
}

if (errors > 0) {
  console.error(`check-render-unification: ${errors} failure(s)`);
  process.exit(1);
}
console.log("check-render-unification: all acceptance checks passed");
