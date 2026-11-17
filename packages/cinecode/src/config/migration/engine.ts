import fs from "node:fs";
import path from "node:path";
import { createError, ErrorCode } from "../../errors/index.js";
import { SCHEMA_VERSION } from "../zod-schema.js";

export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION;
export const OLDEST_SUPPORTED_VERSION = 1;

type ConfigObject = Record<string, any>;

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

export interface MigrationRule {
  fromVersion: number;
  toVersion: number;
  description: string;
  transform: (config: ConfigObject) => string[];
}

function moveField(config: ConfigObject, from: string, to: string, description: string, changes: string[]): void {
  const segments = to.split(".");
  let cursor: ConfigObject = config;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index]!;
    if (cursor[key] === null || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  const leaf = segments[segments.length - 1]!;
  cursor[leaf] = config[from];
  delete config[from];
  changes.push(description);
}

function migrateV1ToV2Transform(config: ConfigObject): string[] {
  const changes: string[] = [];
  if (config.fps !== undefined && config.video?.fps === undefined) {
    moveField(config, "fps", "video.fps", "Moved top-level 'fps' to 'video.fps'", changes);
  }
  if (config.width !== undefined && config.height !== undefined && config.video?.width === undefined) {
    moveField(config, "width", "video.width", "Moved top-level 'width' to 'video.width'", changes);
    moveField(config, "height", "video.height", "Moved top-level 'height' to 'video.height'", changes);
  }
  if (config.render?.quality === "high") {
    config.render.quality = "final";
    changes.push("Upgraded deprecated render.quality 'high' to 'final'");
  }
  return changes;
}

export const MIGRATION_RULES: readonly MigrationRule[] = [
  {
    fromVersion: 1,
    toVersion: SCHEMA_VERSION,
    description: "Move legacy video fields into the video section",
    transform: migrateV1ToV2Transform,
  },
];

export interface MigrateOptions {
  readonly dryRun?: boolean;
}

export class ConfigMigrationEngine {
  migrate(filePath: string, options: MigrateOptions = {}): MigrationResult {
    const dryRun = options.dryRun === true;
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Configuration file not found: ${filePath}`);
    }

    const originalContent = fs.readFileSync(absPath, "utf8");
    const backupPath = dryRun ? "" : this.writeBackup(absPath, originalContent);

    const parsed = this.parseConfig(absPath, originalContent);
    const originalVersion = Number(parsed.schemaVersion || 1);
    if (originalVersion < OLDEST_SUPPORTED_VERSION) {
      throw new Error(`Configuration schema version ${originalVersion} is no longer supported (oldest: ${OLDEST_SUPPORTED_VERSION})`);
    }
    if (originalVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(`Configuration schema version ${originalVersion} is newer than this release supports (current: ${CURRENT_SCHEMA_VERSION})`);
    }

    let currentVersion = originalVersion;
    const appliedSteps: MigrationStepResult[] = [];
    while (currentVersion < CURRENT_SCHEMA_VERSION) {
      const rule = MIGRATION_RULES.find((candidate) => candidate.fromVersion === currentVersion);
      if (!rule) {
        throw new Error(`No migration rule from schema v${currentVersion} to v${currentVersion + 1}`);
      }
      const changes = rule.transform(parsed);
      appliedSteps.push({ fromVersion: rule.fromVersion, toVersion: rule.toVersion, changes });
      currentVersion = rule.toVersion;
      parsed.schemaVersion = currentVersion;
    }

    const newContent = this.serialize(absPath, parsed, originalContent);
    if (!dryRun) {
      fs.writeFileSync(absPath, newContent, "utf8");
    }

    return {
      originalVersion,
      targetVersion: currentVersion,
      backupPath,
      appliedSteps,
      newContent,
    };
  }

  private writeBackup(absPath: string, originalContent: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${absPath}.${timestamp}.bak`;
    fs.writeFileSync(backupPath, originalContent, "utf8");
    return backupPath;
  }

  private parseConfig(absPath: string, originalContent: string): ConfigObject {
    if (absPath.endsWith(".json")) {
      try {
        return JSON.parse(originalContent);
      } catch (error) {
        throw createError(
          ErrorCode.CC1006,
          { path: absPath, reason: error instanceof Error ? error.message : String(error) },
          { location: { file: absPath }, cause: error },
        );
      }
    }
    return this.extractObjectFromCode(originalContent, absPath);
  }

  private serialize(absPath: string, parsed: ConfigObject, originalContent: string): string {
    if (absPath.endsWith(".json")) {
      return JSON.stringify(parsed, null, 2);
    }
    return this.formatCodeConfig(parsed, originalContent);
  }

  private extractObjectFromCode(code: string, absPath: string): ConfigObject {
    const match = code.match(/defineConfig\s*\(\s*(\{[\s\S]*\})\s*\)/);
    if (!match || !match[1]) {
      throw createError(
        ErrorCode.CC1006,
        { path: absPath, reason: "no defineConfig({ ... }) object found" },
        { location: { file: absPath } },
      );
    }
    try {
      const fn = new Function(`return (${match[1]});`);
      return fn();
    } catch (error) {
      throw createError(
        ErrorCode.CC1006,
        { path: absPath, reason: error instanceof Error ? error.message : String(error) },
        { location: { file: absPath }, cause: error },
      );
    }
  }

  private formatCodeConfig(config: ConfigObject, originalCode: string): string {
    const jsonStr = JSON.stringify(config, null, 2);
    if (/import\s*\{\s*defineConfig\s*\}\s*from\s*["']cinecode["']/.test(originalCode)) {
      return `import { defineConfig } from "cinecode";\n\nexport default defineConfig(${jsonStr});\n`;
    }
    return `/// <reference types="cinecode" />\nimport { defineConfig } from "cinecode";\n\nexport default defineConfig(${jsonStr});\n`;
  }
}
