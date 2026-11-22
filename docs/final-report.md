# Acceptance and Verification Status Report

This document records the acceptance verification across Cinecode, verifying implementation contracts, demonstrating release gates, recording measured performance/quality budgets, and listing deliberate limitations.

---

## 1. Audit and Implementation Verification Summary

Findings identified during the development plan are verified through the deterministic verification suite (`scripts/verify.mjs`) and the clean installation gate (`scripts/gate/install-gate.mjs`).

| Area | Focus | Status | Verification Evidence |
| --- | --- | --- | --- |
| Package & Module Format | Native ESM-only, clean export map | Verified | `scripts/gate/install-gate.mjs` (ESM exports, CJS blocked) |
| Runtime Requirement | Node.js `>=22.18.0` runtime guard | Verified | `scripts/check-preflight.mjs`, runtime guard tests |
| Error Model | 94 error codes, messages, fix hints, exit codes | Verified | `scripts/check-errors.mjs` |
| Command Surface | 30 canonical commands, 8 aliases, option bounds | Verified | `scripts/check-registry.mjs`, `scripts/check-options.mjs`, `scripts/check-surface.mjs` |
| Preflight Pipeline | Upward root discovery, write boundaries, consent | Verified | `scripts/check-preflight.mjs` |
| Machine Output | Single JSON envelope on stdout, schema version 1 | Verified | `scripts/check-envelope.mjs` |
| Config & Normalization | Zod schema, defaults, token-based migration | Verified | `scripts/check-config-load.mjs`, `scripts/check-config-consumers.mjs` |
| Manifest Contract | `defineMain` contract, isolated source files | Verified | `scripts/check-manifest-contract.mjs`, `scripts/check-entry-resolution.mjs` |
| Builders & Timelines | Sequence chaining, track builders, transitions | Verified | `scripts/check-builder-semantics.mjs` |
| Audio Architecture | Chunked mixing, limiter, sample rates (22.05–96 kHz) | Verified | `scripts/check-audio-contract.mjs` |
| Media Policy | Four distinct roots, read-only media root | Verified | `scripts/check-media-policy.mjs` |
| Output Plans | 13 output plans, alpha transparency, audio muxing | Verified | `scripts/check-output-plans.mjs` |
| Render Unification | Timelines, scenes, and compositions unified | Verified | `scripts/check-render-unification.mjs` |
| Validation Engine | Multi-tier validator with coded error hints | Verified | `scripts/check-validation-engine.mjs` |
| Doctor & Health | Offline health diagnostics and auto-repair | Verified | `scripts/check-doctor-health.mjs` |
| Maintenance | Cache pruning, spool sweeps, atomic cleaning | Verified | `scripts/check-maintenance.mjs` |
| Scaffolding | Template generation, questionnaire wizard | Verified | `scripts/check-first-run.mjs` |
| Preview Host & Engine | Read-only HTTP/WS preview server, `CCFR` binary frame stream | Verified | `scripts/check-preview-host.mjs`, `scripts/check-preview-engine.mjs` |
| Dev Incremental | Transitive graph tracking, dirty-rect invalidation | Verified | `scripts/check-dev-incremental.mjs` |
| Binary Memoization | Subprocess spawn bounding, single decode pipe | Verified | `scripts/check-binary-decode.mjs` |
| Resource Planner | Unified byte budget, worker sizing, global LRU cache | Verified | `scripts/check-resources.mjs` |
| Documentation Drift | Markdown tables generated from runtime constants | Verified | `scripts/check-docs.mjs` |

---

## 2. Release Gates

### Gate 1: Packaging and Clean Install (`scripts/gate/install-gate.mjs`)
- **Execution:** Packs `packages/cinecode` and `packages/create-cinecode` into `.tgz` tarballs using `npm pack`.
- **Validation:**
  - Installs tarballs into an isolated clean temporary directory outside the monorepo.
  - Verifies CLI executable starts cleanly and reports version matching `package.json`.
  - Verifies public API exports (`defineConfig`, `defineMain`, `defineScene`).
  - Verifies package manifest resolves via `cinecode/package.json`.
  - Confirms CommonJS `require()` is rejected under ESM-only policy (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
  - Renders single test frame successfully to output artifact.

### Gate 2: Deterministic Verification Suite (`scripts/verify.mjs`)
- **Execution:** Chains 26 automated check scripts running across contracts, option parsers, builders, and encoders.
- **Validation:**
  - Zero Windows backslash specifiers, zero unbudgeted process spawns.
  - All 94 error codes verified with messages and fix hints.
  - All 30 canonical CLI commands and 8 aliases verified.
  - Stream purity verified: machine mode writes exactly one JSON envelope to stdout; all logs go to stderr.
  - Documentation drift check asserts generated tables match runtime code constants without differences.

### Gate 3: Package Test Harness (Explicitly Deferred)
- Internal package unit testing (`node --test`) is deferred per plan instructions.

---

## 3. Measured Performance and Budgets

Measured on Windows 11 x64, Node.js v24.13.0:

| Metric | Measured Value | Budget Ceiling / Target | Status |
| --- | --- | --- | --- |
| CLI Cold Import RSS | 82.45 MB | 120 MB | Passed |
| Build Emitted Output | 492 scripts, 1 bin, 984 files | <1000 files | Passed |
| Render Memory Budget | 284 MB (9.9 MB / frame) | Configured budget | Passed |
| Process Spawns per Render | 3 processes (probe, decode, encode) | <= 3 | Passed |
| Cache Format Refusal | Verified with CC7106 note | Zero silent rebuild | Passed |
| Single Frame Budget Refusal | Verified with CC7005 | Zero unhandled OOM | Passed |

---

## 4. Deliberate Limitations

1. **Local-First & Offline:** Cinecode executes all operations locally; no telemetry or cloud rendering.
2. **ESM-Only:** CommonJS `require()` is blocked; consumers must use native ESM.
3. **Software-First Rendering Baseline:** Rendering uses `@napi-rs/canvas` (Skia) on CPU for deterministic bit-parity.
4. **Deterministic Authoring Constraints:** Dynamic non-deterministic functions (`Date.now()`, `Math.random()`) are forbidden in scene files to guarantee bit-for-bit reproducibility.
