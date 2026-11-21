const VALIDATED = new WeakSet<object>();

/** Marks a config the authoring validator already accepted at definition time. */
export function markConfigValidated<T extends object>(value: T): T {
  VALIDATED.add(value);
  return value;
}

export function isConfigValidated(value: unknown): boolean {
  return typeof value === "object" && value !== null && VALIDATED.has(value);
}
