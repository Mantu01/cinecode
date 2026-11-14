import fs from "node:fs";
import path from "node:path";
import prompts from "prompts";
import pc from "picocolors";
import { Command } from "commander";

export interface WizardOptions {
  name?: string;
  template?: string;
  yes?: boolean;
}

export async function runInitWizard(options: WizardOptions = {}): Promise<void> {
  let projectName = options.name;
  let preset = "youtube-1080p";
  let fps = 30;
  let useTs = true;

  if (!options.yes && process.stdin.isTTY) {
    const response = await prompts([
      {
        type: projectName ? null : "text",
        name: "projectName",
        message: "Project name:",
        initial: "my-cinecode-video",
      },
      {
        type: "select",
        name: "preset",
        message: "Select platform preset:",
        choices: [
          { title: "YouTube 1080p (16:9, 1920x1080, 30fps, -14 LUFS)", value: "youtube-1080p" },
          { title: "YouTube 4K (16:9, 3840x2160, 60fps)", value: "youtube-4k" },
          { title: "TikTok / Shorts / Reels (9:16, 1080x1920, 30fps)", value: "tiktok" },
          { title: "Cinematic 24fps (16:9, 3840x2160, 24fps Rec.709)", value: "cinematic" },
          { title: "Square / Instagram Post (1:1, 1080x1080, 30fps)", value: "square" },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "fps",
        message: "Target frame rate:",
        choices: [
          { title: "24 fps (Cinematic film)", value: 24 },
          { title: "30 fps (Standard web/video)", value: 30 },
          { title: "60 fps (Smooth gaming/action)", value: 60 },
        ],
        initial: 1,
      },
      {
        type: "confirm",
        name: "useTs",
        message: "Use TypeScript?",
        initial: true,
      },
    ]);

    projectName = projectName || response.projectName || "my-cinecode-video";
    preset = response.preset || preset;
    fps = response.fps || fps;
    useTs = response.useTs !== undefined ? response.useTs : useTs;
  }

  const finalProjectName = projectName || "my-cinecode-video";
  const targetDir = path.resolve(process.cwd(), finalProjectName);
  fs.mkdirSync(path.join(targetDir, "src"), { recursive: true });

  let width = 1920;
  let height = 1080;
  if (preset === "youtube-4k" || preset === "cinematic") {
    width = 3840; height = 2160;
  } else if (preset === "tiktok") {
    width = 1080; height = 1920;
  } else if (preset === "square") {
    width = 1080; height = 1080;
  }

  const configContent = `import { defineConfig } from "cinecode";

export default defineConfig({
  project: {
    name: "${projectName}",
    entry: "./src/main.${useTs ? "ts" : "js"}",
    sourceDir: "./src",
    outputDir: "./output",
    cacheDir: "./.cinecode/cache",
  },
  video: {
    title: "${projectName}",
    width: ${width},
    height: ${height},
    fps: ${fps},
    defaultDuration: 10,
    background: "#0a0a0c",
  },
  audio: {
    sampleRate: 48000,
    channels: 2,
    normalize: true,
  },
  plugins: [],
});
`;

  const mainContent = `import { defineComposition } from "cinecode";

export default defineComposition({
  width: ${width},
  height: ${height},
  fps: ${fps},
  duration: 10,
  background: "#0f172a",
  clips: [
    {
      type: "text",
      id: "title",
      start: 0,
      duration: 10,
      text: "Hello, Cinecode!",
      fontSize: 64,
      color: "#38bdf8",
      x: ${Math.round(width * 0.5)},
      y: ${Math.round(height * 0.5)},
    },
  ],
});
`;

  const pkgContent = {
    name: projectName,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      render: "cinecode render src/main." + (useTs ? "ts" : "js"),
      dev: "cinecode dev src/main." + (useTs ? "ts" : "js"),
    },
    dependencies: {
      cinecode: "^0.1.0",
    },
  };

  fs.writeFileSync(path.join(targetDir, `cinecode.config.${useTs ? "ts" : "js"}`), configContent, "utf8");
  fs.writeFileSync(path.join(targetDir, "src", `main.${useTs ? "ts" : "js"}`), mainContent, "utf8");
  fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify(pkgContent, null, 2), "utf8");

  if (useTs) {
    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: true,
      },
    };
    fs.writeFileSync(path.join(targetDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2), "utf8");
  }

  console.log(`\n${pc.green(pc.bold("✔ Successfully created Cinecode project:"))} ${pc.cyan(targetDir)}`);
  console.log("\nNext steps:");
  console.log(`  cd ${projectName}`);
  console.log("  pnpm install");
  console.log("  pnpm run dev\n");
}

export function createInitCommand(): Command {
  return new Command("init")
    .description("Interactive questionnaire to scaffold a new Cinecode project")
    .argument("[name]", "Project directory name")
    .option("-y, --yes", "Skip interactive prompts and use defaults", false)
    .action(async (name, options) => {
      await runInitWizard({ name, yes: options.yes });
    });
}
