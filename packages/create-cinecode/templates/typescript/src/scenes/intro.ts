import { defineScene, shape, timeline, track, anchorPosition } from "cinecode";
import titleCard from "../components/title-card.ts";

const WIDTH = {{WIDTH}};
const HEIGHT = {{HEIGHT}};
const DURATION = 5;

// A scene duration must equal its timeline content; keyframes are sorted and deterministic.
export default defineScene("intro", DURATION, () => {
  const container = { width: WIDTH, height: HEIGHT };
  const cardSize = { width: Math.round(WIDTH * 0.7), height: Math.round(HEIGHT * 0.5) };
  const cardPos = anchorPosition(container, cardSize, "center");

  const card = titleCard.build({
    label: "Hello, Cinecode",
    width: WIDTH,
    height: HEIGHT,
    start: 2.5,
    duration: 2.5,
  });

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
    ]),
    card,
  );
});
