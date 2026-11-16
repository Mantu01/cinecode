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
TypeScript type stripping enabled by default). The value lives in one place per
manifest (`engines.node`) and is consumed by doctor, health, the install gate and
the templates.

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

## Release readiness

A green typecheck is not release readiness. Release readiness is the
packed-artifact install gate in `scripts/gate/` passing from tarballs only.
