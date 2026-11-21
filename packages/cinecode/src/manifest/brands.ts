export type DefinitionKind = "image" | "audio" | "scene" | "timeline" | "composition";

export type EntryKind = "image" | "audio" | "scene" | "timeline";

const KINDS = new WeakMap<object, DefinitionKind>();

/** Brands a definition so the loader checks intent, not shape. */
export function brandDefinition<T extends object>(value: T, kind: DefinitionKind): T {
  KINDS.set(value, kind);
  return value;
}

export function definitionKindOf(value: unknown): DefinitionKind | undefined {
  return typeof value === "object" && value !== null ? KINDS.get(value) : undefined;
}

/** Brands (and kinds) a module export may legitimately carry for an entry kind. */
const ACCEPTED_BRANDS: Readonly<Record<EntryKind, readonly DefinitionKind[]>> = {
  image: ["image"],
  audio: ["audio"],
  scene: ["scene", "timeline", "composition"],
  timeline: ["timeline", "composition", "scene"],
};

/** The documented raw shapes, used only when the export carries no brand. */
function matchesRawShape(kind: EntryKind, raw: unknown): boolean {
  if (typeof raw === "function") return true;
  if (Array.isArray(raw)) return kind === "scene";
  if (typeof raw !== "object" || raw === null) return false;
  const record = raw as Record<string, unknown>;
  if (kind === "image") return typeof record.type === "string";
  if (kind === "audio") {
    return record.kind === "sound" || record.kind === "audio" || ("data" in record && "sampleRate" in record);
  }
  if (Array.isArray(record.tracks)) return true;
  if ("rootTimeline" in record) return true;
  return record.kind === "scene" && typeof record.build === "function";
}

export function describeExport(raw: unknown): string {
  if (typeof raw === "function") return "a function";
  if (Array.isArray(raw)) return "an array";
  if (raw === null) return "null";
  if (typeof raw !== "object") return `a primitive (${typeof raw})`;
  const brand = definitionKindOf(raw);
  if (brand) return withArticle(brand);
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.tracks)) return "a timeline (tracks array)";
  if ("rootTimeline" in record) return "a composition (rootTimeline)";
  if (record.kind === "sound") return "a sound definition (defineSound)";
  if (typeof record.kind === "string") return `a ${String(record.kind)} definition`;
  if (typeof record.type === "string") return `a ${String(record.type)} clip`;
  return "an object";
}

export interface EntryExportCheck {
  readonly ok: boolean;
  readonly expected: string;
  readonly received: string;
}

/** Brand first; the documented raw shape is the only unbranded fallback. */
function withArticle(kind: DefinitionKind): string {
  const article = kind === "image" || kind === "audio" ? "an" : "a";
  if (kind === "composition") return "a composition (composition)";
  return `${article} ${kind} (define${kind.charAt(0).toUpperCase()}${kind.slice(1)})`;
}

export function checkEntryExport(kind: EntryKind, raw: unknown): EntryExportCheck {
  const expected = withArticle(kind);
  const brand = definitionKindOf(raw);
  if (brand) {
    return { ok: ACCEPTED_BRANDS[kind].includes(brand), expected, received: describeExport(raw) };
  }
  return { ok: matchesRawShape(kind, raw), expected, received: describeExport(raw) };
}
