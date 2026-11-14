const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const VALID_VAR_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class InputSanitizer {
  static sanitizeVariableName(name: string): string {
    if (!VALID_VAR_REGEX.test(name)) {
      throw new Error(`Security violation: Invalid variable name '${name}'. Variable names must match ^[A-Za-z_][A-Za-z0-9_]*$`);
    }
    return name;
  }

  static stripPrototypePollution<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => InputSanitizer.stripPrototypePollution(item)) as unknown as T;
    }

    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (DANGEROUS_KEYS.has(key)) {
        continue;
      }
      clean[key] = InputSanitizer.stripPrototypePollution(value);
    }

    return clean as T;
  }

  static evaluateSafeExpression(expr: string, context: Record<string, number | string>): number | string {
    const trimmed = expr.trim();
    if (context[trimmed] !== undefined) {
      return context[trimmed]!;
    }

    if (/^[0-9+\-*/().\s]+$/.test(trimmed)) {
      try {
        const result = Function(`"use strict"; return (${trimmed});`)();
        if (typeof result === "number" && !isNaN(result) && isFinite(result)) {
          return result;
        }
      } catch {
        void 0;
      }
    }

    throw new Error(`Security violation: Expression '${expr}' contains disallowed syntax or operations.`);
  }
}
