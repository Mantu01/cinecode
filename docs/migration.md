# Migration Guide: Upgrading to Cinecode 1.0 (Schema v2)

This guide documents the differences between Cinecode legacy configurations and Schema v2, detailing removed keys, replacements, and automated migration.

## Automated Migration

Run `cinecode migrate` to upgrade an existing configuration file in place:

```bash
# Preview changes without modifying disk
cinecode migrate ./cinecode.config.ts --dry-run

# Perform atomic in-place migration (with backup)
cinecode migrate ./cinecode.config.ts --backup
```

The migration engine evaluates configuration files safely with a recursive-descent token parser without executing untrusted code or arbitrary expressions.

## Schema Changes (v1 to v2)

In Schema v2, configuration is organized into modular top-level blocks: `project`, `video`, `render`, `images`, `audio`, and `dev`.

### Removed Configuration Keys and Replacements

The following keys were removed because they were inert, duplicated, or violated local-only design invariants. Using any of these keys produces coded error `CC1002`:

| Removed Key | Replacement & Reason |
| --- | --- |
| `name` / `project.name` | Removed. Project identity is not configurable in this file. |
| `video.title` | Removed. Composition names come from timeline and scene definitions. |
| `video.description` | Removed. Output metadata is not configurable in this release. |
| `video.author` / `video.version` / `video.tags` / `video.license` | Removed. Metadata tags are not configurable in this release. |
| `video.aspectRatio` | Removed. Aspect ratio is derived directly from `video.width` and `video.height`. |
| `video.pixelAspectRatio` | Removed. Pixel aspect ratio is always 1 (square pixels). |
| `video.colorSpace` | Removed. Use `render.colorManagement`. |
| `render.background` | Removed. Use `video.background`. |
| `render.enforceAspectRatio` | Removed. Use `render.platformPreset` or explicit width/height. |
| `render.variants` | Removed. Run `cinecode render-multi` for resolution bundles. |
| `dev.historyDepth` | Removed. The canvas editor owns its internal history. |
| `logLevel` | Removed. Use the CLI `--verbose` flag. |
| `audio.normalize` | Removed. Apply audio processing in the timeline mixer. |
| `audio.limiter` / `audio.sidechains` | Removed. Audio limiter is always enabled by default; configure sidechains in track definitions. |
| `security` | Removed. Plugin verification is controlled by local capabilities. |
| `telemetry` | Removed in Phase 32. All telemetry has been excised. |
| `composition` | Removed. Select a composition with `--composition` or pass it directly to the render API. |
| `pluginPermissions` | Removed. Sandbox permissions are configured per plugin. |

## CLI Flag Migrations

- `--props <path>`: Removed. Use `--config <path>`.
- `--auto` on `cinecode upgrade`: Removed. `cinecode upgrade` only checks version status without network child process spawns.
- `--all`: Supported on `cinecode render` and `cinecode generate` to process all declared assets.
