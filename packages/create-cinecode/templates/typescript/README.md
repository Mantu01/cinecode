# {{PROJECT_NAME}}

A [Cinecode](https://github.com/Mantu01/cinecode) project ({{LANGUAGE}}). Every video is written as code:

- **`cinecode.config.{{CONFIG_EXT}}`** — project settings and render quality.
- **`main.{{CONFIG_EXT}}`** — manifest registering scenes and timelines.
- **`src/scenes/`** — one file per scene; **`src/timelines/`** composes scenes; **`src/components/`** holds reusable timeline pieces.

## Rules

- **Ids** are lowercase kebab-case and unique per collection.
- **Durations** are seconds and must match the timeline content.
- **Determinism**: no `Date.now()`, `Math.random()`, or environment reads inside authored modules.
- **Roots**: `media/` is read-only; outputs go to `output/`, cache to `.cinecode/cache`.

## Runtime & Authoring Contract

- **Node.js Requirement:** Node `>=22.18.0`.
- **Authoring Contract:** Native type stripping. Erasable TypeScript syntax is accepted (types, interfaces, type aliases). Non-erasable constructs (enums, namespaces) are not supported. Use explicit file extensions (`.{{CONFIG_EXT}}`) in relative imports.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with live reload |
| `npm run preview` | Start the read-only preview server |
| `npm run render` | Render the main timeline to `output/` |
| `npm run still` | Export a single frame as PNG |
| `npm run validate` | Validate config, timelines, media and fonts |
| `npm run typecheck` | Check project source syntax |

Flags are added per run, not baked into scripts: `npm run render -- --all`, `--quality lossless`, `--format gif`.

## Quality

Video quality is controlled from `cinecode.config.{{CONFIG_EXT}}`:

```{{CONFIG_EXT}}
render: {
  format: "mp4",
  quality: "final",   // draft | preview | medium | final | lossless
  codec: "h264",      // h264 | h265 | av1 | prores | vp9
  preset: "slow",
}
```

Override per render:

```bash
npx cinecode render --quality lossless
```

## Folders

| Folder | Purpose |
| --- | --- |
| `cinecode.config.{{CONFIG_EXT}}` | Project configuration |
| `main.{{CONFIG_EXT}}` | Manifest of scenes and timelines |
| `src/scenes/` | Scene definitions |
| `src/timelines/` | Timeline definitions composing scenes |
| `src/components/` | Reusable timeline components |
| `media/` | Source assets (read-only) |
| `output/` | Rendered outputs |
| `.cinecode/` | Render cache |
