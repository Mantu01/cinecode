import type { CinecodeError } from "./codes.js";

export function formatError(error: CinecodeError, verbose = false, color = true): string {
  const parts: string[] = [];
  const red = color ? "\x1b[31m" : "";
  const yellow = color ? "\x1b[33m" : "";
  const gray = color ? "\x1b[90m" : "";
  const reset = color ? "\x1b[0m" : "";
  const bold = color ? "\x1b[1m" : "";

  const severityBadge =
    error.severity === "error" ? `${red}✗ Error${reset}` : `${yellow}⚠ Warning${reset}`;
  const cleanMessage = error.message.replace(new RegExp(`^\\[?${error.code}\\]?\\s*`), "");
  parts.push(`${severityBadge}: ${bold}[${error.code}]${reset} ${cleanMessage}`);

  if (error.location) {
    const locParts: string[] = [];
    if (error.location.file) locParts.push(error.location.file);
    if (error.location.line !== undefined) locParts.push(String(error.location.line));
    if (error.location.column !== undefined) locParts.push(String(error.location.column));
    if (error.location.clip) locParts.push(`clip ${error.location.clip}`);
    if (error.location.track) locParts.push(`track ${error.location.track}`);
    if (error.location.time) locParts.push(error.location.time);
    if (locParts.length > 0) {
      parts.push(`  ${gray}Location${reset}: ${locParts.join(":")}`);
    }
  } else if (verbose) {
    parts.push(`  ${gray}Location${reset}: runtime`);
  }

  if (error.fixHint) {
    parts.push(`  ${yellow}Fix${reset}: ${error.fixHint}`);
  }

  if (verbose && error.cause) {
    let current: unknown = error.cause;
    let depth = 1;
    while (current && depth <= 5) {
      const msg = current instanceof Error ? current.message : String(current);
      if (msg !== error.message) {
        parts.push(`  ${gray}Cause${depth > 1 ? ` (${depth})` : ""}${reset}: ${msg}`);
      }
      current = current instanceof Error ? current.cause : undefined;
      depth += 1;
    }
  }

  if (verbose && error.stack) {
    parts.push(`\n${error.stack}`);
  }

  return parts.join("\n");
}

/** Categorizes an error by its code prefix into a phase name. */
export function categorizeError(code: string): string {
  const prefix = code.slice(0, 3);
  const map: Record<string, string> = {
    CC1: "config",
    CC2: "media",
    CC3: "authoring",
    CC4: "render",
    CC5: "audio",
    CC6: "network",
    CC7: "environment",
    CC8: "plugin",
    CC9: "internal",
  };
  return map[prefix] ?? "general";
}

/** Formats all errors from a check/validation run, grouped by category. */
export function formatErrorReport(errors: CinecodeError[]): string {
  if (errors.length === 0) return "";

  const byCategory = new Map<string, CinecodeError[]>();
  for (const error of errors) {
    const cat = categorizeError(error.code);
    const existing = byCategory.get(cat) ?? [];
    existing.push(error);
    byCategory.set(cat, existing);
  }

  const formatted: string[] = [];
  for (const [category, categoryErrors] of byCategory) {
    formatted.push(`\n${"=".repeat(60)}`);
    formatted.push(`${category.toUpperCase()} ERRORS (${categoryErrors.length})`);
    formatted.push("=".repeat(60));
    for (const error of categoryErrors) {
      formatted.push(formatError(error));
    }
  }

  formatted.push(`\n${"=".repeat(60)}`);
  formatted.push(`Total: ${errors.length} issue(s)`);
  formatted.push("=".repeat(60));

  return formatted.join("\n");
}
