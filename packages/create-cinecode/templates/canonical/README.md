# {{PROJECT_NAME}}

A [Cinecode](https://github.com/Mantu01/cinecode) project ({{LANGUAGE}}). Every
video is written as code:

- **`cinecode.config.{{CONFIG_EXT}}`** — project settings and, most importantly,
  **video quality**. The renderer never silently downgrades a render, so the
  output is exactly what you configure here.
- **`main.{{CONFIG_EXT}}`** — the project manifest. It registers every image,
  audio bed, scene and timeline by id, each pointing at an isolated file under
  `src/`.

## Runtime & Authoring Contract

- **Node.js Requirement:** Node `>=22.18.0`.
- **Authoring Contract:** Native type stripping. Erasable TypeScript syntax is accepted (types, interfaces, type aliases). Non-erasable constructs (enums, namespaces) are not supported. Use explicit file extensions (`.{{CONFIG_EXT}}`) in relative imports.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with granular HMR for scenes, images and audio |
| `npm run render` | Render every timeline (from `main.{{CONFIG_EXT}}`) to `output/videos/` |
| `npm run render:all` | Render all timelines explicitly |
| `npm run generate` | Interactively generate assets |
| `npm run generate:image` | Render every registered image to `output/images/` |
| `npm run generate:audio` | Render every registered audio bed to `output/audio/` |
| `npm run generate:scene` | Render every registered scene to `output/scenes/` |
| `npm run generate:timeline` | Render every registered timeline to `output/videos/` |
| `npm run generate:all` | Generate images, audio, scenes and timelines |
| `npm run preview` | Fast preview-quality render |
| `npm run still` | Export a single frame as PNG |
| `npm run inspect` | Print the resolved timeline |
| `npm run validate` | Validate config, compositions, media and fonts |
| `npm run doctor` | Check the environment and project health |
| `npm run clean` | Delete the render cache |
| `npm run media:list` | List local media files |
| `npm run media:download` | Download configured cloud media |
| `npm run typecheck` | Type-check project source |
| `npm run lint` | Lint project source |
| `npm run format` | Verify formatting |

## Fast Authoring Model

Animate properties, do not emit a clip per frame.

Instead of generating a slice of video for every frame with loops, define persistent visual clips with `keyframes`. For example, create a single text clip spanning the full scene duration and attach an opacity or transform keyframe track that interpolates from start to finish. The renderer interpolates keyframes smoothly on the fly, reducing composition data by over 99% and avoiding unnecessary object allocation.

## Quality

Video quality is controlled entirely from `cinecode.config.{{CONFIG_EXT}}`:

```{{CONFIG_EXT}}
render: {
  format: "mp4",
  quality: "final",   // draft | preview | medium | final | lossless
  codec: "h264",      // h264 | h265 | av1 | prores | vp9
  // crf: 0,          // explicit CRF (0 = lossless); overrides the profile
  preset: "slow",
}
```

For a pristine master, set `quality: "lossless"` (or `crf: 0`). You can also
override per render without touching the config:

```
cinecode render --quality lossless
cinecode render --codec h265 --crf 16
```

## Folders

| Folder | Purpose |
| --- | --- |
| `cinecode.config.{{CONFIG_EXT}}` | Project configuration, including video quality |
| `main.{{CONFIG_EXT}}` | Manifest of images, audio, scenes and timelines |
| `src/scenes/` | Scene definitions |
| `src/images/` | Standalone stills |
| `src/audio/` | Procedural audio beds |
| `src/timelines/` | Hand-authored timelines (optional) |
| `media/` | Source media (the starter renders without any) |
| `output/` | Rendered images, audio, scenes and videos |
| `.cinecode/` | Render cache |
