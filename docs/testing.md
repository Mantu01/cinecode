# Testing Strategy & Test Pyramid

Cinecode enforces a strict test pyramid designed to catch silent failures, ensure cross-platform rendering parity, and guarantee zero-drift between implementation, schema, templates, and documentation.

## Test Pyramid Layers

```
              ┌───────────────────────────┐
              │      End-to-End Gate      │  (Tarball install, clean project,
              │        (12 checks)        │   CLI 1-frame render, scaffolding)
              ├───────────────────────────┤
              │      Pipeline & Preview   │  (60s mix, mux policy, cancellation,
              │      Contract Tests       │   preview HTTP 405, watcher graph)
              ├───────────────────────────┤
              │     Visual Golden Tests   │  (Text, gradient, blur, alpha,
              │        (7 features)       │   transitions, motion, split-screen)
              ├───────────────────────────┤
              │    Worker Isolation Layer │  (Worker registry, pixel parity,
              │                           │   worker font registration, plugins)
              ├───────────────────────────┤
              │      Fast Unit Layer      │  (Schema parity, config validation,
              │                           │   manifest, normalization, timecodes)
              └───────────────────────────┘
```

### 1. Fast Unit Layer
- **Schema Parity**: Runtime Zod schema, normalized schema, JSON schema, and CLI authoring validators test every field against valid and invalid fixtures (`schema-parity.test.ts`).
- **Config & Normalization**: Safe token-based migration, unknown key refusal, explicit path preservation, version alignment (`normalization.test.ts`, `migration.test.ts`).
- **Manifest Validation**: Shape checking, duplicate ID detection, entry file resolution, and root boundary enforcement (`manifest-validation.test.ts`).
- **Audio Math & Timecodes**: Sample rate conversion, timecode parsing across frame rates (24, 25, 30, 60 fps), and non-finite track exclusion (`prepare.test.ts`).

### 2. Worker & Isolation Layer
- **Worker Registry**: Asserts all 28 built-in effects and 14 transitions resolve in worker thread runtimes (`registry.test.ts`).
- **Main vs Worker Pixel Parity**: Bit-for-bit identical canvas buffers between main thread and worker rendering.
- **Worker Font Registration**: Configured font faces register across worker boundary before rendering (`fonts.test.ts`).
- **Plugin Lifecycle**: Denied capabilities fail closed with `CC7001`, and contributions bootstrap cleanly into workers (`phase-31-plugin-lifecycle.test.ts`).

### 3. Visual Golden Integration Tests
Small fixtures (64x64 or 64x32) run fast (<100ms) while asserting rendering correctness:
- **Text**: Sub-pixel font rasterization, weight, and layout.
- **Linear Gradient**: Continuous multi-stop color interpolation across canvas dimensions.
- **Blur**: Gaussian blur dispersion into neighboring regions with zero bleed outside kernel.
- **Alpha**: True transparency preservation in composite buffers and canvas corners.
- **Transitions**: Crossfades and wipes sampled at three time points ($t = 0.25$, $t = 0.50$, $t = 0.75$) asserting strict monotonic opacity progression.
- **Motion & Incremental Parity**: Keyframed animations verify bit-for-bit equality between fresh renders and dirty-rect incremental sessions.
- **Split-Screen**: Layout geometry and region bounds accurately map tracks to viewports without clipping.

#### Tolerances
- **Exact Features** (Gradients, shapes, alpha, split-screen, incremental parity): Delta $= 0$.
- **Rasterized Text**: Max channel difference $\le 2$ (due to platform/OS antialiasing).

#### Golden Update Procedure
1. Run golden tests: `node --test packages/cinecode/dist-test/renderer/__tests__/golden-output.test.js`.
2. To inspect or regenerate visual baselines: `node packages/cinecode/scripts/update-goldens.mjs`.
3. Verify git diff confirms only intentional rendering improvements or bugfixes.

### 4. Pipeline Layer
- **Audio Mix**: 60-second stereo 48 kHz mix with fades, panning, and sidechain compression completes under the duration ceiling.
- **Mux Policy**: Verifies container, codec, 24-bit PCM depth, and stream preservation. Silent renders omit audio tracks.
- **Cancellation Teardown**: Interrupting a render cleanly settles worker pools, removes in-flight chunks, and deletes partial artifacts.
- **Resume & Checkpoints**: Byte-for-byte identical frames when resuming from checkpoints.

### 5. Preview & Watcher Contract
- **Read-Only Invariant**: Mutation and persist endpoints reject writes with HTTP 405 Method Not Allowed; WebSocket state updates reject with `CC6001`.
- **Transitive Invalidation**: When shared helpers or transitive dependencies change, the module graph invalidates all dependent nodes and broadcasts HMR updates.

### 6. End-to-End Install Gate
Runs outside the workspace in an isolated temporary directory:
1. `npm pack` builds production tarballs.
2. Fresh npm project installs tarballs with isolated cache.
3. 12 automated checks run without workspace symlinks:
   - CLI version & `--help` listing all documented commands.
   - Public API module loading (`defineConfig`, `defineMain`, `defineScene`).
   - CJS require blocked (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
   - Shipped JSON schema valid and loadable.
   - 1-frame still render produced (`64x32`).
   - Scaffolding tool runs and pins registry range (`^1.0.0`).
   - Scaffolded project installs and executes a dry-run render.

---

## Verification Single Entry Point

Run the entire verification pyramid locally or in CI with a single command:

```bash
node scripts/verify.mjs
```

Or via pnpm:

```bash
pnpm verify
```
