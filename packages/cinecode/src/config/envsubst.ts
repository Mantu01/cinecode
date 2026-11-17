const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}/g;
const SENSITIVE_NAME = /(key|token|secret|password|credential)/i;

export interface EnvSubstitutionOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly onMissing?: "empty" | "throw" | "keep";
  readonly warnOnShortSecrets?: boolean;
}

export interface EnvSubstitutionResult {
  readonly value: string;
  readonly missing: readonly string[];
}

function resolveToken(
  name: string,
  fallback: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): { readonly value: string | undefined; readonly missing: boolean } {
  const raw = env[name];
  if (fallback !== undefined) {
    const value = raw === undefined || raw.length === 0 ? fallback : raw;
    return { value, missing: false };
  }
  return { value: raw, missing: raw === undefined };
}

export function substituteEnvVars(input: string, options: EnvSubstitutionOptions = {}): string {
  return substituteEnvVarsWithReport(input, options).value;
}

export function substituteEnvVarsWithReport(
  input: string,
  options: EnvSubstitutionOptions = {},
): EnvSubstitutionResult {
  const env = options.env ?? process.env;
  const onMissing = options.onMissing ?? "empty";
  const missing: string[] = [];

  const value = input.replace(ENV_PATTERN, (match, name: string, fallback: string | undefined) => {
    const resolved = resolveToken(name, fallback, env);
    if (resolved.missing) {
      missing.push(name);
      if (SENSITIVE_NAME.test(name) && options.warnOnShortSecrets) {
        console.warn(`[cinecode] environment variable ${name} looks sensitive but is not set`);
      }
      if (onMissing === "throw") {
        throw new Error(
          `Missing required environment variable '${name}'. Set it before running cinecode: export ${name}=...`,
        );
      }
      if (onMissing === "keep") return match;
      return "";
    }
    return resolved.value ?? "";
  });

  return { value, missing: [...new Set(missing)] };
}

export function findMissingEnvVars(
  input: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const missing: string[] = [];
  for (const match of input.matchAll(ENV_PATTERN)) {
    const name = match[1];
    const fallback = match[2];
    if (!name) continue;
    if (fallback !== undefined) continue;
    if (env[name] === undefined) missing.push(name);
  }
  return [...new Set(missing)];
}

export function substituteEnvVarsDeep<T>(value: T, options: EnvSubstitutionOptions = {}): T {
  if (typeof value === "string") {
    return substituteEnvVars(value, options) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteEnvVarsDeep(item, options)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = substituteEnvVarsDeep(item, options);
    }
    return result as unknown as T;
  }
  return value;
}

export interface MissingEnvVar {
  readonly name: string;
  readonly path: string;
}

function findMissingWithPaths(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
  prefix: string,
  found: MissingEnvVar[],
): void {
  if (typeof value === "string") {
    for (const name of findMissingEnvVars(value, env)) found.push({ name, path: prefix || "config" });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findMissingWithPaths(item, env, `${prefix}[${index}]`, found));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      findMissingWithPaths(item, env, prefix ? `${prefix}.${key}` : key, found);
    }
  }
}

/** Missing environment variables with the field path that references them. */
export function findMissingEnvVarsWithPaths(
  value: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly MissingEnvVar[] {
  const found: MissingEnvVar[] = [];
  findMissingWithPaths(value, env, "", found);
  return [...new Map(found.map((entry) => [`${entry.path}:${entry.name}`, entry])).values()];
}

export function findMissingEnvVarsDeep(
  value: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  if (typeof value === "string") return findMissingEnvVars(value, env);
  if (Array.isArray(value)) return value.flatMap((item) => findMissingEnvVarsDeep(item, env));
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) => findMissingEnvVarsDeep(item, env));
  }
  return [];
}
