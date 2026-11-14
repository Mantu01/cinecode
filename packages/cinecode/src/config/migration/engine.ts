import fs from "node:fs";
import path from "node:path";

export interface MigrationStepResult {
  fromVersion: number;
  toVersion: number;
  changes: string[];
}

export interface MigrationResult {
  originalVersion: number;
  targetVersion: number;
  backupPath: string;
  appliedSteps: MigrationStepResult[];
  newContent: string;
}

export class ConfigMigrationEngine {
  migrate(filePath: string): MigrationResult {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Configuration file not found: ${filePath}`);
    }

    const originalContent = fs.readFileSync(absPath, "utf8");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${absPath}.${timestamp}.bak`;
    fs.writeFileSync(backupPath, originalContent, "utf8");

    let parsed: Record<string, any>;
    const isJson = absPath.endsWith(".json");
    if (isJson) {
      try {
        parsed = JSON.parse(originalContent);
      } catch {
        parsed = {};
      }
    } else {
      parsed = this.extractObjectFromCode(originalContent);
    }

    const originalVersion = Number(parsed.schemaVersion || 1);
    let currentVersion = originalVersion;
    const appliedSteps: MigrationStepResult[] = [];

    if (currentVersion < 2) {
      const step = this.migrateV1ToV2(parsed);
      appliedSteps.push(step);
      currentVersion = 2;
      parsed.schemaVersion = 2;
    }

    if (currentVersion < 3) {
      const step = this.migrateV2ToV3(parsed);
      appliedSteps.push(step);
      currentVersion = 3;
      parsed.schemaVersion = 3;
    }

    let newContent: string;
    if (isJson) {
      newContent = JSON.stringify(parsed, null, 2);
    } else {
      newContent = this.formatCodeConfig(parsed, originalContent);
    }

    fs.writeFileSync(absPath, newContent, "utf8");

    return {
      originalVersion,
      targetVersion: currentVersion,
      backupPath,
      appliedSteps,
      newContent,
    };
  }

  private migrateV1ToV2(config: Record<string, any>): MigrationStepResult {
    const changes: string[] = [];

    if (config.fps && !config.video?.fps) {
      config.video = config.video || {};
      config.video.fps = config.fps;
      delete config.fps;
      changes.push("Moved top-level 'fps' to 'video.fps'");
    }

    if (config.width && config.height && !config.video?.width) {
      config.video = config.video || {};
      config.video.width = config.width;
      config.video.height = config.height;
      delete config.width;
      delete config.height;
      changes.push("Moved top-level 'width'/'height' to 'video.width'/'video.height'");
    }

    if (config.render?.quality === "high") {
      config.render.quality = "final";
      changes.push("Upgraded deprecated render.quality 'high' to 'final'");
    }

    return { fromVersion: 1, toVersion: 2, changes };
  }

  private migrateV2ToV3(config: Record<string, any>): MigrationStepResult {
    const changes: string[] = [];

    if (config.video?.resolution && !config.render?.resolution) {
      config.render = config.render || {};
      config.render.resolution = config.video.resolution;
      delete config.video.resolution;
      changes.push("Normalized 'video.resolution' into 'render.resolution'");
    }

    if (!config.project?.entry && config.entry) {
      config.project = config.project || {};
      config.project.entry = config.entry;
      delete config.entry;
      changes.push("Moved top-level 'entry' to 'project.entry'");
    }

    return { fromVersion: 2, toVersion: 3, changes };
  }

  private extractObjectFromCode(code: string): Record<string, any> {
    try {
      const match = code.match(/defineConfig\s*\(\s*(\{[\s\S]*\})\s*\)/);
      if (match && match[1]) {
        const fn = new Function(`return (${match[1]});`);
        return fn();
      }
    } catch {
      void 0;
    }
    return {};
  }

  private formatCodeConfig(config: Record<string, any>, originalCode: string): string {
    const jsonStr = JSON.stringify(config, null, 2);
    if (/import\s*\{\s*defineConfig\s*\}\s*from\s*["']cinecode["']/.test(originalCode)) {
      return `import { defineConfig } from "cinecode";\n\nexport default defineConfig(${jsonStr});\n`;
    }
    return `/// <reference types="cinecode" />\nimport { defineConfig } from "cinecode";\n\nexport default defineConfig(${jsonStr});\n`;
  }
}
