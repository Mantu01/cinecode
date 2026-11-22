# Testing Strategy & Verification Architecture

Cinecode enforces deterministic, self-contained verification tooling designed to catch silent failures, ensure cross-platform parity, and guarantee zero-drift between implementation, schema, templates, and documentation.

## Testing Architecture

```
              ┌───────────────────────────┐
              │      End-to-End Gate      │  (Tarball pack & install gate, clean project
              │   (install-gate.mjs)      │   CLI 1-frame render, scaffolding, packaging)
              ├───────────────────────────┤
              │    Deterministic Suite    │  (26 automated check scripts running across
              │       (verify.mjs)        │   contracts, builders, preflight, codecs, etc)
              ├───────────────────────────┤
              │   Package Test Harness    │  (DEFERRED — node --test is not executed
              │        (deferred)         │   in this development pass)
              └───────────────────────────┘
```

### 1. Deterministic Verification Suite (`scripts/verify.mjs`)

The primary verification engine consists of focused check scripts chained in `scripts/verify.mjs`:

1. **Source Check** (`check-source.mjs`): Asserts no Windows backslash import specifiers and no unsanctioned `shell: true` child process invocations.
2. **Error Model** (`check-errors.mjs`): Validates 94 error codes (`CC0001`–`CC9002`), messages, fix hints, typed constructors, and exit codes.
3. **Command Registry** (`check-registry.mjs`): Enforces 30 canonical commands, aliases, contracts, and parameter boundaries.
4. **Option Parsing** (`check-options.mjs`): Validates 160+ options across all commands, pre-parser, and numeric bounds.
5. **Preflight Pipeline** (`check-preflight.mjs`): Validates resolution order, discovery boundary, roots, write boundary, consent gates, and dry-run.
6. **Machine Envelope** (`check-envelope.mjs`): Verifies stream purity (stdout = single JSON envelope), schema validation, artifact verification, and stable exit codes.
7. **Surface Contracts** (`check-surface.mjs`): Verifies CLI help contracts, aliases, removed command rejection, and help partitioning.
8. **Config Load** (`check-config-load.mjs`, `check-config-consumers.mjs`): Safe token-based migration, unknown key refusal, explicit path preservation, and consumer tracing.
9. **Manifest Contract** (`check-manifest-contract.mjs`, `check-entry-resolution.mjs`): Shape checking, duplicate ID detection, entry file resolution, and root boundary enforcement.
10. **Builder Semantics** (`check-builder-semantics.mjs`): Sequence chaining, track builders, transitions, and clip timing invariants.
11. **Audio Contract** (`check-audio-contract.mjs`): 4096-frame chunk streaming, sample rate conversion (22050, 44100, 48000, 96000 Hz), peak detection, limiter, and non-finite exclusion.
12. **Media Policy** (`check-media-policy.mjs`): Four non-overlapping roots (`sourceDir`, `mediaDir`, `outputDir`, `cacheDir`), read-only media root, and path escape prevention.
13. **Output Plans** (`check-output-plans.mjs`): 13 canonical output plans (`mp4`, `webm`, `prores`, `mkv`, `avi`, `gif`, `apng`, `png`, `jpg`, `webp`, `pdf`, `webm-alpha`, `prores-alpha`).
14. **Render Unification** (`check-render-unification.mjs`): Unified render execution for timelines, scenes, and compositions.
15. **Validation Engine** (`check-validation-engine.mjs`): Multi-tier validator reporting coded errors and actionable fix hints.
16. **Doctor & Health** (`check-doctor-health.mjs`): Offline environment and project health checks with auto-repair diagnostics.
17. **Maintenance Commands** (`check-maintenance.mjs`): Cache pruning, orphan reporting, spool sweeping, and artifact cleanup.
18. **First-Run Scaffolding** (`check-first-run.mjs`): Scaffold creation, templates, questionnaire wizard, and manifest generation.
19. **Preview Host & Engine** (`check-preview-host.mjs`, `check-preview-engine.mjs`): Read-only HTTP/WebSocket preview server, binary frame transport (`CCFR`), and camera overrides.
20. **Dev Incremental Updates** (`check-dev-incremental.mjs`): Transitive module dependency graph, watcher lifecycle, and dirty-rect invalidation.
21. **Binary Memoization & Decode** (`check-binary-decode.mjs`): Subprocess spawn bounding, memoized binary resolver, and single persistent decoder pipe per source.
22. **Resource Planner & Global Cache** (`check-resources.mjs`): Single byte budget driving workers, chunk size, queue depth, and global cross-partition LRU cache.
23. **Documentation Drift** (`check-docs.mjs`): Automated generation and drift validation ensuring docs match runtime constants exactly.

### 2. Clean Installation Gate (`scripts/gate/install-gate.mjs`)

The install gate simulates real user installations:
- Packs `packages/cinecode` and `packages/create-cinecode` into `.tgz` tarballs using `npm pack`.
- Installs the tarballs into an isolated temporary directory.
- Runs CLI scaffolding, single-frame rendering, and validation in clean environment.
- Fails closed if any tarball lacks essential files or includes untracked build artifacts.

### 3. Package Test Harness (Deferred)

> [!NOTE]
> The internal package test harness (`node --test`) is explicitly **DEFERRED** in this pass. All functional and contract guarantees are enforced by the deterministic verification suite (`scripts/verify.mjs`) and the clean installation gate (`scripts/gate/install-gate.mjs`).
