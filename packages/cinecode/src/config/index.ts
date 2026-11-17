export type { LoadConfigOptions } from "./schema.js";
export {
  CONFIG_FILENAMES,
  findConfigUpward,
  resolveProjectLocation,
  type ConfigSource,
  type ProjectLocation,
  type ProjectLocationOptions,
} from "./project.js";
export {
  loadConfig,
  getDefaultConfig,
  normalizeConfig,
  findConfigFile,
  resolveConfigPath,
  parseResolutionString,
  explicitConfigPaths,
  DEFAULT_PROJECT,
  DEFAULT_VIDEO,
  DEFAULT_RENDER,
  DEFAULT_IMAGES,
  DEFAULT_DEV,
  SCHEMA_VERSION,
} from "./schema.js";
export {
  validateConfig,
  validateAuthoringConfig,
  validateNormalizedConfig,
  resolveResolution,
  resolveFps,
} from "./validator.js";
export type { ValidationResult } from "./validator.js";
export { ensureGitignoreEntries, removeGitignoreEntries, checkGitignoreEntries } from "./gitignore.js";
export type { GitignoreManagerOptions } from "./gitignore.js";
export {
  substituteEnvVars,
  substituteEnvVarsDeep,
  substituteEnvVarsWithReport,
  findMissingEnvVars,
  findMissingEnvVarsDeep,
  type EnvSubstitutionOptions,
  type EnvSubstitutionResult,
} from "./envsubst.js";
export { generateSchema, generateSchemaJson } from "./json-schema.js";
export type { JsonSchemaDocument, JsonSchemaNode } from "./json-schema.js";
export {
  resolveConfigChain,
  mergeConfigInheritance,
  deepMergeConfig,
  extendComposition,
  extendCompositionProps,
} from "./inherit.js";
export {
  CinecodeIgnore,
  DEFAULT_IGNORE_PATTERNS,
  loadCinecodeIgnore,
  parseIgnoreContent,
  type CinecodeIgnoreOptions,
  type IgnoreRule,
} from "./ignore.js";
export {
  defineConfig,
  scaffoldConfigFile,
  type ScaffoldConfigOptions,
} from "./scaffold.js";
export {
  ConfigMigrationEngine,
  type MigrationResult,
  type MigrationStepResult,
} from "./migration/engine.js";
export {
  validateConfigWithZod,
  CinecodeConfigSchema,
  VideoConfigSchema,
  RenderConfigSchema,
  ImageConfigSchema,
  DevConfigSchema,
  AudioConfigSchema,
  NormalizedCinecodeConfigSchema,
  validateNormalizedConfigWithZod,
  type InferredCinecodeConfig,
  type ZodValidationResult,
} from "./zod-schema.js";
export {
  ConfigDependencyTracker,
  type Subsystem,
  type ConfigDiffReport,
} from "./hot-swap.js";

