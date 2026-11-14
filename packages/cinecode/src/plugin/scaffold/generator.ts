import fs from "node:fs";
import path from "node:path";
import {
  type TemplateType,
  type TemplateOptions,
  generatePackageJson,
  generateTsConfig,
  generateReadme,
  generateSourceCode,
} from "./templates.js";

export interface ScaffoldOptions extends TemplateOptions {
  type?: TemplateType;
  outputDir?: string;
}

export interface ScaffoldResult {
  targetDir: string;
  files: string[];
}

export function scaffoldPlugin(options: ScaffoldOptions): ScaffoldResult {
  const type = options.type || "effect";
  const targetDir = path.resolve(options.outputDir || path.join(process.cwd(), options.name));
  const srcDir = path.join(targetDir, "src");

  fs.mkdirSync(srcDir, { recursive: true });

  const filesMap: Record<string, string> = {
    [path.join(targetDir, "package.json")]: generatePackageJson(options, type),
    [path.join(targetDir, "tsconfig.json")]: generateTsConfig(),
    [path.join(targetDir, "README.md")]: generateReadme(options, type),
    [path.join(srcDir, "index.ts")]: generateSourceCode(options, type),
  };

  const writtenFiles: string[] = [];
  for (const [filePath, content] of Object.entries(filesMap)) {
    fs.writeFileSync(filePath, content, "utf8");
    writtenFiles.push(filePath);
  }

  return {
    targetDir,
    files: writtenFiles,
  };
}
