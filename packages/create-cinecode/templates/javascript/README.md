# {{PROJECT_NAME}}

A [Cinecode](https://github.com/Mantu01/cinecode) project ({{LANGUAGE}}). Every video is written as code:

- **`cinecode.config.{{CONFIG_EXT}}`** — project settings and video quality.
- **`main.{{CONFIG_EXT}}`** — project manifest registering scenes and timelines.

## Runtime & Authoring Contract

- **Node.js Requirement:** Node `>=22.18.0`.
- **Authoring Contract:** Native type stripping. Erasable TypeScript syntax is accepted (types, interfaces, type aliases). Non-erasable constructs (enums, namespaces) are not supported. Use explicit file extensions (`.{{CONFIG_EXT}}`) in relative imports.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with live reload |
| `npm run preview` | Fast preview-quality render |
| `npm run render` | Render the default timeline to `output/` |
| `npm run render:all` | Render every registered timeline |
| `npm run still` | Export a single frame as PNG |
| `npm run validate` | Validate config, timelines, media and fonts |
| `npm run clean` | Delete the render cache and outputs |
| `npm run typecheck` | Type-check project source |

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

You can also override per render:

```bash
npx cinecode render --quality lossless
```

## Folders

| Folder | Purpose |
| --- | --- |
| `cinecode.config.{{CONFIG_EXT}}` | Project configuration |
| `main.{{CONFIG_EXT}}` | Manifest of scenes and timelines |
| `src/scenes/` | Scene definitions |
| `media/` | Source assets |
| `output/` | Rendered outputs |
| `.cinecode/` | Render cache |
