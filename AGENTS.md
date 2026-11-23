<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

---

# Cinecode Agent Operating Manual

> **Purpose:** This document is the fast-start orientation guide for AI agents working in this repository. It provides high-signal, token-efficient routing to every subsystem, codebase rule, and verified command.

---

## 1. Quick Orientation

- **Product:** Cinecode is a deterministic, code-first video rendering framework written in TypeScript.
- **Runtime:** Node.js `>=22.18.0` with native ESM and native type stripping.
- **Monorepo Structure:**
  - `packages/cinecode`: Core framework, CLI (`cinecode`), render engine, audio mixer, preview server.
  - `packages/create-cinecode`: Project scaffolder CLI (`create-cinecode`) and project templates.
  - `docs/`: Canonical specifications, reference tables, and architectural rules.
  - `scripts/`: Verification scripts, docs generator, and install-gate tests.

---

## 2. Strict Repository Invariants

Every agent modifying code or documentation in this repository must uphold these rules:

1. **File Size Budget:** Every TypeScript file in `packages/cinecode/src` and `packages/create-cinecode/src` must remain strictly **under 400 lines**.
2. **TypeScript & Comments:** Erasable TypeScript only (no runtime enums or decorators; explicit `.ts`/`.js` imports). Minimal comments: only single-line `// Note: ...` for non-obvious logic.
3. **The Four Roots:** User projects strictly isolate `sourceDir` (`src/`), `mediaDir` (`media/`), `outputDir` (`output/`), and `cacheDir` (`.cinecode/cache/`). The pipeline never reads outside source/media or writes outside output/cache.
4. **Machine Mode & Stream Separation:** When `--json` is passed, `stdout` must output **exactly one** valid JSON envelope. All human progress, warnings, and diagnostic logs write strictly to `stderr`.
5. **Coded Errors:** Every error carries a unique `CCxxxx` error code (from `docs/error-codes.md`), descriptive reason, and actionable `fixHint`. Never fabricate phantom files.
6. **Zero Git Operations:** Do not run `git commit`, `git push`, `git checkout -b`, or `git tag` unless explicitly commanded by the user.
7. **Manual Scaffolding Verification:** Verify changes using manual CLI execution and temporary fixture scripts; do not add unapproved test files.

---

## 3. Essential Commands Cheat Sheet

| Task | Command | Notes |
| --- | --- | --- |
| **Build Core Package** | `npm --prefix packages/cinecode run build` | Builds ESM scripts and type declarations in `dist/`. |
| **Run Doc Drift Gate** | `node scripts/check-docs.mjs` | Verifies zero-drift across 7 generated docs and 0 broken links. |
| **Regenerate Reference Docs** | `node scripts/generate-docs.mjs` | Re-generates all 7 reference markdown tables from runtime constants. |
| **Run Full Verification** | `node scripts/verify.mjs` | Runs 26 focused contract check scripts. |
| **Direct CLI Execution** | `node packages/cinecode/dist/esm/cli/main.js <cmd>` | Executes compiled Cinecode CLI with Node 22/24. |

---

## 4. Zero-Token Docs Router

Instead of reading entire documents, use this routing table to jump directly to the relevant document:

| If You Need to Know... | Consult This Document | Key Content |
| --- | --- | --- |
| **Master Doc Index** | [`docs/README.md`](docs/README.md) | Master documentation directory and navigation hub. |
| **Core Rules & Boundaries** | [`docs/rules.md`](docs/rules.md) | Four roots, single project resolver, preview server contracts. |
| **CLI Commands, Flags & Options** | [`docs/command-reference.md`](docs/command-reference.md) | All 30 canonical verbs, flags, defaults, and usage examples. |
| **Config Schema & Field Paths** | [`docs/config-reference.md`](docs/config-reference.md) | Exhaustive field-by-field reference for `cinecode.config.ts`. |
| **Config Normalized Consumers** | [`docs/config-inventory.md`](docs/config-inventory.md) | Maps authoring keys to internal consumers and observable effects. |
| **Asset Manifest Format** | [`docs/manifest-reference.md`](docs/manifest-reference.md) | Declaring scenes, timelines, images, and audio in `main.ts`. |
| **Error Codes & Fix Hints** | [`docs/error-codes.md`](docs/error-codes.md) | Catalog of all 94 `CCxxxx` codes, descriptions, and hints. |
| **Machine JSON Output Format** | [`docs/machine-output.md`](docs/machine-output.md) | Envelope structure, exit code mapping, and command shapes. |
| **Output Containers & Codecs** | [`docs/output-formats.md`](docs/output-formats.md) | Rules for MP4, WebM, ProRes, GIF, APNG, PDF, and alpha modes. |
| **Runtime & Platform Support** | [`docs/support-matrix.md`](docs/support-matrix.md) | Node runtime, OS, pixel formats, and hardware accelerators. |
| **System Invariants & Memory** | [`docs/architecture.md`](docs/architecture.md) | Precedence hierarchy, memory budgets, and zero-copy transport. |
| **Verification & Check Scripts** | [`docs/testing.md`](docs/testing.md) | Complete list of check scripts and installation gate details. |
| **API Surface Stability** | [`docs/stability.md`](docs/stability.md) | Public vs internal API classification and compatibility tiers. |
| **Schema Migration (v1 to v2)** | [`docs/migration.md`](docs/migration.md) | Removed keys, automated migration engine, and replacements. |
