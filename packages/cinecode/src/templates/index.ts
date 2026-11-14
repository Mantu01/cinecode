export interface CompositionTemplate {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

const HEADER = `import { composition, timeline, track, text, solid } from "cinecode";\n`;

const BLANK = `${HEADER}
export const main = composition({
  name: "__NAME__",
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#0b0b0f",
  duration: "5s",
  rootTimeline: timeline(
    track("main", [
      solid("#111827", { start: 0, duration: "5s" }),
      text("Hello, cinecode", 96, { start: 0, duration: "5s", align: "center" }),
    ]),
  ),
});
`;

const TITLE_CARD = `${HEADER}
export const main = composition({
  name: "__NAME__",
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#05060a",
  duration: "6s",
  rootTimeline: timeline(
    track("title", [
      text("Your Title", 128, { start: 0, duration: "4s", align: "center", color: "#ffffff" }),
      text("A subtitle that explains the story", 40, { start: 1, duration: "3s", align: "center", color: "#9ca3af" }),
    ]),
  ),
});
`;

const LOWER_THIRD = `${HEADER}
export const main = composition({
  name: "__NAME__",
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#000000",
  duration: "8s",
  rootTimeline: timeline(
    track("lower-third", [
      solid("#e11d48", { start: 1, duration: "5s", x: 120, y: 760, width: 12, height: 160 }),
      text("Jane Doe", 56, { start: 1, duration: "5s", x: 160, y: 760, align: "left", color: "#ffffff" }),
      text("Correspondent", 28, { start: 1.2, duration: "4.8s", x: 160, y: 840, align: "left", color: "#d1d5db" }),
    ]),
  ),
});
`;

const COUNTDOWN = `${HEADER}
const seconds = [3, 2, 1];

export const main = composition({
  name: "__NAME__",
  width: 1080,
  height: 1920,
  fps: 30,
  background: "#0f172a",
  duration: "4s",
  rootTimeline: timeline(
    track("countdown", seconds.map((value, index) =>
      text(String(value), 320, { start: index, duration: 1, align: "center", color: "#f8fafc" })
    )),
  ),
});
`;

const SLIDESHOW = `${HEADER}
import { image } from "cinecode";

export const main = composition({
  name: "__NAME__",
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#000000",
  rootTimeline: timeline(
    track("slides", [
      image("media/slide-1.jpg", { start: 0, duration: 3, transitionIn: { type: "fade", duration: 0.5 } }),
      image("media/slide-2.jpg", { start: 3, duration: 3, transitionIn: { type: "fade", duration: 0.5 } }),
      image("media/slide-3.jpg", { start: 6, duration: 3, transitionIn: { type: "fade", duration: 0.5 } }),
    ]),
  ),
});
`;

const LOGO_REVEAL = `${HEADER}
import { image } from "cinecode";

export const main = composition({
  name: "__NAME__",
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#ffffff",
  duration: "4s",
  rootTimeline: timeline(
    track("logo", [
      image("media/logo.png", { start: 0.5, duration: 2.5, transitionIn: { type: "zoom", duration: 0.8 }, opacity: 1 }),
    ]),
  ),
});
`;

const SPLIT_SCREEN = `${HEADER}
import { image } from "cinecode";

export const main = composition({
  name: "__NAME__",
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#000000",
  duration: "8s",
  splitScreen: { layout: "side-by-side", padding: 24 },
  rootTimeline: timeline(
    track("left", [image("media/left.jpg", { start: 0, duration: 8 })]),
    track("right", [image("media/right.jpg", { start: 0, duration: 8 })]),
  ),
});
`;

const DATA_VIZ = `${HEADER}
import { dataVizClip } from "cinecode";

export const main = composition({
  name: "__NAME__",
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#0b1120",
  duration: "5s",
  rootTimeline: timeline(
    track("chart", [
      dataVizClip({
        start: 0,
        duration: 5,
        data: [
          { label: "Q1", value: 32 },
          { label: "Q2", value: 48 },
          { label: "Q3", value: 61 },
          { label: "Q4", value: 84 },
        ],
        chartType: "bar",
        showValues: true,
      }),
    ]),
  ),
});
`;

export const TEMPLATES: readonly CompositionTemplate[] = [
  { name: "blank", description: "Minimal composition with a solid background and text", content: BLANK },
  { name: "slideshow", description: "Image sequence with fade transitions", content: SLIDESHOW },
  { name: "title-card", description: "Centered title and subtitle", content: TITLE_CARD },
  { name: "lower-third", description: "News-style lower third graphic", content: LOWER_THIRD },
  { name: "countdown", description: "Animated 3-2-1 countdown", content: COUNTDOWN },
  { name: "logo-reveal", description: "Logo zoom-in reveal", content: LOGO_REVEAL },
  { name: "split-screen", description: "Side-by-side comparison layout", content: SPLIT_SCREEN },
  { name: "data-viz", description: "Animated bar chart", content: DATA_VIZ },
];

export function renderTemplate(template: CompositionTemplate, name: string): string {
  return template.content.replace(/__NAME__/g, name);
}
