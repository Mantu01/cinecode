import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");

describe("Phase 37: Final acceptance sweep", () => {
  it("classifies all audit findings from plan/missing.md in final-report.md", () => {
    const missingMd = readFileSync(resolve(repo, "plan/missing.md"), "utf8");
    const finalReportMd = readFileSync(resolve(repo, "docs/final-report.md"), "utf8");

    const findingMatches = [...missingMd.matchAll(/### (M-\d+)/g)].map((m) => m[1]);
    ok(findingMatches.length >= 80, "Expected at least 80 audit findings");

    for (const id of findingMatches) {
      const present = finalReportMd.includes(`| ${id} |`);
      ok(present, `Finding ${id} must be present and classified in docs/final-report.md`);
    }
  });

  it("documents and satisfies all 7 acceptance gates with recorded evidence", () => {
    const finalReportMd = readFileSync(resolve(repo, "docs/final-report.md"), "utf8");
    const gates = [
      "Gate 1: Packaging and Clean Install",
      "Gate 2: Template Scaffolding and Command Integrity",
      "Gate 3: Determinism and Visual Fidelity",
      "Gate 4: Audio Streaming and Muxing Policy",
      "Gate 5: Resource Bounds and Cancellation",
      "Gate 6: Read-Only Preview Server and Viewer Protocol",
      "Gate 7: Documentation Completeness and Executable Validation",
    ];

    for (const gate of gates) {
      ok(finalReportMd.includes(gate), `Final report must cover ${gate}`);
    }
  });

  it("verifies contributing guide links to architecture and system invariants", () => {
    const contribPath = resolve(repo, "CONTRIBUTING.md");
    ok(existsSync(contribPath), "CONTRIBUTING.md must exist");

    const content = readFileSync(contribPath, "utf8");
    ok(content.includes("docs/architecture.md"), "Must reference architecture docs");
    ok(content.includes("Local-Only Shipped Surface"), "Must state local-only invariant");
    ok(content.includes("Deterministic Renders"), "Must state determinism invariant");
    ok(content.includes("One Project Contract"), "Must state project contract invariant");
    ok(content.includes("Publishability & Clean Install"), "Must state publishability invariant");
    ok(content.includes("Read-Only Preview"), "Must state read-only preview invariant");
    ok(content.includes("No Silent Quality Downgrades"), "Must state no silent downgrade invariant");
    ok(content.includes("Byte-Bounded Resources"), "Must state byte-bounded resources invariant");
  });

  it("verifies repository hygiene: no file: deps, no temporary root files", () => {
    const pkgs = [
      "package.json",
      "packages/cinecode/package.json",
      "packages/create-cinecode/package.json",
    ];

    for (const rel of pkgs) {
      const pkgJson = JSON.parse(readFileSync(resolve(repo, rel), "utf8"));
      const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
      for (const [name, version] of Object.entries(allDeps)) {
        if (typeof version === "string") {
          ok(
            !version.startsWith("file:"),
            `${rel} must not contain local file: dependency on ${name}`,
          );
        }
      }
    }

    ok(!existsSync(resolve(repo, "temp-before-intro.ts")), "temp-before-intro.ts must be absent");
  });

  it("verifies deliberate limitations are documented in support matrix", () => {
    const matrixMd = readFileSync(resolve(repo, "docs/support-matrix.md"), "utf8");
    ok(matrixMd.includes("Hardware Acceleration"), "Support matrix must document acceleration baseline");
    ok(matrixMd.includes("Excluded Surface"), "Support matrix must document excluded surfaces");
    ok(matrixMd.includes("ESM"), "Support matrix must document module system");
  });
});
