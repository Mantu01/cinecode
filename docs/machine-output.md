# Machine output contract

Every CLI command supports one switch, `--json`. In machine mode stdout carries
exactly one well-formed JSON document and nothing else. Human text, progress
and structured logs go to stderr.

Schema version: `1` (`MACHINE_SCHEMA_VERSION` in the CLI package).

```json
{
  "schemaVersion": 1,
  "command": "render",
  "ok": true,
  "degraded": false,
  "project": {
    "root": "/project",
    "config": "/project/cinecode.config.ts",
    "manifest": "/project/main.ts"
  },
  "result": {},
  "artifacts": [
    { "kind": "video", "path": "/project/output/videos/main.mp4", "units": 300, "unit": "frames" }
  ],
  "warnings": [{ "code": "CC7002", "message": "hardware encoder unavailable" }],
  "degradations": [
    {
      "code": "CC4001",
      "what": "chunk 4 failed to render",
      "reason": "frame decode failed",
      "input": "main",
      "instead": "32 placeholder frame(s) substituted"
    }
  ],
  "timing": { "startedAt": "2026-01-01T00:00:00.000Z", "durationMs": 1200 }
}
```

## Fields

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Always `1` for this contract. |
| `command` | Resolved command token, after alias expansion. |
| `ok` | False when the run failed; then `error` is present. |
| `degraded` | True when `degradations` is non-empty. |
| `project` | Resolved root/config/manifest paths, or `null` when the command has no project. |
| `result` | Command payload. Commands with no structured payload expose `{ "output": "..." }`. |
| `artifacts` | Files the run produced, with `units`/`unit` when countable. |
| `warnings` | Non-fatal diagnostics; they do not mark the run degraded. |
| `degradations` | Recoverable substitutions: what degraded, why, which input, what the user got instead. |
| `timing` | ISO start time and wall-clock duration. |
| `error` | Only on failure: `code`, `message`, optional `path`, `location`, `fixHint`, `cause`. |

## Errors

Failures use the `CC####` namespace. Exit codes map by category: usage `2`
(`CC0001`, `CC1014`), validation `3` (`CC1`, `CC2`, `CC3`, `CC8`),
environment `4` (`CC6`, `CC7`), cancellation `130` (`CC4003`), runtime `1`
(everything else).

A missing artifact that a command requested fails with `CC4004` instead of
reporting success.
