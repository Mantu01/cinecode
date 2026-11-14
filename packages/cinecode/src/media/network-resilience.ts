import { logger } from "../observability/logger.js";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableStatuses?: number[];
}

const DEFAULT_RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 10000;
  const retryable = new Set(options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES);

  let attempt = 0;

  for (;;) {
    try {
      const response = await fetch(url, init);

      if (!retryable.has(response.status) || attempt >= maxRetries) {
        return response;
      }

      attempt++;

      let delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const jitter = (Math.random() * 0.4 - 0.2) * delay;
      delay = Math.max(100, Math.round(delay + jitter));

      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        const parsedSeconds = parseInt(retryAfter, 10);
        if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
          delay = Math.min(maxDelayMs, parsedSeconds * 1000);
        }
      }

      logger.warn(
        "network",
        `Transient HTTP ${response.status} from ${url}. Retrying attempt ${attempt}/${maxRetries} in ${delay}ms...`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (err: any) {
      if (attempt >= maxRetries) throw err;

      attempt++;
      let delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const jitter = (Math.random() * 0.4 - 0.2) * delay;
      delay = Math.max(100, Math.round(delay + jitter));

      logger.warn(
        "network",
        `Network error '${err.message}' fetching ${url}. Retrying attempt ${attempt}/${maxRetries} in ${delay}ms...`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
