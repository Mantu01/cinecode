import { defineMain } from "cinecode";

// Ids are lowercase kebab-case and unique per collection; durations are seconds and must match content.
export default defineMain({
  timelines: [
    {
      id: "main",
      name: "Main Video",
      // A timeline compiles either its file or its sceneRefs, never both.
      file: "./src/timelines/main.ts",
      duration: 5,
    },
  ],
});
