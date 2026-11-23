import { defineTimeline, timeline } from "cinecode";
import intro from "../scenes/intro.ts";

// Scene refs play back to back in array order, with no implicit overlap.
export default defineTimeline(() => timeline({ name: "main" }, intro.build({})));
