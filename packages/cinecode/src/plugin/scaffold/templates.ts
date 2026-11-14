export type TemplateType = "effect" | "transition" | "audio-effect" | "clip-type";

export interface TemplateOptions {
  name: string;
  displayName?: string;
  description?: string;
  author?: string;
  permissions?: string[];
}

export function generatePackageJson(options: TemplateOptions, type: TemplateType): string {
  const pkg = {
    name: options.name,
    version: "0.1.0",
    description: options.description || `Cinecode ${type} plugin`,
    author: options.author || "",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    scripts: {
      build: "tsc",
      dev: "tsc --watch",
    },
    cinecode: {
      kind: type === "audio-effect" ? "audioProcessor" : type === "transition" ? "transition" : "effect",
      apiVersion: "1.0.0",
      permissions: options.permissions || ["frame:process"],
    },
    peerDependencies: {
      cinecode: "^0.1.0",
    },
    devDependencies: {
      typescript: "^5.4.0",
      cinecode: "^0.1.0",
    },
  };
  return JSON.stringify(pkg, null, 2);
}

export function generateTsConfig(): string {
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      declaration: true,
      outDir: "./dist",
      rootDir: "./src",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    include: ["src/**/*"],
  };
  return JSON.stringify(tsconfig, null, 2);
}

export function generateReadme(options: TemplateOptions, type: TemplateType): string {
  return `# ${options.name}

${options.description || `A ${type} plugin for Cinecode.`}

## Installation

\`\`\`bash
cinecode plugin add ${options.name}
\`\`\`

## Usage

In your \`cinecode.config.ts\`:

\`\`\`ts
import { defineConfig } from "cinecode";

export default defineConfig({
  plugins: ["${options.name}"],
});
\`\`\`
`;
}

export function generateSourceCode(options: TemplateOptions, type: TemplateType): string {
  switch (type) {
    case "effect":
      return `import { definePlugin, effectPlugin } from "cinecode/plugin";

export default definePlugin({
  manifest: {
    name: "${options.name}",
    version: "0.1.0",
    kind: "effect",
    description: "${options.description || "Custom effect"}",
  },
  setup: (context) => {
    context.log("Setting up ${options.name}");
  },
  hooks: {
    beforeFrame: (data) => {
      // Custom per-frame logic
    },
  },
});
`;
    case "transition":
      return `import { definePlugin } from "cinecode/plugin";

export default definePlugin({
  manifest: {
    name: "${options.name}",
    version: "0.1.0",
    kind: "transition",
    description: "${options.description || "Custom transition"}",
  },
  hooks: {
    beforeFrame: (data) => {
      // Transition logic
    },
  },
});
`;
    case "audio-effect":
      return `import { definePlugin } from "cinecode/plugin";

export default definePlugin({
  manifest: {
    name: "${options.name}",
    version: "0.1.0",
    kind: "audioProcessor",
    description: "${options.description || "Custom audio processor"}",
  },
  hooks: {
    beforeMix: (data) => {
      // Audio mix logic
    },
  },
});
`;
    case "clip-type":
      return `import { definePlugin } from "cinecode/plugin";

export default definePlugin({
  manifest: {
    name: "${options.name}",
    version: "0.1.0",
    kind: "mediaSource",
    description: "${options.description || "Custom clip generator"}",
  },
  setup: (context) => {
    context.log("Clip generator registered");
  },
});
`;
  }
}
