import { defineScene, particle, track, timeline, solid, shape } from "cinecode";

const WIDTH = 1920;
const HEIGHT = 1920;
const DURATION = 12;
const SEED = 0xC1N3C0D3;

const CINEC_CYAN = "#00d4aa";
const CINEC_AMBER = "#f59e0b";
const CINEC_VIOLET = "#a855f7";
const CINEC_GOLD = "#f5c842";
const CINEC_TITANIUM = "#c0c0c0";
const OBSIDIAN = "#030303";

const primaryEmitter = particle({
  params: {
    emitRate: 30,
    lifetime: 6,
    velocity: 80,
    sizeStart: 8,
    sizeEnd: 2,
    colorStart: CINEC_CYAN,
    colorEnd: CINEC_AMBER,
    blending: "additive",
    emitterShape: "circle",
    emitterRadius: 20,
    seed: SEED,
    physics: {
      gravity: { x: 0, y: 15 },
      drag: 0.02,
      forces: [
        { type: "wind", directionDegrees: 90, speed: 20, turbulence: 0.3 },
        { type: "turbulence", strength: 40, scale: 0.005 },
      ],
      timeStep: 1 / 60,
      maxSpeed: 400,
      restitution: 0.3,
      friction: 0.1,
    },
    debug: false,
  },
  width: WIDTH,
  height: HEIGHT,
});

const secondaryEmitter = particle({
  params: {
    emitRate: 12,
    lifetime: 4,
    velocity: 50,
    sizeStart: 6,
    sizeEnd: 1.5,
    colorStart: CINEC_AMBER,
    colorEnd: CINEC_VIOLET,
    blending: "additive",
    emitterShape: "circle",
    emitterRadius: 15,
    seed: SEED + 1,
    physics: {
      gravity: { x: -10, y: 20 },
      drag: 0.015,
      forces: [
        { type: "wind", directionDegrees: 45, speed: 15, turbulence: 0.2 },
        { type: "vortex", x: 480, y: 480, strength: 80 },
      ],
      timeStep: 1 / 60,
      maxSpeed: 300,
      restitution: 0.4,
      friction: 0.15,
    },
    debug: false,
  },
  width: WIDTH,
  height: HEIGHT,
});

const tertiaryEmitter = particle({
  params: {
    emitRate: 8,
    lifetime: 5,
    velocity: 30,
    sizeStart: 4,
    sizeEnd: 1,
    colorStart: CINEC_GOLD,
    colorEnd: CINEC_TITANIUM,
    blending: "additive",
    emitterShape: "circle",
    emitterRadius: 25,
    seed: SEED + 2,
    physics: {
      gravity: { x: 0, y: 5 },
      drag: 0.025,
      forces: [
        { type: "wind", directionDegrees: 180, speed: 10, turbulence: 0.4 },
        { type: "attraction", x: 960, y: 960, strength: 60 },
      ],
      timeStep: 1 / 60,
      maxSpeed: 200,
      restitution: 0.5,
      friction: 0.2,
    },
    debug: false,
  },
  width: WIDTH,
  height: HEIGHT,
});

const monogramBurst1 = particle({
  params: {
    emitRate: 120,
    lifetime: 2.5,
    velocity: 100,
    sizeStart: 5,
    sizeEnd: 0.5,
    colorStart: CINEC_CYAN,
    colorEnd: CINEC_GOLD,
    blending: "additive",
    emitterShape: "circle",
    emitterRadius: 80,
    seed: SEED + 10,
    physics: {
      gravity: { x: 0, y: 0 },
      drag: 0.05,
      forces: [
        { type: "vortex", x: 960, y: 960, strength: 200 },
        { type: "turbulence", strength: 100, scale: 0.01 },
      ],
      timeStep: 1 / 60,
      maxSpeed: 800,
      restitution: 0.7,
      friction: 0.05,
    },
    debug: false,
  },
  start: 3,
  duration: 2.5,
  width: WIDTH,
  height: HEIGHT,
});

const monogramBurst2 = particle({
  params: {
    emitRate: 120,
    lifetime: 2.5,
    velocity: 100,
    sizeStart: 5,
    sizeEnd: 0.5,
    colorStart: CINEC_AMBER,
    colorEnd: CINEC_VIOLET,
    blending: "additive",
    emitterShape: "circle",
    emitterRadius: 80,
    seed: SEED + 11,
    physics: {
      gravity: { x: 0, y: 0 },
      drag: 0.05,
      forces: [
        { type: "vortex", x: 960, y: 960, strength: 200 },
        { type: "turbulence", strength: 100, scale: 0.01 },
      ],
      timeStep: 1 / 60,
      maxSpeed: 800,
      restitution: 0.7,
      friction: 0.05,
    },
    debug: false,
  },
  start: 6,
  duration: 2.5,
  width: WIDTH,
  height: HEIGHT,
});

const monogramBurst3 = particle({
  params: {
    emitRate: 120,
    lifetime: 2.5,
    velocity: 100,
    sizeStart: 5,
    sizeEnd: 0.5,
    colorStart: CINEC_VIOLET,
    colorEnd: CINEC_CYAN,
    blending: "additive",
    emitterShape: "circle",
    emitterRadius: 80,
    seed: SEED + 12,
    physics: {
      gravity: { x: 0, y: 0 },
      drag: 0.05,
      forces: [
        { type: "vortex", x: 960, y: 960, strength: 200 },
        { type: "turbulence", strength: 100, scale: 0.01 },
      ],
      timeStep: 1 / 60,
      maxSpeed: 800,
      restitution: 0.7,
      friction: 0.05,
    },
    debug: false,
  },
  start: 9,
  duration: 2.5,
  width: WIDTH,
  height: HEIGHT,
});

const background = solid({
  color: OBSIDIAN,
  width: WIDTH,
  height: HEIGHT,
  start: 0,
  duration: DURATION,
});

const vignette = shape({
  shapeType: "ellipse",
  width: WIDTH * 1.5,
  height: HEIGHT * 1.5,
  fill: "radial-gradient(ellipse at center, transparent 40%, #000000 100%)",
  transform: { x: WIDTH / 2, y: HEIGHT / 2 },
  start: 0,
  duration: DURATION,
});

const lensFlare1 = shape({
  shapeType: "ellipse",
  width: 300,
  height: 300,
  fill: "radial-gradient(circle, #00d4aa00 0%, #00d4aa40 30%, #00d4aa80 50%, #00d4aa40 70%, #00d4aa00 100%)",
  transform: { x: 960, y: 960 },
  opacity: 0,
  keyframes: {
    opacity: [
      [2.8, 0],
      [3.0, 0.6, "easeOutCubic"],
      [3.5, 0.3, "easeInOutQuad"],
      [4.5, 0],
    ],
  },
  start: 0,
  duration: DURATION,
});

const lensFlare2 = shape({
  shapeType: "ellipse",
  width: 250,
  height: 250,
  fill: "radial-gradient(circle, #f59e0b00 0%, #f59e0b40 30%, #f59e0b80 50%, #f59e0b40 70%, #f59e0b00 100%)",
  transform: { x: 960, y: 960 },
  opacity: 0,
  keyframes: {
    opacity: [
      [5.8, 0],
      [6.0, 0.6, "easeOutCubic"],
      [6.5, 0.3, "easeInOutQuad"],
      [7.5, 0],
    ],
  },
  start: 0,
  duration: DURATION,
});

const lensFlare3 = shape({
  shapeType: "ellipse",
  width: 280,
  height: 280,
  fill: "radial-gradient(circle, #a855f700 0%, #a855f740 30%, #a855f780 50%, #a855f740 70%, #a855f700 100%)",
  transform: { x: 960, y: 960 },
  opacity: 0,
  keyframes: {
    opacity: [
      [8.8, 0],
      [9.0, 0.6, "easeOutCubic"],
      [9.5, 0.3, "easeInOutQuad"],
      [10.5, 0],
    ],
  },
  start: 0,
  duration: DURATION,
});

const lensFlare4 = shape({
  shapeType: "ellipse",
  width: 200,
  height: 200,
  fill: "radial-gradient(circle, #f5c84200 0%, #f5c84240 30%, #f5c84280 50%, #f5c84240 70%, #f5c84200 100%)",
  transform: { x: 600, y: 600 },
  opacity: 0,
  keyframes: {
    opacity: [
      [4.2, 0],
      [4.4, 0.4, "easeOutCubic"],
      [4.9, 0.2, "easeInOutQuad"],
      [5.5, 0],
    ],
  },
  start: 0,
  duration: DURATION,
});

const lensFlare5 = shape({
  shapeType: "ellipse",
  width: 220,
  height: 220,
  fill: "radial-gradient(circle, #c0c0c000 0%, #c0c0c030 30%, #c0c0c060 50%, #c0c0c030 70%, #c0c0c000 100%)",
  transform: { x: 1320, y: 1320 },
  opacity: 0,
  keyframes: {
    opacity: [
      [7.2, 0],
      [7.4, 0.4, "easeOutCubic"],
      [7.9, 0.2, "easeInOutQuad"],
      [8.5, 0],
    ],
  },
  start: 0,
  duration: DURATION,
});

export default defineScene("particle-nexus", DURATION, () =>
  timeline(
    track("background", [background]),
    track("particles-primary", [primaryEmitter]),
    track("particles-secondary", [secondaryEmitter]),
    track("particles-tertiary", [tertiaryEmitter]),
    track("monogram-burst-1", [monogramBurst1]),
    track("monogram-burst-2", [monogramBurst2]),
    track("monogram-burst-3", [monogramBurst3]),
    track("lens-flare-1", [lensFlare1]),
    track("lens-flare-2", [lensFlare2]),
    track("lens-flare-3", [lensFlare3]),
    track("lens-flare-4", [lensFlare4]),
    track("lens-flare-5", [lensFlare5]),
    track("vignette", [vignette]),
  ),
);