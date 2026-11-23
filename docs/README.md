# Cinecode Documentation

Welcome to the Cinecode documentation hub. This directory contains the canonical specifications, architectural rules, configuration guides, and CLI references for Cinecode.

---

## 🗺️ Documentation Directory

### 🏗️ Architecture & Core Contracts
| Document | Purpose | Audience |
| --- | --- | --- |
| [Architecture Rules & Contracts](rules.md) | **Single source of truth** for project shape, 4 roots, determinism, stream purity, and preview server protocol. | All Developers & Agents |
| [Architecture & System Invariants](architecture.md) | Precedence hierarchy, memory budgets, zero-copy frame pipeline, and single module ownership. | Engine Developers & Systems |
| [API Surface Stability & Governance](stability.md) | Public vs experimental API classifications, SemVer compatibility guarantees, and deprecation policy. | Integrators & Library Authors |
| [Repository Policy](policy.md) | Binding decisions on ESM-only module format, Node `>=22.18.0` requirement, and release lockstep. | Core Contributors |

### ⚙️ Authoring, Configuration & Manifest
| Document | Purpose | Audience |
| --- | --- | --- |
| [Configuration Reference](config-reference.md) | Exhaustive field-by-field reference for `cinecode.config.ts` (generated from schema). | Video Authors & Scripters |
| [Configuration Field Inventory](config-inventory.md) | Mapping of every config field to its internal normalized location and observable pipeline effect. | Engine Authors |
| [Manifest Reference](manifest-reference.md) | Specification for `main.ts` asset manifests, timeline definitions, and scene references. | Video Authors |
| [Migration Guide](migration.md) | Step-by-step instructions for upgrading from Schema v1 to Schema v2 and removed key inventory. | Migrating Users |

### 💻 CLI & Machine Integration
| Document | Purpose | Audience |
| --- | --- | --- |
| [CLI Command Reference](command-reference.md) | Complete documentation for all 30 canonical CLI verbs, option flags, defaults, and aliases. | CLI Users & Automation |
| [Machine Output Envelope](machine-output.md) | Single-document JSON envelope format emitted on `stdout` when `--json` is supplied. | Automation & Agent Tooling |
| [Error Code Catalog](error-codes.md) | Exhaustive directory of all 94 `CCxxxx` error codes, descriptions, and actionable fix hints. | Developers & Debugging |

### 🎬 Media, Formats & Performance
| Document | Purpose | Audience |
| --- | --- | --- |
| [Output Formats Specification](output-formats.md) | Detailed container, codec, color space, and alpha rules for MP4, WebM, ProRes, GIF, APNG, and PDF. | Video Authors & Production |
| [Platform & Format Support Matrix](support-matrix.md) | Compatibility matrix covering Node runtimes, operating systems, pixel formats, and encoders. | System Engineers |
| [Performance & Benchmarks](performance.md) | Engine benchmarks, bundle size baselines, frame transport timings, and memory footprint. | Systems & Optimization |

### 🛡️ Quality Assurance & Operations
| Document | Purpose | Audience |
| --- | --- | --- |
| [Testing & Verification Architecture](testing.md) | Deterministic check suite (`scripts/verify.mjs`), clean install gate, and doc drift validator. | Contributors & QA |
| [Release Engineering & Governance](release.md) | Step-by-step release checklist, artifact packaging, dist-tag governance, and provenance. | Maintainers |
| [Final Quality & Release Report](final-report.md) | Audit trail, compliance sign-offs, and verified acceptance gates across all phases. | Maintainers & Auditors |

---

## ⚡ Agent Quick Reference (Token-Efficient Cheat Sheet)

### The Four Project Roots
Every Cinecode project operates over four strictly isolated, non-overlapping paths:
- **`sourceDir`** (`src/`): Authored scenes, timelines, shader modules, code.
- **`mediaDir`** (`media/`): Static assets (images, audio, fonts, video). Read-only to the pipeline.
- **`outputDir`** (`output/`): Rendered video, audio, image sequences, and still frames.
- **`cacheDir`** (`.cinecode/cache/`): Render checkpoints, decoded audio buffers, chunk cache.

### Standard Exit Codes
| Code | Category | Associated Error Codes |
| --- | --- | --- |
| `0` | Success | — |
| `1` | General fatal / unhandled error | `CC9001`, `CC9002` |
| `2` | Usage / syntax error | `CC1001`, `CC1003`, `CC1012` |
| `3` | Validation / manifest error | `CC1002`, `CC1009`, `CC1010`, `CC1013` |
| `4` | Pipeline / render error | `CC4001`–`CC4009` |
| `5` | Audio / mixing error | `CC5001`, `CC5101` |
| `6` | Resource / memory budget error | `CC7001` |
| `130` | User abort (SIGINT) | — |

### Key CLI Commands
```bash
# Render all compositions in the project to output/
cinecode render --all --config ./cinecode.config.ts

# Render a single still image at frame 0
cinecode still --config ./cinecode.config.ts --frame 0

# Start development server with Granular HMR
cinecode dev --config ./cinecode.config.ts

# Start read-only preview viewer
cinecode preview --config ./cinecode.config.ts

# Validate project manifest, media, fonts, and compositions
cinecode validate --config ./cinecode.config.ts

# Check environment, dependencies, and project health
cinecode doctor --fix
```

### Stream Purity & Machine Mode
- When `--json` is supplied, Cinecode writes **exactly one** valid JSON envelope to `stdout`.
- Human progress, warnings, and diagnostic messages are written exclusively to `stderr`.
- Machine envelope schema: `{ schemaVersion: 2, ok: boolean, command: string, result: {...}, warnings?: [...], degradations?: [...] }`.
