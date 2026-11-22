# Cinecode Release Engineering & Governance

This document describes the canonical release procedure, artifact packaging, dist-tag distribution policies, and deprecation governance for Cinecode.

---

## 1. Release Principles

1. **One reviewed commit**: Releases are cut from a verified commit on `main`.
2. **Reproducible builds**: Clean clone, frozen lockfile, identical build output across rebuilds.
3. **No dirty trees**: Building the repository must leave git working tree completely clean.
4. **Isolated verification**: Releases are verified using packed tarballs in clean standalone environments outside the workspace before publishing.
5. **Human publishing**: Automated CI gates guard the release, but tagging and publishing remain explicit human actions.

---

## 2. Release Procedure

Follow this step-by-step checklist to prepare and publish a release:

### Step 1: Clean Clone & Dependency Installation
```bash
git clone git@github.com:Mantu01/cinecode.git cinecode-release
cd cinecode-release
git checkout main
pnpm install --frozen-lockfile
```

### Step 2: Build All Packages
```bash
pnpm build
git diff --exit-code
```
The tree must remain completely clean after build.

### Step 3: Run Full Verification Suite
```bash
pnpm verify
```
This runs all 26+ verification gates, schema validators, hygiene checks, and doc drift tests.

### Step 4: Run Packed Artifact & Acceptance Sweeps
```bash
pnpm verify:artifact:full
pnpm run check:acceptance
```
Verifies:
- Both tarballs pack cleanly with exact allowlisted files.
- Standalone installation outside workspace succeeds.
- Both TypeScript and JavaScript projects scaffold, validate, and render.
- Preview host enforces read-only verb boundaries.

### Step 5: Dry-Run Publish
```bash
cd packages/cinecode
npm publish --dry-run --provenance --access public

cd ../create-cinecode
npm publish --dry-run --provenance --access public
cd ../..
```

### Step 6: Create Annotated Git Tag
```bash
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

### Step 7: Publish to npm Registry
```bash
cd packages/cinecode
npm publish --provenance --access public

cd ../create-cinecode
npm publish --provenance --access public
cd ../..
```

---

## 3. Dist-Tag Policy

- **`latest`**: Points strictly to the highest stable production release. Never assigned until all matrix gates, packed install checks, and acceptance sweeps pass.
- **`next`**: Release candidates (`1.1.0-rc.0`) and staging builds.
- **`beta`**: Feature-complete preview releases undergoing stabilization.
- **`alpha`**: Early exploratory builds.

Publishing a prerelease must always specify the tag:
```bash
npm publish --tag beta --provenance --access public
```

---

## 4. Version Lockstep & Single Edit Site

The monorepo maintains lockstep versioning:
- `packages/cinecode/package.json` (`version`)
- `packages/create-cinecode/package.json` (`version`)
- `packages/create-cinecode/src/scaffold.ts` (`FRAMEWORK_RANGE`)
- `CHANGELOG.md`

All four locations must agree on every release. Automated check `pnpm run check:version-lockstep` enforces this policy.

---

## 5. Deprecation & Lifecycle Policy

1. **Commands & CLI Options**:
   - Renamed or aliased commands remain supported for at least 1 minor version cycle.
   - Deprecated commands emit structured warnings (`CC7001`) with clear replacement instructions in both human and `--json` machine outputs.
2. **Configuration Keys**:
   - Deprecated keys are handled by `cinecode migrate` with automatic AST transformation rules.
3. **Public API Exports**:
   - APIs marked deprecated remain callable until the next major release.
