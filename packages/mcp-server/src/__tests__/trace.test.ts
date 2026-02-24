import { describe, expect, it } from "vitest";
import {
  createTrace,
  startSpan,
  endSpan,
  finalizeTrace,
} from "../trace.js";

describe("trace", () => {
  it("creates a trace with root span", () => {
    const ctx = createTrace("test-operation");
    expect(ctx.traceId).toBeTruthy();
    expect(ctx.rootSpan.operation).toBe("test-operation");
    expect(ctx.rootSpan.startMs).toBeGreaterThan(0);
    expect(ctx.rootSpan.endMs).toBeUndefined();
  });

  it("starts and ends a child span", () => {
    const ctx = createTrace("root");
    const span = startSpan(ctx, "child", { key: "value" });

    expect(span.operation).toBe("child");
    expect(span.metadata.key).toBe("value");

    endSpan(ctx, span);
    expect(span.endMs).toBeDefined();
    expect(span.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("nests spans correctly", () => {
    const ctx = createTrace("root");
    const parent = startSpan(ctx, "parent");
    const child = startSpan(ctx, "child");

    endSpan(ctx, child);
    endSpan(ctx, parent);

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]!.operation).toBe("child");
  });

  it("finalizes trace with total duration", () => {
    const ctx = createTrace("root");
    const span = startSpan(ctx, "work");
    endSpan(ctx, span);

    const result = finalizeTrace(ctx);
    expect(result.traceId).toBeTruthy();
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect((result.spans as any).operation).toBe("root");
    expect((result.spans as any).children).toHaveLength(1);
  });

  it("serializes span metadata", () => {
    const ctx = createTrace("root");
    const span = startSpan(ctx, "work", { engine: "bing", count: 5 });
    endSpan(ctx, span);

    const result = finalizeTrace(ctx);
    const rootSpan = result.spans as any;
    expect(rootSpan.children[0].metadata).toEqual({
      engine: "bing",
      count: 5,
    });
  });
});
