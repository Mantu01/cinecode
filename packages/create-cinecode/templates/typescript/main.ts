import { defineMain } from "cinecode";

export default defineMain({
  scenes: [
    {
      id: "intro",
      name: "Intro Scene",
      file: "./src/scenes/intro.ts",
      duration: 5,
    },
  ],

  timelines: [
    {
      id: "main",
      name: "Main Video",
      duration: 5,
      sceneRefs: ["intro"],
    },
  ],
});
