import { trace, context, type Tracer, type Span, SpanStatusCode } from "@opentelemetry/api";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

export interface TracerOptions {
  serviceName?: string;
  otlpUrl?: string;
  enabled?: boolean;
}

export class CinecodeTracer {
  private tracer: Tracer;
  private provider: BasicTracerProvider | null = null;
  private enabled: boolean;

  constructor(options: TracerOptions = {}) {
    this.enabled = options.enabled ?? (!!process.env.OTEL_EXPORTER_OTLP_ENDPOINT || false);
    const serviceName = options.serviceName ?? "cinecode-engine";

    if (this.enabled) {
      const exporter = new OTLPTraceExporter({
        url: options.otlpUrl ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
      });
      this.provider = new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      trace.setGlobalTracerProvider(this.provider);
      this.tracer = this.provider.getTracer(serviceName, "1.0.0");
    } else {
      this.tracer = trace.getTracer(serviceName);
    }
  }

  startJobSpan(jobId: string, metadata: Record<string, unknown> = {}): Span {
    const span = this.tracer.startSpan("cinecode.render.job", {
      attributes: {
        "job.id": jobId,
        ...metadata,
      },
    });
    return span;
  }

  startChildSpan(name: "cinecode.config.load" | "cinecode.media.resolve" | "cinecode.frame.render" | "cinecode.audio.process" | "cinecode.video.encode" | string, parentSpan?: Span, attributes: Record<string, unknown> = {}): Span {
    const ctx = parentSpan ? trace.setSpan(context.active(), parentSpan) : context.active();
    return this.tracer.startSpan(name, { attributes }, ctx);
  }

  endSpanSuccess(span: Span): void {
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  endSpanError(span: Span, error: Error | string): void {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: typeof error === "string" ? error : error.message,
    });
    span.end();
  }

  async flush(): Promise<void> {
    if (this.provider) {
      await this.provider.forceFlush();
    }
  }
}

export const globalTracer = new CinecodeTracer();
