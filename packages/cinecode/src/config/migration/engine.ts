import fs from "node:fs";
import path from "node:path";
import { createError, ErrorCode } from "../../errors/index.js";
import { validateAuthoringConfig } from "../validator.js";
import { SCHEMA_VERSION } from "../zod-schema.js";
import type {
  ConfigObject,
  MigrateOptions,
  MigrationResult,
  MigrationStepResult,
} from "./types.js";
import { parseCodeConfigSafe } from "./tokenizer.js";
import { MIGRATION_RULES } from "./rules.js";
import { computeConfigDiff } from "./diff.js";

export * from "./types.js";
export * from "./rules.js";
export * from "./diff.js";

export class ConfigMigrationEngine {
  migrate(filePath: string, options: MigrateOptions = {}): MigrationResult {
    const dryRun = options.dryRun === true;
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      throw createError(
        ErrorCode.CC1003,
        { key: "config", path: filePath, reason: "Configuration file not found" },
        { location: { file: absPath } },
      );
    }

    const originalContent = fs.readFileSync(absPath, "utf8");

    // Already current: no rewrite is required, so custom declarations are not a migration blocker.
    const declaredVersion = Number(/\bschemaVersion\s*:\s*(\d+)/.exec(originalContent)?.[1]);
    if (declaredVersion === SCHEMA_VERSION) {
      return {
        originalVersion: declaredVersion,
        targetVersion: declaredVersion,
        backupPath: "",
        appliedSteps: [],
        diff: [],
        newContent: originalContent,
        modified: false,
      };
    }

    const parsed = this.parseConfig(absPath, originalContent);

    let originalVersion: number;
    if (typeof parsed.schemaVersion === "number") {
      if (parsed.schemaVersion > SCHEMA_VERSION || parsed.schemaVersion < 1) {
        throw createError(
          ErrorCode.CC1004,
          { version: String(parsed.schemaVersion), expected: String(SCHEMA_VERSION) },
          {
            location: { file: absPath },
            fixHint: `This Cinecode release supports schema version ${SCHEMA_VERSION}; upgrade cinecode or lower schemaVersion.`,
          },
        );
      }
      originalVersion = parsed.schemaVersion;
    } else if (parsed.schemaVersion === undefined) {
      const hasV1Keys =
        parsed.fps !== undefined ||
        parsed.width !== undefined ||
        parsed.height !== undefined ||
        parsed.duration !== undefined ||
        parsed.entry !== undefined ||
        (parsed.render && parsed.render.background !== undefined);

      if (hasV1Keys && parsed.video === undefined) {
        originalVersion = 1;
      } else {
        throw createError(
          ErrorCode.CC1004,
          { version: "unknown", expected: String(SCHEMA_VERSION) },
          { location: { file: absPath }, fixHint: `Add 'schemaVersion: ${SCHEMA_VERSION}' to your configuration.` },
        );
      }
    } else {
      throw createError(
        ErrorCode.CC1004,
        { version: String(parsed.schemaVersion), expected: String(SCHEMA_VERSION) },
        { location: { file: absPath } },
      );
    }

    // Idempotent: already at current schema version
    if (originalVersion === SCHEMA_VERSION) {
      return {
        originalVersion,
        targetVersion: originalVersion,
        backupPath: "",
        appliedSteps: [],
        diff: [],
        newContent: originalContent,
        modified: false,
      };
    }

    const transformed: ConfigObject = JSON.parse(JSON.stringify(parsed));
    let currentVersion = originalVersion;
    const appliedSteps: MigrationStepResult[] = [];

    while (currentVersion < SCHEMA_VERSION) {
      const rule = MIGRATION_RULES.find((candidate) => candidate.fromVersion === currentVersion);
      if (!rule) {
        throw createError(
          ErrorCode.CC1004,
          { version: String(currentVersion), expected: String(SCHEMA_VERSION) },
          { location: { file: absPath }, fixHint: `No migration rule available from v${currentVersion} to v${SCHEMA_VERSION}` },
        );
      }
      const changes = rule.transform(transformed);
      appliedSteps.push({ fromVersion: rule.fromVersion, toVersion: rule.toVersion, changes });
      currentVersion = rule.toVersion;
      transformed.schemaVersion = currentVersion;
    }

    // Pre-write validation
    const { errors } = validateAuthoringConfig(transformed, absPath);
    if (errors.length > 0) {
      throw errors[0];
    }

    const diff = computeConfigDiff(parsed, transformed);
    const newContent = this.serialize(absPath, transformed, originalContent);

    if (newContent === originalContent) {
      return {
        originalVersion,
        targetVersion: currentVersion,
        backupPath: "",
        appliedSteps,
        diff: [],
        newContent: originalContent,
        modified: false,
      };
    }

    let backupPath = "";
    if (!dryRun) {
      if (options.backup === true) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        backupPath = `${absPath}.${timestamp}.bak`;
        fs.writeFileSync(backupPath, originalContent, "utf8");
      }

      // Atomic write using staged temporary file
      const tmpPath = `${absPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      try {
        fs.writeFileSync(tmpPath, newContent, "utf8");
        fs.renameSync(tmpPath, absPath);
      } catch (err) {
        if (fs.existsSync(tmpPath)) {
          fs.rmSync(tmpPath, { force: true });
        }
        throw err;
      }
    }

    return {
      originalVersion,
      targetVersion: currentVersion,
      backupPath,
      appliedSteps,
      diff,
      newContent,
      modified: true,
    };
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
    return parseCodeConfigSafe(originalContent, absPath);
  }

  private serialize(absPath: string, parsed: ConfigObject, originalContent: string): string {
    if (absPath.endsWith(".json")) {
      return JSON.stringify(parsed, null, 2) + "\n";
    }
    const jsonStr = JSON.stringify(parsed, null, 2);
    const isCjs = originalContent.includes("module.exports") || originalContent.includes("require(");
    if (isCjs) {
      if (/require\(["']cinecode["']\)/.test(originalContent)) {
        return `const { defineConfig } = require("cinecode");\n\nmodule.exports = defineConfig(${jsonStr});\n`;
      }
      return `module.exports = ${jsonStr};\n`;
    }
    const hasReference = originalContent.includes("/// <reference");
    if (hasReference) {
      return `/// <reference types="cinecode" />\nimport { defineConfig } from "cinecode";\n\nexport default defineConfig(${jsonStr});\n`;
    }
    return `import { defineConfig } from "cinecode";\n\nexport default defineConfig(${jsonStr});\n`;
  }
}
