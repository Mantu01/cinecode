# Repository policy

Binding decisions for the Cinecode repository. Change a decision only by
changing this document and the code it governs in the same change set.

## Module format

**ESM-only.** `packages/cinecode` and `packages/create-cinecode` both ship native
ES modules only. There is no CommonJS build, no `.cjs` alias of ESM output, and
no `require` export condition. Consequences:

- `exports` maps expose `types` + `import` only; `main`, `module`, the `require`
  condition and `typesVersions` are not used.
- The build never renames emitted files to fake a second format.
- Consumers on CommonJS must use dynamic `import()`.

## Node support

Minimum supported Node version: **22.18.0** (first release with native
TypeScript type stripping enabled by default). The declared value lives in
`packages/cinecode/src/loader/runtime.ts` (`MIN_NODE_VERSION`); the build fails
when `engines.node` disagrees, and doctor, health, the install gate and the
templates all read the same range.

## Authoring contract

User modules (config, `extends` targets, manifest, scenes, timelines, plugins)
load through one loader (`src/loader/index.ts`) with native type stripping.

- Authoring surface: erasable TypeScript only. No `enum`, `namespace`,
  parameter properties or decorators; Node cannot strip those and the loader
  reports `USER_MODULE_UNSUPPORTED_SYNTAX` with the file and cause instead.
- Relative imports must name the real file extension (`./theme.ts`, not
  `./theme`). A missing extension fails with `USER_MODULE_IMPORT_NOT_FOUND`
  naming the file, the unresolved specifier and the rule.
- An unsupported Node version fails at startup with
  `CINECODE_RUNTIME_UNSUPPORTED`, the required range, the actual version and an
  install hint. It never degrades into a default config or an empty manifest.
- Loading is cached once per process in production; the dev server reloads with
a cache-busting key so an edited module and its transitive imports reload.

## Version ownership

- `packages/cinecode/package.json` `version` is the single source of truth for the
  framework version. `CINECODE_VERSION` reads the manifest at runtime; no version
  is duplicated in source.
- `packages/create-cinecode` releases in lockstep with the framework at the same
  version, and scaffolds the matching `^<major>.<minor>.<patch>` framework range.
- A release updates the manifest and `CHANGELOG.md` together; the two never
  disagree.

## Artifact contents

- Published files are built output, the generated JSON schema, `README.md`,
  `CHANGELOG.md` and `LICENSE`. Source, tests, fixtures, coverage and build
  scripts are never published.
- Source and declaration maps are not shipped: no `src` is published, so maps
  would point at absent files.
- The committed manifest is the manifest that ships. No build step edits
  `package.json`.

## CLI contract

- One program factory (`createProgram`) and one run function (`runCli`).
  Importing the CLI entry never parses argv, reads the home directory or exits;
  only the executable path runs it.
- Global options exist on every command from one table: `--root`, `--config`,
  `--json`, `--no-color`, `--verbose`. `--props` is a deprecated alias of
  `--config` and warns on use.
- Command implementations load lazily per command. Help and version import no
  renderer, encoder, 3D, PDF, MIDI or observability stack.
- Aliases are opt-in (`CINECODE_ALIASES=1`), applied after the command token is
  known, bounded, cycle-safe, local-first, and never rewrite a known command.
- Value-bearing flags carry no defaults so precedence stays observable.
- Exit codes: `0` success, `1` runtime, `2` usage, `3` validation,
  `4` environment, `130` cancelled. Command bodies throw `ExitSignal` instead of
  touching the process exit state.

## Release readiness

A green typecheck is not release readiness. Release readiness is the
packed-artifact install gate in `scripts/gate/` passing from tarballs only.
