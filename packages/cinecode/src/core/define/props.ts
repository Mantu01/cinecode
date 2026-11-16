export interface PropIssue {
  readonly prop: string;
  readonly message: string;
}

export function validateSerializableProps(
  props: Record<string, unknown>,
  owner: string,
): PropIssue[] {
  const issues: PropIssue[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (!isJsonValue(value)) {
      issues.push({ prop: key, message: `Prop "${key}" of ${owner} is not JSON-serializable` });
    }
  }
  return issues;
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

export function requireProp(props: Record<string, unknown>, key: string, owner: string): unknown {
  if (!(key in props)) {
    throw new TypeError(`Missing prop "${key}" on ${owner}`);
  }
  return props[key];
}

export function checkPropType(
  props: Record<string, unknown>,
  key: string,
  expected: "number" | "string" | "boolean",
  owner: string,
): void {
  const value = props[key];
  if (value !== undefined && typeof value !== expected) {
    throw new TypeError(`Prop "${key}" on ${owner} must be ${expected}, got ${typeof value}`);
  }
}
