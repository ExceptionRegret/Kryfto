import { describe, expect, it, beforeEach } from "vitest";
import { recordSLO, getSLODashboard, percentile, storeReplay, replayRequest, listReplays } from "../slo.js";

describe("SLO metrics", () => {
    it("records and reports SLO metrics", () => {
        // Record some metrics
        recordSLO("search", true, 150, false, "req-1");
        recordSLO("search", true, 200, true, "req-2");
        recordSLO("search", false, 5000, false, "req-3");
        recordSLO("read_url", true, 300, false, "req-4");

        const dashboard = getSLODashboard(undefined, 60);
        expect(dashboard.totalRequests).toBeGreaterThanOrEqual(4);
        expect(dashboard.windowMinutes).toBe(60);
        expect(dashboard.tools.length).toBeGreaterThanOrEqual(2);
        expect(dashboard.generatedAt).toBeDefined();
        expect(dashboard.freshness).toBeDefined();
    });

    it("filters by tool name", () => {
        recordSLO("test_tool", true, 100, false, "req-filter-1");
        const dashboard = getSLODashboard("test_tool", 60);
        const testTool = dashboard.tools.find(t => t.tool === "test_tool");
        expect(testTool).toBeDefined();
        expect(testTool!.totalCalls).toBeGreaterThanOrEqual(1);
    });
});

describe("percentile", () => {
    it("calculates p50 correctly", () => {
        expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    });

    it("calculates p99 correctly", () => {
        expect(percentile([1, 2, 3, 4, 5], 99)).toBe(5);
    });

    it("handles empty array", () => {
        expect(percentile([], 50)).toBe(0);
    });

    it("handles single element", () => {
        expect(percentile([42], 50)).toBe(42);
    });
});

describe("replay store", () => {
    it("stores and retrieves replays", () => {
        storeReplay("replay-1", "search", { query: "test" }, { results: [] }, 150);
        const replay = replayRequest("replay-1");
        expect(replay).toBeDefined();
        expect(replay!.tool).toBe("search");
        expect(replay!.latencyMs).toBe(150);
    });

    it("returns undefined for unknown replay", () => {
        expect(replayRequest("nonexistent")).toBeUndefined();
    });

    it("lists replays in reverse chronological order", () => {
        storeReplay("list-1", "search", {}, {}, 100);
        storeReplay("list-2", "read_url", {}, {}, 200);
        const replays = listReplays(10);
        expect(replays.length).toBeGreaterThanOrEqual(2);
        // Most recent first
        const idx1 = replays.findIndex(r => r.requestId === "list-1");
        const idx2 = replays.findIndex(r => r.requestId === "list-2");
        expect(idx2).toBeLessThan(idx1);
    });
});
