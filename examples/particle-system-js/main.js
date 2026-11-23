import { defineMain } from "cinecode";

export default defineMain({
  scenes: [
    {
      id: "particle-nexus",
      name: "Particle Nexus",
      file: "./src/scenes/particle-nexus.js",
      duration: 12,
    },
  ],
  timelines: [
    {
      id: "main",
      name: "Main",
      sceneRefs: ["particle-nexus"],
      duration: 12,
      format: "mp4",
      codec: "h264",
      quality: "final",
    },
  ],
});