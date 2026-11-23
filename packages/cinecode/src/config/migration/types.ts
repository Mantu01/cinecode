export interface ConfigSection {
  [key: string]: unknown;
}

export interface ConfigObject extends ConfigSection {
  video?: ConfigSection;
  render?: ConfigSection;
  project?: ConfigSection;
}

export interface MigrationStepResult {
  fromVersion: number;
  toVersion: number;
  changes: string[];
}

export interface ConfigDiffEntry {
  key: string;
  action: "added" | "removed" | "modified" | "moved";
  from?: unknown;
  to?: unknown;
  description: string;
}

export interface MigrationResult {
  originalVersion: number;
  targetVersion: number;
  backupPath: string;
  appliedSteps: MigrationStepResult[];
  diff: ConfigDiffEntry[];
  newContent: string;
  modified: boolean;
}

export interface MigrationRule {
  fromVersion: number;
  toVersion: number;
  description: string;
  transform: (config: ConfigObject) => string[];
}

export interface MigrateOptions {
  readonly dryRun?: boolean;
  readonly backup?: boolean;
}
