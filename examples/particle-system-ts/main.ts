import { defineMain } from "cinecode";
import particleNexus from "./src/scenes/particle-nexus.ts";

export default defineMain({
  scenes: [
    {
      id: "particle-nexus",
      name: "Particle Nexus",
      file: "./src/scenes/particle-nexus.ts",
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