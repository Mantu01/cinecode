import {
  defineScene,
  layoutTextLetters,
  measureTextWidth,
  shape,
  text,
  timeline,
  track,
} from "cinecode";

const WIDTH = {{WIDTH}};
const HEIGHT = {{HEIGHT}};
const FPS = {{FPS}};
const DURATION = 6;

const BACKGROUND = "#0a0a0a";
const IVORY = "#f5f0e8";
const GOLD = "#d4a44c";
const COPPER = "rgba(200, 117, 51, 0.32)";

const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

const TITLE = "CINECODE";
const TAGLINE = "VIDEO, WRITTEN AS CODE";

const TITLE_SIZE = Math.round(Math.min(WIDTH * 0.1, HEIGHT * 0.2));
const TITLE_SPACING = Math.round(TITLE_SIZE * 0.05);
const TITLE_TOP = Math.round(HEIGHT * 0.4 - TITLE_SIZE * 0.62);
const RULE_Y = Math.round(HEIGHT * 0.4 + TITLE_SIZE * 0.72);

const TAGLINE_SIZE = Math.round(Math.min(WIDTH * 0.018, HEIGHT * 0.036));
const TAGLINE_SPACING_WIDE = Math.round(TAGLINE_SIZE * 0.5);
const TAGLINE_SPACING_TIGHT = Math.round(TAGLINE_SIZE * 0.22);
const TAGLINE_TOP = Math.round(RULE_Y + TAGLINE_SIZE * 1.6);
const TAGLINE_WIDTH = Math.round(
  measureTextWidth(TAGLINE, { fontFamily: "Arial", fontWeight: 600, fontSize: TAGLINE_SIZE, letterSpacing: TAGLINE_SPACING_WIDE }) +
    TAGLINE_SPACING_WIDE * 2 + 24,
);

const titleLayout = layoutTextLetters(TITLE, {
  fontFamily: "Arial",
  fontWeight: 800,
  fontSize: TITLE_SIZE,
  letterSpacing: TITLE_SPACING,
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const mix = (from, to, amount) => from + (to - from) * amount;
const phase = (time, from, to) => clamp01((time - from) / Math.max(0.0001, to - from));
const outExpo = (amount) => (amount >= 1 ? 1 : 1 - Math.pow(2, -10 * amount));
const outCubic = (amount) => 1 - Math.pow(1 - amount, 3);
const inCubic = (amount) => amount * amount * amount;

function everyFrame(build) {
  const clips = [];
  const totalFrames = Math.round(DURATION * FPS);
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const time = frame / FPS;
    const clip = build(time);
    if (clip) clips.push({ ...clip, start: time, duration: 1 / FPS });
  }
  return clips;
}

const backgroundTrack = track(
  "background",
  everyFrame((time) => {
    const reveal = outCubic(phase(time, 0, 0.9));
    return shape("rectangle", {
      width: WIDTH,
      height: HEIGHT,
      fill: {
        type: "radial",
        center: { x: 0.5 + Math.sin(time * 0.5) * 0.05, y: 0.4 + Math.cos(time * 0.45) * 0.04 },
        radius: 0.9,
        stops: [
          { color: "#2b251d", offset: 0 },
          { color: "#171512", offset: 0.45 },
          { color: BACKGROUND, offset: 1 },
        ],
      },
      opacity: reveal,
      transform: { x: 0, y: 0 },
    });
  }),
);

const glowTrack = track(
  "glow",
  everyFrame((time) => {
    const reveal = outCubic(phase(time, 0.1, 1.5));
    const fade = 1 - inCubic(phase(time, DURATION - 1.6, DURATION - 0.6));
    const opacity = reveal * fade;
    if (opacity <= 0.004) return null;
    const radius = HEIGHT * 0.42;
    return shape("ellipse", {
      width: radius * 2,
      height: radius * 2,
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
      opacity,
      transform: {
        x: CENTER_X - radius + Math.sin(time * 0.7) * WIDTH * 0.04,
        y: CENTER_Y - radius + Math.cos(time * 0.55) * HEIGHT * 0.05,
      },
    });
  }),
);

const ringTrack = track(
  "ring",
  everyFrame((time) => {
    const growth = outExpo(phase(time, 0.25, 1.7));
    const opacity = clamp01(phase(time, 0.25, 0.6)) * (1 - inCubic(phase(time, 1.35, 2.1)));
    if (opacity <= 0.004) return null;
    const radius = mix(TITLE_SIZE * 0.4, WIDTH * 0.24, growth);
    return shape("ellipse", {
      width: radius * 2,
      height: radius * 2,
      stroke: { color: GOLD, width: 3, lineCap: "round" },
      opacity,
      transform: { x: CENTER_X - radius, y: CENTER_Y - radius },
    });
  }),
);

const titleTracks = titleLayout.letters.map((letter, index) => {
  const boxWidth = Math.round(letter.width + TITLE_SIZE * 0.6);
  const letterCenterX = CENTER_X - titleLayout.totalWidth / 2 + letter.x + letter.width / 2;
  const appearAt = 1.1 + index * 0.07;
  return track(`title-letter-${index}`, everyFrame((time) => {
    const reveal = outExpo(phase(time, appearAt, appearAt + 0.8));
    const opacity = clamp01(phase(time, appearAt, appearAt + 0.4));
    if (opacity <= 0.004) return null;
    const rise = mix(TITLE_SIZE * 0.9, 0, reveal);
    const scale = mix(0.5, 1, reveal);
    return text(letter.ch, TITLE_SIZE, {
      fontFamily: "Arial",
      fontWeight: 800,
      letterSpacing: 0,
      align: "center",
      maxWidth: boxWidth,
      fill: IVORY,
      opacity,
      transform: {
        x: Math.round(letterCenterX - boxWidth / 2),
        y: Math.round(TITLE_TOP + rise),
        scaleX: scale,
        scaleY: scale,
      },
    });
  }));
});

const ruleTrack = track(
  "accent-rule",
  everyFrame((time) => {
    const draw = outExpo(phase(time, 2, 2.6));
    const opacity = clamp01(phase(time, 2, 2.3));
    if (opacity <= 0.004) return null;
    const width = Math.max(2, titleLayout.totalWidth * 0.55 * draw);
    return shape("rectangle", {
      width,
      height: Math.max(2, Math.round(HEIGHT * 0.004)),
      fill: GOLD,
      opacity,
      transform: { x: CENTER_X - width / 2, y: RULE_Y },
    });
  }),
);

const taglineTrack = track(
  "tagline",
  everyFrame((time) => {
    const reveal = outCubic(phase(time, 2.5, 3.3));
    const opacity = clamp01(phase(time, 2.5, 3));
    if (opacity <= 0.004) return null;
    const spacing = mix(TAGLINE_SPACING_WIDE, TAGLINE_SPACING_TIGHT, reveal);
    const rise = mix(TAGLINE_SIZE * 0.8, 0, reveal);
    return text(TAGLINE, TAGLINE_SIZE, {
      fontFamily: "Arial",
      fontWeight: 600,
      letterSpacing: spacing,
      align: "center",
      maxWidth: TAGLINE_WIDTH,
      fill: GOLD,
      opacity,
      transform: { x: Math.round(CENTER_X - TAGLINE_WIDTH / 2), y: Math.round(TAGLINE_TOP + rise) },
    });
  }),
);

const fadeTrack = track(
  "fade-out",
  everyFrame((time) => {
    const cover = inCubic(phase(time, DURATION - 1.3, DURATION - 0.3));
    if (cover <= 0.004) return null;
    return shape("rectangle", {
      width: WIDTH,
      height: HEIGHT,
      fill: BACKGROUND,
      opacity: cover,
      transform: { x: 0, y: 0 },
    });
  }),
);

export default defineScene("Intro", DURATION, () =>
  timeline([
    backgroundTrack,
    glowTrack,
    ringTrack,
    ...titleTracks,
    ruleTrack,
    taglineTrack,
    fadeTrack,
  ]),
);
