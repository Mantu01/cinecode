import { isAbsolute, relative, resolve } from "node:path";
import { RESERVED_NAMES } from "../config/roots.js";
import { createError, ErrorCode, type CinecodeError } from "../errors/index.js";

declare const __brand: unique symbol;
export type ManifestId = string & { readonly [__brand]: "ManifestId" };

export function normalizeId(id: string): string {
  return id.toLowerCase();
}

export function asManifestId(id: string, kind = "entry"): ManifestId {
  const rule = idRule(id);
  if (rule) throw idError(kind, id, rule);
  return id as ManifestId;
}

const ILLEGAL = /[<>:"|?*]/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const DRIVE = /^[A-Za-z]:/;
const TRAILING = /[. ]$/;

/** The violated id rule, or null when the id is a safe path segment. */
export function idRule(id: string): string | null {
  if (id.length === 0) return "the id is empty";
  if (CONTROL.test(id)) return "it contains a control character";
  if (id.includes("/") || id.includes("\\")) return "it contains a path separator";
  if (DRIVE.test(id)) return "it starts with a drive letter";
  if (isAbsolute(id)) return "it is an absolute path";
  if (id === "." || id === "..") return "it is a parent-traversal segment";
  if (ILLEGAL.test(id)) return "it contains a character illegal on Windows: <>:\"|?*";
  if (TRAILING.test(id)) return "it ends with a dot or space";
  const stem = id.split(".")[0]!.toUpperCase();
  if (RESERVED_NAMES.has(stem)) return `it is the reserved Windows device name "${stem}"`;
  return null;
}

export function idError(kind: string, id: string, rule: string): CinecodeError {
  return createError(
    ErrorCode.CC1003,
    { key: `${kind}[].id`, path: id, reason: `${kind} "${id}" is not a filesystem-safe id: ${rule}` },
    { fixHint: "Use a name made of letters, digits and dashes; ids become file names in the output root." },
  );
}

/** Every id rule violation across the manifest's four collections. */
export function validateManifestIds(
  collections: ReadonlyArray<{ readonly kind: string; readonly entries: readonly { readonly id?: unknown }[] }>,
): CinecodeError[] {
  const errors: CinecodeError[] = [];
  for (const collection of collections) {
    for (const entry of collection.entries) {
      if (typeof entry.id !== "string") continue;
      const rule = idRule(entry.id);
      if (rule) errors.push(idError(collection.kind, entry.id, rule));
    }
  }
  return errors;
}

/** Ids must be unique verbatim and after case folding: one file, one owner. */
export function idCollisions(
  collections: ReadonlyArray<{ readonly kind: string; readonly entries: readonly { readonly id?: unknown }[] }>,
): Array<{ readonly id: string; readonly first: string; readonly second: string }> {
  const seen = new Map<string, { id: string; where: string }>();
  const collisions: Array<{ id: string; first: string; second: string }> = [];
  for (const collection of collections) {
    collection.entries.forEach((entry, index) => {
      if (typeof entry.id !== "string") return;
      const key = entry.id.toLowerCase();
      const where = `${collection.kind}s[${index}]`;
      const previous = seen.get(key);
      if (previous) collisions.push({ id: entry.id, first: previous.where, second: where });
      else seen.set(key, { id: entry.id, where });
    });
  }
  return collisions;
}

/** Generated files never resolve outside the output root; ids are used verbatim. */
export function assertIdPathInside(outputRoot: string, target: string, id: string): void {
  const rel = relative(resolve(outputRoot), resolve(target));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw idError("generated file", id, `it resolves outside the output root (${resolve(outputRoot)})`);
  }
}
