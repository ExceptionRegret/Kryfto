// ── Lightweight Observability Traces ───────────────────────────────

import { randomUUID } from "node:crypto";

export interface TraceSpan {
  spanId: string;
  operation: string;
  startMs: number;
  endMs: number | undefined;
  durationMs: number | undefined;
  metadata: Record<string, unknown>;
  children: TraceSpan[];
}

export interface TraceContext {
  traceId: string;
  rootSpan: TraceSpan;
  currentSpan: TraceSpan;
}

export function createTrace(operation: string): TraceContext {
  const rootSpan: TraceSpan = {
    spanId: randomUUID().substring(0, 8),
    operation,
    startMs: Date.now(),
    endMs: undefined,
    durationMs: undefined,
    metadata: {},
    children: [],
  };
  return {
    traceId: randomUUID().substring(0, 12),
    rootSpan,
    currentSpan: rootSpan,
  };
}

export function startSpan(
  ctx: TraceContext,
  operation: string,
  metadata: Record<string, unknown> = {}
): TraceSpan {
  const span: TraceSpan = {
    spanId: randomUUID().substring(0, 8),
    operation,
    startMs: Date.now(),
    endMs: undefined,
    durationMs: undefined,
    metadata,
    children: [],
  };
  ctx.currentSpan.children.push(span);
  const parentSpan = ctx.currentSpan;
  ctx.currentSpan = span;
  // Store parent ref in metadata for restoration
  (span as any)._parent = parentSpan;
  return span;
}

export function endSpan(ctx: TraceContext, span: TraceSpan): void {
  span.endMs = Date.now();
  span.durationMs = span.endMs - span.startMs;
  // Restore parent as current span
  const parent = (span as any)._parent;
  if (parent) {
    ctx.currentSpan = parent;
    delete (span as any)._parent;
  }
}

export function finalizeTrace(
  ctx: TraceContext
): Record<string, unknown> {
  ctx.rootSpan.endMs = Date.now();
  ctx.rootSpan.durationMs = ctx.rootSpan.endMs - ctx.rootSpan.startMs;
  return {
    traceId: ctx.traceId,
    totalDurationMs: ctx.rootSpan.durationMs,
    spans: serializeSpan(ctx.rootSpan),
  };
}

function serializeSpan(span: TraceSpan): Record<string, unknown> {
  return {
    spanId: span.spanId,
    operation: span.operation,
    durationMs: span.durationMs,
    metadata: span.metadata,
    ...(span.children.length > 0
      ? { children: span.children.map(serializeSpan) }
      : {}),
  };
}
