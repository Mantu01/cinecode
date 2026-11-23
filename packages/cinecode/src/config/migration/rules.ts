import { REMOVED_CONFIG_KEYS } from "../validator.js";
import { SCHEMA_VERSION } from "../zod-schema.js";
import type { ConfigObject, ConfigSection, MigrationRule } from "./types.js";

export function deleteNestedKey(obj: ConfigObject, keyPath: string): boolean {
  const parts = keyPath.split(".");
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur !== "object") return false;
    cur = (cur as ConfigSection)[parts[i]!];
  }
  if (!cur || typeof cur !== "object") return false;
  const leaf = parts[parts.length - 1]!;
  if (leaf in cur) {
    delete (cur as ConfigSection)[leaf];
    return true;
  }
  return false;
}

export function migrateV1ToV2Transform(config: ConfigObject): string[] {
  const changes: string[] = [];

  if (config.fps !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.fps === undefined) config.video.fps = config.fps;
    delete config.fps;
    changes.push("Moved top-level 'fps' to 'video.fps'");
  }
  if (config.width !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.width === undefined) config.video.width = config.width;
    delete config.width;
    changes.push("Moved top-level 'width' to 'video.width'");
  }
  if (config.height !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.height === undefined) config.video.height = config.height;
    delete config.height;
    changes.push("Moved top-level 'height' to 'video.height'");
  }
  if (config.duration !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.defaultDuration === undefined) config.video.defaultDuration = config.duration;
    delete config.duration;
    changes.push("Moved top-level 'duration' to 'video.defaultDuration'");
  }
  if (config.defaultDuration !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.defaultDuration === undefined) config.video.defaultDuration = config.defaultDuration;
    delete config.defaultDuration;
    changes.push("Moved top-level 'defaultDuration' to 'video.defaultDuration'");
  }
  if (config.background !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.background === undefined) config.video.background = config.background;
    delete config.background;
    changes.push("Moved top-level 'background' to 'video.background'");
  }
  if (config.render?.background !== undefined) {
    if (!config.video) config.video = {};
    if (config.video.background === undefined) config.video.background = config.render.background;
    delete config.render.background;
    if (Object.keys(config.render).length === 0) delete config.render;
    changes.push("Moved 'render.background' to 'video.background'");
  }
  if (config.entry !== undefined) {
    if (!config.project) config.project = {};
    if (config.project.entry === undefined) config.project.entry = config.entry;
    delete config.entry;
    changes.push("Moved top-level 'entry' to 'project.entry'");
  }
  for (const rootKey of ["sourceDir", "mediaDir", "outputDir", "cacheDir"] as const) {
    if (config[rootKey] !== undefined) {
      if (!config.project) config.project = {};
      if (config.project[rootKey] === undefined) config.project[rootKey] = config[rootKey];
      delete config[rootKey];
      changes.push(`Moved top-level '${rootKey}' to 'project.${rootKey}'`);
    }
  }
  if (config.render?.quality === "high") {
    config.render.quality = "final";
    changes.push("Upgraded deprecated render.quality 'high' to 'final'");
  }

  for (const removedKey of Object.keys(REMOVED_CONFIG_KEYS)) {
    if (deleteNestedKey(config, removedKey)) {
      changes.push(`Removed deprecated key '${removedKey}'`);
    }
  }

  return changes;
}

export const MIGRATION_RULES: readonly MigrationRule[] = [
  {
    fromVersion: 1,
    toVersion: SCHEMA_VERSION,
    description: "Move legacy fields into video/project sections and normalize options",
    transform: migrateV1ToV2Transform,
  },
];
