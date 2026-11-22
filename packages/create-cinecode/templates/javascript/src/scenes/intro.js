import { defineScene, shape, text, timeline, track, anchorPosition } from "cinecode";

const WIDTH = {{WIDTH}};
const HEIGHT = {{HEIGHT}};
const DURATION = 5;

export default defineScene("intro", DURATION, () => {
  const container = { width: WIDTH, height: HEIGHT };
  const cardSize = { width: Math.round(WIDTH * 0.7), height: Math.round(HEIGHT * 0.5) };
  const cardPos = anchorPosition(container, cardSize, "center");

  return timeline(
    track("main", [
      shape("rectangle", {
        width: cardSize.width,
        height: cardSize.height,
        fill: "#18181b",
        stroke: { color: "#3b82f6", width: 2 },
        transform: { x: cardPos.x, y: cardPos.y },
        opacity: 0,
        keyframes: {
          opacity: [
            [0, 0],
            [1, 1, "easeOutCubic"],
            [2.5, 1],
            [3, 0, "easeInCubic"],
          ],
        },
        start: 0,
        duration: 3,
      }),
      text("Hello, Cinecode", Math.round(HEIGHT * 0.08), {
        fontFamily: "sans-serif",
        fill: "#ffffff",
        align: "center",
        transform: { x: Math.round(WIDTH / 2), y: Math.round(HEIGHT / 2) },
        opacity: 0,
        transitionIn: { name: "fade", duration: 0.5 },
        keyframes: {
          opacity: [
            [0, 0],
            [0.5, 1, "easeOutCubic"],
            [2, 1],
            [2.5, 0, "easeInCubic"],
          ],
        },
        start: 2.5,
        duration: 2.5,
      }),
    ]),
  );
});
