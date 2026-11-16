import { createRequire } from "node:module";
import { trace, context, type Tracer, type Span, SpanStatusCode } from "@opentelemetry/api";

const optionalRequire = createRequire(import.meta.url);

interface TracerProviderLike {
  getTracer(name: string, version?: string): Tracer;
  forceFlush(): Promise<void>;
}

interface TracerSdk {
  BasicTracerProvider: new (config: { spanProcessors: unknown[] }) => TracerProviderLike;
  SimpleSpanProcessor: new (exporter: unknown) => unknown;
}

interface OtlpExporterModule {
  OTLPTraceExporter: new (config: { url: string }) => unknown;
}

export interface TracerOptions {
  serviceName?: string;
  otlpUrl?: string;
  enabled?: boolean;
}

export class CinecodeTracer {
  private tracer: Tracer;
  private provider: TracerProviderLike | null = null;
  private enabled: boolean;

  constructor(options: TracerOptions = {}) {
    this.enabled = options.enabled ?? (!!process.env.OTEL_EXPORTER_OTLP_ENDPOINT || false);
    const serviceName = options.serviceName ?? "cinecode-engine";

    if (this.enabled) {
      const sdk = loadOptional<TracerSdk>("@opentelemetry/sdk-trace-base");
      const otlp = loadOptional<OtlpExporterModule>("@opentelemetry/exporter-trace-otlp-http");
      if (sdk && otlp) {
        const exporter = new otlp.OTLPTraceExporter({
          url: options.otlpUrl ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
        });
        this.provider = new sdk.BasicTracerProvider({
          spanProcessors: [new sdk.SimpleSpanProcessor(exporter)],
        });
        trace.setGlobalTracerProvider(this.provider as never);
        this.tracer = this.provider.getTracer(serviceName, "1.0.0");
      } else {
        this.enabled = false;
        this.tracer = trace.getTracer(serviceName);
      }
    } else {
      this.tracer = trace.getTracer(serviceName);
    }
  }

  startJobSpan(jobId: string, metadata: Record<string, unknown> = {}): Span {
    return this.tracer.startSpan("cinecode.render.job", {
      attributes: { "job.id": jobId, ...metadata },
    });
  }

  startChildSpan(
    name: "cinecode.config.load" | "cinecode.media.resolve" | "cinecode.frame.render" | "cinecode.audio.process" | "cinecode.video.encode" | string,
    parentSpan?: Span,
    attributes: Record<string, unknown> = {},
  ): Span {
    const ctx = parentSpan ? trace.setSpan(context.active(), parentSpan) : context.active();
    return this.tracer.startSpan(name, { attributes }, ctx);
  }

  endSpanSuccess(span: Span): void {
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  endSpanError(span: Span, error: Error | string): void {
    span.setStatus({ code: SpanStatusCode.ERROR, message: typeof error === "string" ? error : error.message });
    span.end();
  }

  async flush(): Promise<void> {
    if (this.provider) {
      await this.provider.forceFlush();
    }
  }
}

function loadOptional<T>(specifier: string): T | null {
  try {
    return optionalRequire(specifier) as T;
  } catch {
    process.emitWarning(
      `Tracing requested but ${specifier} is not installed. Install @opentelemetry/sdk-trace-base and @opentelemetry/exporter-trace-otlp-http, or unset OTEL_EXPORTER_OTLP_ENDPOINT.`,
    );
    return null;
  }
}

export const globalTracer = new CinecodeTracer();
