import path from "node:path";
import { aliasesEnabled, loadAliases, migrateLegacyAliases, removeAlias, setAlias } from "../parse/profiles.js";
import { runReport } from "../output/run-report.js";
import { UsageError } from "../shared/usage-error.js";

const ACTIONS = ["list", "set", "remove", "migrate"] as const;

function projectRoot(root: string | undefined, context?: import("../gate/preflight.js").PreflightContext): string {
  return context?.resolution?.root ?? (root ? path.resolve(root) : process.cwd());
}

export async function aliasCommand(
  action = "list",
  name?: string,
  ...rest: unknown[]
): Promise<void> {
  const context = rest.find(
    (value): value is import("../gate/preflight.js").PreflightContext =>
      typeof value === "object" && value !== null && "resolution" in value,
  );
  const strings = rest.flatMap((value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "string" ? [value] : []);
  const options = rest.find(
    (value): value is { root?: string } => typeof value === "object" && value !== null && !("resolution" in value),
  );
  if (!(ACTIONS as readonly string[]).includes(action)) {
    throw new UsageError(`Unknown alias action '${action}'. Valid actions: ${ACTIONS.join(", ")}.`);
  }
  const root = projectRoot(options?.root, context);
  const enabled = aliasesEnabled();

  if (action === "list") {
    const aliases = enabled ? loadAliases(root) : {};
    runReport.result({ action: "list", aliases, enabled });
    if (!enabled) {
      runReport.diagnostic("Command aliases are disabled. Set CINECODE_ALIASES=1 to enable them.");
      return;
    }
    const keys = Object.keys(aliases);
    if (keys.length === 0) {
      runReport.diagnostic("No command aliases configured. Use 'cinecode alias set <name> <expansion>' to add one.");
      return;
    }
    runReport.diagnostic("ALIAS".padEnd(16) + "EXPANSION");
    runReport.diagnostic("-".repeat(60));
    for (const key of keys) runReport.diagnostic(key.padEnd(16) + aliases[key]);
    return;
  }

  if (!enabled && action !== "migrate") {
    throw new UsageError("Command aliases are disabled. Set CINECODE_ALIASES=1 to manage them.");
  }

  if (action === "set") {
    if (!name) throw new UsageError("alias set requires a name: `cinecode alias set <name> \"<expansion>\"`.");
    const expansion = strings.join(" ").trim();
    if (!expansion) throw new UsageError("alias set requires an expansion, for example: \"render --all\".");
    setAlias(name, expansion, root, (candidate) => context?.commandNames.has(candidate) ?? false);
    runReport.result({ action: "set", name, expansion });
    runReport.diagnostic(`✔ Alias '${name}' set to: '${expansion}'`);
    return;
  }

  if (action === "remove") {
    if (!name) throw new UsageError("alias remove requires a name.");
    const removed = removeAlias(name, root);
    runReport.result({ action: "remove", name, removed });
    runReport.diagnostic(removed ? `✔ Alias '${name}' removed.` : `Alias '${name}' not found.`);
    return;
  }

  const result = migrateLegacyAliases(root);
  runReport.result({ action: "migrate", ...result });
  runReport.diagnostic(result.migrated.length > 0
    ? `✔ Migrated ${result.migrated.length} alias(es) to ${path.join(root, "cinecode.json")}: ${result.migrated.join(", ")}`
    : "No legacy aliases to migrate.");
}

