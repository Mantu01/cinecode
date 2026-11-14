const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/g,
  /(?:aws_secret_access_key|secret_key|secretKey)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
  /Bearer\s+[A-Za-z0-9_.\-]+/gi,
  /https?:\/\/[^:]+:([^@]+)@/g,
  /X-Amz-Signature=[A-Fa-f0-9]+/gi,
  /-----BEGIN\s+(?:OPENSSH|RSA|EC|DSA|PRIVATE)?\s*KEY-----[\s\S]*?-----END\s+(?:OPENSSH|RSA|EC|DSA|PRIVATE)?\s*KEY-----/g,
];

export class SecretRedactor {
  static redactString(text: string): string {
    if (!text || typeof text !== "string") return text;
    let result = text;
    for (const pattern of SECRET_PATTERNS) {
      result = result.replace(pattern, (match) => {
        if (match.startsWith("Bearer ")) return "Bearer [REDACTED_SECRET]";
        if (match.includes("://") && match.includes("@")) {
          return match.replace(/:[^:@]+@/, ":[REDACTED_SECRET]@");
        }
        return "[REDACTED_SECRET]";
      });
    }
    return result;
  }

  static redactObject<T>(target: T): T {
    if (target === null || typeof target !== "object") {
      if (typeof target === "string") {
        return SecretRedactor.redactString(target) as unknown as T;
      }
      return target;
    }

    if (Array.isArray(target)) {
      return target.map((item) => SecretRedactor.redactObject(item)) as unknown as T;
    }

    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(target)) {
      if (/password|secret|token|apiKey|auth/i.test(key) && typeof value === "string") {
        clean[key] = "[REDACTED_SECRET]";
      } else {
        clean[key] = SecretRedactor.redactObject(value);
      }
    }

    return clean as T;
  }
}
