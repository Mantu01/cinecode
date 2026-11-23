import { defineComponent, text, timeline, track } from "cinecode";

// Components are reusable timelines; keep them deterministic and property-driven.
const titleCard = defineComponent("title-card", ({ label, width, height, start, duration }) =>
  timeline(
    track("title", [
      text(label, Math.round(height * 0.08), {
        fontFamily: "sans-serif",
        fill: "#ffffff",
        align: "center",
        transform: { x: Math.round(width / 2), y: Math.round(height / 2) },
        opacity: 0,
        keyframes: {
          opacity: [
            [0, 0],
            [0.5, 1, "easeOutCubic"],
            [2, 1],
            [2.5, 0, "easeInCubic"],
          ],
        },
        start,
        duration,
      }),
    ]),
  ),
);

export default titleCard;
