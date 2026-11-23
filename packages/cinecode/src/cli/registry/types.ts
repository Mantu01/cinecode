export type CommandOutcome = "none" | "artifact" | "report";
export type CommandKind = "read" | "write" | "network" | "destructive";
export type CommandCategory = "product" | "resource" | "maintenance" | "informational";
export type OptionType = "string" | "number" | "boolean" | "path" | "enum";
export type ProjectSelectorRule = "selection" | "scene" | "timeline" | "optional" | "none";

export interface CommandOptionSpec {
  readonly name: string;
  readonly flags: string;
  readonly description: string;
  readonly type: OptionType;
  readonly default?: unknown;
  readonly choices?: readonly string[];
  readonly bounds?: { readonly min?: number; readonly max?: number };
  readonly conflicts?: readonly string[];
  readonly requires?: readonly string[];
  readonly hidden?: boolean;
}

export interface DeclaredResultShape {
  readonly type: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly items?: unknown;
  readonly description?: string;
}

export interface CommandContract {
  readonly reads: readonly string[];
  readonly writes: readonly string[];
}

export type CommandActionFunction = (...args: unknown[]) => Promise<void> | void;

export interface CommandSpec {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly aliasDeprecations?: Readonly<Record<string, string>>;
  readonly summary: string;
  readonly description?: string;
  readonly usage?: string;
  readonly category: CommandCategory;
  readonly contract: CommandContract;
  readonly options: readonly CommandOptionSpec[];
  readonly requiredProject: boolean;
  readonly projectSelectorRule?: ProjectSelectorRule;
  readonly outcome: CommandOutcome;
  readonly kind: CommandKind;
  readonly hidden: boolean;
  readonly examples: readonly string[];
  readonly machineResult: DeclaredResultShape;
  readonly expectedArtifactKind?: "video" | "image" | "artifact";
  readonly network: boolean;
  readonly destructive: boolean;
  readonly loadAction: () => Promise<CommandActionFunction>;
}

export interface SerializableCommandOption {
  readonly name: string;
  readonly flags: string;
  readonly description: string;
  readonly type: OptionType;
  readonly default?: unknown;
  readonly choices?: readonly string[];
  readonly bounds?: { readonly min?: number; readonly max?: number };
  readonly conflicts?: readonly string[];
  readonly requires?: readonly string[];
  readonly hidden?: boolean;
}

export interface SerializableCommandSpec {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly aliasDeprecations?: Readonly<Record<string, string>>;
  readonly summary: string;
  readonly usage?: string;
  readonly category: CommandCategory;
  readonly contract: CommandContract;
  readonly options: readonly SerializableCommandOption[];
  readonly requiredProject: boolean;
  readonly projectSelectorRule?: ProjectSelectorRule;
  readonly outcome: CommandOutcome;
  readonly kind: CommandKind;
  readonly hidden: boolean;
  readonly examples: readonly string[];
  readonly machineResult: DeclaredResultShape;
}
