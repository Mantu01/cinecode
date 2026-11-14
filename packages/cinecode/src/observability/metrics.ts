import client from "prom-client";

export class MetricsRegistry {
  readonly register: client.Registry;
  readonly rendersTotal: client.Counter<"status">;
  readonly framesRenderedTotal: client.Counter;
  readonly cacheHitsTotal: client.Counter;
  readonly cacheMissesTotal: client.Counter;
  readonly errorsTotal: client.Counter<"code">;

  readonly activeRenders: client.Gauge;
  readonly workersActive: client.Gauge;
  readonly memoryBytes: client.Gauge<"type">;

  readonly renderDurationSeconds: client.Histogram;
  readonly frameRenderTimeMs: client.Histogram;

  constructor() {
    this.register = new client.Registry();
    client.collectDefaultMetrics({ register: this.register, prefix: "cinecode_process_" });

    this.rendersTotal = new client.Counter({
      name: "cinecode_renders_total",
      help: "Total render jobs processed",
      labelNames: ["status"],
      registers: [this.register],
    });

    this.framesRenderedTotal = new client.Counter({
      name: "cinecode_frames_rendered_total",
      help: "Cumulative frames rendered",
      registers: [this.register],
    });

    this.cacheHitsTotal = new client.Counter({
      name: "cinecode_cache_hits_total",
      help: "Total frame cache hits",
      registers: [this.register],
    });

    this.cacheMissesTotal = new client.Counter({
      name: "cinecode_cache_misses_total",
      help: "Total frame cache misses",
      registers: [this.register],
    });

    this.errorsTotal = new client.Counter({
      name: "cinecode_errors_total",
      help: "Errors categorized by error code",
      labelNames: ["code"],
      registers: [this.register],
    });

    this.activeRenders = new client.Gauge({
      name: "cinecode_active_renders",
      help: "Number of render jobs currently executing",
      registers: [this.register],
    });

    this.workersActive = new client.Gauge({
      name: "cinecode_workers_active",
      help: "Number of worker threads currently processing frames",
      registers: [this.register],
    });

    this.memoryBytes = new client.Gauge({
      name: "cinecode_memory_bytes",
      help: "Node.js process memory metrics in bytes",
      labelNames: ["type"],
      registers: [this.register],
    });

    this.renderDurationSeconds = new client.Histogram({
      name: "cinecode_render_duration_seconds",
      help: "Histogram of total render execution times",
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      registers: [this.register],
    });

    this.frameRenderTimeMs = new client.Histogram({
      name: "cinecode_frame_render_time_ms",
      help: "Per-frame rendering latency distribution in milliseconds",
      buckets: [2, 5, 10, 16.6, 33.3, 50, 100, 250],
      registers: [this.register],
    });
  }

  updateMemoryMetrics(): void {
    const mem = process.memoryUsage();
    this.memoryBytes.set({ type: "heap" }, mem.heapUsed);
    this.memoryBytes.set({ type: "rss" }, mem.rss);
  }

  async getMetricsText(): Promise<string> {
    this.updateMemoryMetrics();
    return this.register.metrics();
  }

  get contentType(): string {
    return this.register.contentType;
  }
}

export const globalMetrics = new MetricsRegistry();
