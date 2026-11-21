import { defineMain } from "cinecode";

const WIDTH = {{WIDTH}};
const HEIGHT = {{HEIGHT}};

/**
 * Root manifest - the one accepted entry shape. Export nothing else from this
 * file: compositions, timelines and assets live in the files referenced below.
 * Every entry points at an isolated file that can be generated,
 * previewed, and cached on its own:
 *   cinecode generate image      → output/images/*.png
 *   cinecode generate audio      → output/audio/*.wav
 *   cinecode generate scene      → output/scenes/*.mp4
 *   cinecode generate timeline   → output/videos/*.mp4
 */
export default defineMain({
  images: [
    {
      id: "youtube-thumbnail",
      name: "YouTube Thumbnail",
      file: "./src/images/thumbnail.{{EXT}}",
      width: WIDTH,
      height: HEIGHT,
      format: "png",
    },
  ],

  audio: [
    {
      id: "ambient",
      name: "Ambient Pad",
      file: "./src/audio/ambient.{{EXT}}",
      sampleRate: 48000,
      channels: 2,
      gain: 0.6,
      duration: 6,
    },
  ],

  scenes: [
    {
      id: "intro",
      name: "Intro Scene",
      file: "./src/scenes/intro.{{EXT}}",
      duration: 6,
    },
  ],

  timelines: [
    {
      id: "main",
      name: "Main Video",
      duration: 6,
      sceneRefs: ["intro"],
      audioRef: ["ambient"],
    },
  ],
});
