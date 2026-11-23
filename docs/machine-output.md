# Machine output contract

<!-- Generated automatically from machine envelope contract and registry metadata. Do not edit manually. -->

Every CLI command supports one switch, `--json`. In machine mode stdout carries
exactly one well-formed JSON document and nothing else. Human text, progress
and structured logs go to stderr.

Informational commands (`help`, `version`, `licence`) are the single exception:
they print plain text on stdout, write nothing on stderr, exit `0` and never
emit the envelope, with or without `--json`. Help and version are clean exits,
not reports.

Schema version: `1` (`MACHINE_SCHEMA_VERSION` in the CLI package).

```json
{
  "schemaVersion": 1,
  "command": "render",
  "ok": true,
  "exitCode": 0,
  "degraded": false,
  "timing": { "startedAt": "2026-11-22T00:00:00.000Z", "durationMs": 1250 },
  "project": {
    "root": "/project",
    "config": "/project/cinecode.config.ts",
    "manifest": "/project/main.ts"
  },
  "selection": [{ "id": "hero", "name": "Hero", "kind": "timeline", "width": 1920, "height": 1080, "fps": 30, "duration": 10 }],
  "result": {},
  "artifacts": [
    { "kind": "video", "path": "/project/output/videos/hero.mp4", "units": 300, "unit": "frames" }
  ],
  "warnings": [],
  "degradations": [],
  "issues": [],
  "resourceUsage": {
    "memoryRssMb": 85,
    "wallClockMs": 1250,
    "processSpawns": 3,
    "framesDecoded": 120,
    "framesFromCache": 0,
    "bytesTransferred": 248832000
  },
  "explain": null,
  "descriptor": null
}
```

## Envelope Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `1` | Schema version constant. |
| `command` | `string` | Resolved command name after alias expansion. |
| `ok` | `boolean` | `true` if command completed without unhandled errors; `false` on failure. |
| `exitCode` | `number` | Deterministic process exit code (`0`, `1`, `2`, `3`, `4`, `78`, `130`). |
| `degraded` | `boolean` | `true` when recoverable substitutions or degradation events occurred. |
| `timing` | `object` | Start timestamp (`startedAt`) and total elapsed time (`durationMs`). |
| `project` | `object | null` | Resolved paths for `root`, `config`, and `manifest` (null if standalone). |
| `selection` | `array | null` | Summary of resolved target timelines, scenes, or compositions. |
| `result` | `object` | Typed per-command payload matching the declared command result shape. |
| `artifacts` | `array` | Produced artifact records (path, kind, units, unit, sha256). |
| `warnings` | `array` | Non-fatal diagnostic warning records (`code`, `message`, `input`). |
| `degradations` | `array` | Recorded graceful degradations (`code`, `what`, `reason`, `instead`). |
| `issues` | `array` | Validation or execution issues encountered during run. |
| `resourceUsage` | `object | null` | Runtime telemetry (`memoryRssMb`, `processSpawns`, `framesDecoded`, `bytesTransferred`). |
| `explain` | `object | null` | Resolved execution plan, parameter origins, and resource plan when requested. |
| `descriptor` | `object | null` | Command descriptor metadata (options, flags, contracts). |
| `error` | `object` | Only on failure: coded error record (`code`, `message`, `fixHint`, `issues`). |

## Per-Command Result Shapes

| Command | Result Shape Type | Declared Properties |
| --- | --- | --- |
| `cinecode dev` | `object` | port, host, url, pid |
| `cinecode preview` | `object` | port, host, url, pid |
| `cinecode render` | `object` | rendered, budget, audioPlacements, audio, presets, chunkSize, hardwareAcceleration, explain, dryRun, variants |
| `cinecode still` | `object` | composition, frame, output, format, explain |
| `cinecode generate` | `object` | generated, kind, count, audio, chunkSize, hardwareAcceleration, audioPlacements, presets, budget, rendered |
| `cinecode validate` | `object` | valid, mode, stoppedAtGate, notes, contract, categories, errors, warnings, manifest, config, references |
| `cinecode clean` | `object` | deleted, cleaned, cache, output, prune, files, bytes, summary, dryRun, spoolsSwept, spoolsBytes |
| `cinecode init` | `object` | created, directory, path, dryRun, template, name, files, configValid, manifestValid, entryInsideProject, sourceDirExists, mediaDirExists, gitignoreExists, gitWarning, verificationErrors |
| `cinecode doctor` | `object` | passed, healthy, isProject, sections, checks, notes, system, ffmpeg, node, workers, diskSpace, gpu, issues, fix |
| `cinecode inspect` | `object` | composition, tracks, manifest, compositions, timelines, scenes, assets, explain, references, resolution, fps, duration, totalFrames, background, validation, clips, deep, format, graph, determinism |
| `cinecode media` | `object` | media, total, missing, unused, downloaded, skipped, failed, files |
| `cinecode plugin` | `object` | plugins, action, target, files |
| `cinecode formats` | `object` | output, input, helpers, planned, formats |
| `cinecode presets` | `object` | presets, preset, name, width, height, fps |
| `cinecode thumbnail` | `object` | thumbnail, frame, frames, files, candidates, score, dryRun |
| `cinecode export-svg` | `object` | files, composition, frames, frame, output |
| `cinecode story` | `object` | bundle, composition, generated, html, frames, slides |
| `cinecode tts` | `object` | voices, language, provider, generated |
| `cinecode compare` | `object` | similarity, diff, metrics, images, identical, frames, averageDifference, maxDifference, worstFrames |
| `cinecode diff` | `object` | diff, changes, differences, equal, files, patch, compositionA, compositionB, durationA, durationB, summary, fileA, fileB |
| `cinecode audit` | `object` | licenses, status, scannedRoots, scannedDependencies, scannedAssets, vulnerabilities, issues, timestamp, summary |
| `cinecode benchmark` | `object` | fps, frameTimeMs, frames, averageMs, peakMemoryMb, workers, totalMs, minMs, p95Ms, maxMs, comparison, dryRun |
| `cinecode migrate` | `object` | migrated, output, originalVersion, targetVersion, dryRun, modified, diff, newContent |
| `cinecode check-ignore` | `object` | ignored, included, paths, hasIgnored |
| `cinecode alias` | `object` | aliases, enabled, name, expansion, action, removed, migrated |
| `cinecode publish` | `object` | published, destination, success, target, message, url |
| `cinecode upgrade` | `object` | current, latest, currentVersion, requiresConfirm, latestVersion, hasUpgrade, upToDate, checkFailed, upgradeCommand, networkTarget, changelogUrl, breakingChanges |
| `cinecode help` | `object` | help, commands, command, usage, options |
| `cinecode version` | `object` | version, framework, node |
| `cinecode licence` | `object` | license, text, dependencies |
