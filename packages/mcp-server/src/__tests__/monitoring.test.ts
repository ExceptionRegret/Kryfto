import { describe, expect, it, beforeEach } from "vitest";
import { addMonitor, listMonitors, monitors, addWatch, watchActions } from "../tools/monitoring.js";

describe("monitors", () => {
    beforeEach(() => {
        monitors.clear();
    });

    it("adds a monitor and returns correct shape", () => {
        const result = addMonitor("https://example.com", "Example");
        expect(result.id).toBeDefined();
        expect(result.url).toBe("https://example.com");
        expect(result.label).toBe("Example");
        expect(result.status).toBe("active");
    });

    it("auto-generates label from domain", () => {
        const result = addMonitor("https://docs.react.dev/hooks");
        expect(result.label).toBe("docs.react.dev");
    });

    it("lists all monitors", () => {
        addMonitor("https://a.com", "A");
        addMonitor("https://b.com", "B");
        const list = listMonitors();
        expect(list).toHaveLength(2);
        expect(list[0]!.url).toBe("https://a.com");
        expect(list[1]!.url).toBe("https://b.com");
    });
});

describe("watch actions", () => {
    beforeEach(() => {
        watchActions.clear();
    });

    it("adds a watch with webhook", () => {
        const result = addWatch(
            "https://example.com",
            "Test",
            "https://webhook.site/test",
            "React hooks"
        );
        expect(result.id).toBeDefined();
        expect(result.url).toBe("https://example.com");
        expect(result.label).toBe("Test");
        expect(result.webhookUrl).toBe("https://webhook.site/test");
        expect(result.context).toBe("React hooks");
        expect(result.status).toBe("watching");
    });

    it("adds a watch without webhook", () => {
        const result = addWatch("https://example.com");
        expect(result.webhookUrl).toBe("none");
        expect(result.context).toBe("none");
    });
});
