import {
  defineScene,
  shape,
  text,
  timeline,
  track,
} from "cinecode";

const WIDTH = {{WIDTH}};
const HEIGHT = {{HEIGHT}};
const DURATION = 6;

const BACKGROUND = "#0a0a0a";
const IVORY = "#f5f0e8";
const GOLD = "#d4a44c";
const COPPER = "rgba(200, 117, 51, 0.32)";

const CENTER_X = Math.round(WIDTH / 2);
const CENTER_Y = Math.round(HEIGHT / 2);

const TITLE = "CINECODE";
const TAGLINE = "VIDEO, WRITTEN AS CODE";

const TITLE_SIZE = Math.round(Math.min(WIDTH * 0.1, HEIGHT * 0.2));
const TITLE_SPACING = Math.round(TITLE_SIZE * 0.05);
const TITLE_TOP = Math.round(HEIGHT * 0.4 - TITLE_SIZE * 0.62);
const RULE_Y = Math.round(HEIGHT * 0.4 + TITLE_SIZE * 0.72);
const RULE_WIDTH = Math.round(WIDTH * 0.38);

const TAGLINE_SIZE = Math.round(Math.min(WIDTH * 0.018, HEIGHT * 0.036));
const TAGLINE_SPACING_WIDE = Math.round(TAGLINE_SIZE * 0.5);
const TAGLINE_SPACING_TIGHT = Math.round(TAGLINE_SIZE * 0.22);
const TAGLINE_TOP = Math.round(RULE_Y + TAGLINE_SIZE * 1.6);

const GLOW_RADIUS = Math.round(HEIGHT * 0.42);
const RING_RADIUS = Math.round(WIDTH * 0.24);

const backgroundTrack = track(
  "background",
  [
    shape("rectangle", {
      width: WIDTH,
      height: HEIGHT,
      fill: {
        type: "radial",
        center: { x: 0.5, y: 0.4 },
        radius: 0.9,
        stops: [
          { color: "#2b251d", offset: 0 },
          { color: "#171512", offset: 0.45 },
          { color: BACKGROUND, offset: 1 },
        ],
      },
      opacity: 0,
      keyframes: {
        opacity: [[0, 0], [0.9, 1, "easeOutCubic"]],
      },
      start: 0,
      duration: DURATION,
    }),
  ],
);

const glowTrack = track(
  "glow",
  [
    shape("ellipse", {
      width: GLOW_RADIUS * 2,
      height: GLOW_RADIUS * 2,
      fill: {
        type: "radial",
        center: { x: 0.5, y: 0.5 },
        radius: 0.5,
        stops: [
          { color: COPPER, offset: 0 },
          { color: "rgba(200, 117, 51, 0.14)", offset: 0.5 },
          { color: "rgba(200, 117, 51, 0)", offset: 1 },
        ],
      },
      opacity: 0,
      transform: { x: CENTER_X - GLOW_RADIUS, y: CENTER_Y - GLOW_RADIUS },
      keyframes: {
        opacity: [[0, 0], [1.4, 0.85, "easeOutCubic"], [4.4, 0.85], [5.4, 0, "easeInCubic"]],
        "transform.x": [
          [0, CENTER_X - GLOW_RADIUS - Math.round(WIDTH * 0.02)],
          [DURATION, CENTER_X - GLOW_RADIUS + Math.round(WIDTH * 0.02), "linear"],
        ],
      },
      start: 0.1,
      duration: DURATION - 0.1,
    }),
  ],
);

const ringTrack = track(
  "ring",
  [
    shape("ellipse", {
      width: RING_RADIUS * 2,
      height: RING_RADIUS * 2,
      stroke: { color: GOLD, width: 3, lineCap: "round" },
      opacity: 0,
      transform: { x: CENTER_X - RING_RADIUS, y: CENTER_Y - RING_RADIUS, scaleX: 0.3, scaleY: 0.3 },
      keyframes: {
        scale: [[0, 0.3], [1.4, 1, "easeOutExpo"]],
        opacity: [[0, 0], [0.35, 1, "easeOutCubic"], [1.1, 1], [1.8, 0, "easeInCubic"]],
      },
      start: 0.25,
      duration: 1.85,
    }),
  ],
);

const titleTrack = track(
  "title",
  [
    text(TITLE, TITLE_SIZE, {
      fontFamily: "Arial",
      fontWeight: 800,
      letterSpacing: TITLE_SPACING,
      align: "center",
      maxWidth: WIDTH,
      fill: IVORY,
      opacity: 0,
      transform: {
        x: Math.round(CENTER_X - WIDTH / 2),
        y: TITLE_TOP + Math.round(TITLE_SIZE * 0.8),
        scaleX: 0.7,
        scaleY: 0.7,
      },
      keyframes: {
        opacity: [[0, 0], [0.4, 1, "easeOutCubic"]],
        "transform.y": [[0, TITLE_TOP + Math.round(TITLE_SIZE * 0.8)], [0.8, TITLE_TOP, "easeOutExpo"]],
        scale: [[0, 0.7], [0.8, 1, "easeOutExpo"]],
      },
      start: 1.1,
      duration: DURATION - 1.1,
    }),
  ],
);

const ruleTrack = track(
  "accent-rule",
  [
    shape("rectangle", {
      width: 2,
      height: Math.max(2, Math.round(HEIGHT * 0.004)),
      fill: GOLD,
      opacity: 0,
      transform: { x: CENTER_X, y: RULE_Y },
      keyframes: {
        width: [[0, 2], [0.6, RULE_WIDTH, "easeOutExpo"]],
        "transform.x": [[0, CENTER_X - 1], [0.6, CENTER_X - RULE_WIDTH / 2, "easeOutExpo"]],
        opacity: [[0, 0], [0.3, 1, "easeOutCubic"]],
      },
      start: 2.0,
      duration: DURATION - 2.0,
    }),
  ],
);

const taglineTrack = track(
  "tagline",
  [
    text(TAGLINE, TAGLINE_SIZE, {
      fontFamily: "Arial",
      fontWeight: 600,
      letterSpacing: TAGLINE_SPACING_WIDE,
      align: "center",
      maxWidth: WIDTH,
      fill: GOLD,
      opacity: 0,
      transform: {
        x: Math.round(CENTER_X - WIDTH / 2),
        y: TAGLINE_TOP + Math.round(TAGLINE_SIZE * 0.8),
      },
      keyframes: {
        opacity: [[0, 0], [0.5, 1, "easeOutCubic"]],
        letterSpacing: [[0, TAGLINE_SPACING_WIDE], [0.8, TAGLINE_SPACING_TIGHT, "easeOutCubic"]],
        "transform.y": [[0, TAGLINE_TOP + Math.round(TAGLINE_SIZE * 0.8)], [0.8, TAGLINE_TOP, "easeOutCubic"]],
      },
      start: 2.5,
      duration: DURATION - 2.5,
    }),
  ],
);

const fadeTrack = track(
  "fade-out",
  [
    shape("rectangle", {
      width: WIDTH,
      height: HEIGHT,
      fill: BACKGROUND,
      opacity: 0,
      transform: { x: 0, y: 0 },
      keyframes: {
        opacity: [[0, 0], [1.0, 1, "easeInCubic"]],
      },
      start: DURATION - 1.3,
      duration: 1.3,
    }),
  ],
);

export default defineScene("Intro", DURATION, () =>
  timeline([
    backgroundTrack,
    glowTrack,
    ringTrack,
    titleTrack,
    ruleTrack,
    taglineTrack,
    fadeTrack,
  ]),
);
