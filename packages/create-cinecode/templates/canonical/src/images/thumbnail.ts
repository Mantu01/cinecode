import { defineImage, shape, text } from "cinecode";

/**
 * Standalone still — no timeline, no video encoder. Rendered directly by
 * `cinecode generate image`.
 */
export default defineImage(({ width, height }) => [
  shape("rectangle", {
    width,
    height,
    fill: {
      type: "linear",
      angle: 45,
      stops: [
        { color: "#0f172a", offset: 0 },
        { color: "#1e1b4b", offset: 1 },
      ],
    },
  }),
  shape("rectangle", {
    width: Math.round(width * 0.08),
    height,
    fill: "#38bdf8",
  }),
  text("CODE MEETS CINEMA", Math.round(height * 0.075), {
    fill: "#f8fafc",
    fontWeight: 800,
    letterSpacing: 2,
    transform: {
      x: Math.round(width * 0.11),
      y: Math.round(height * 0.4),
    },
  }),
  text("RENDERED BY CINECODE", Math.round(height * 0.03), {
    fill: "#38bdf8",
    fontWeight: 600,
    letterSpacing: 4,
    transform: {
      x: Math.round(width * 0.11),
      y: Math.round(height * 0.54),
    },
  }),
]);
