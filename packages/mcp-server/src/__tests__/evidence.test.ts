import { describe, expect, it } from "vitest";
import { calibrateConfidence } from "../tools/evidence.js";

describe("calibrateConfidence", () => {
    it("returns calibrated scores for claims", () => {
        const result = calibrateConfidence([
            {
                text: "React is a JavaScript library",
                sourceCount: 5,
                officialSources: 2,
                recency: new Date().toISOString(),
                sourceTrust: 0.9,
            },
        ]);
        expect(result.calibrated).toHaveLength(1);
        expect(result.calibrated[0]!.text).toBe("React is a JavaScript library");
        expect(result.calibrated[0]!.confidence).toBeGreaterThan(0.5);
        expect(result.calibrated[0]!.confidence).toBeLessThanOrEqual(0.99);
        expect(result.calibrated[0]!.reasoning).toContain("5 sources");
    });

    it("gives lower scores for low evidence", () => {
        const result = calibrateConfidence([
            {
                text: "Obscure claim",
                sourceCount: 1,
                officialSources: 0,
                recency: undefined,
                sourceTrust: 0.3,
            },
        ]);
        expect(result.calibrated[0]!.confidence).toBeLessThan(0.5);
    });

    it("caps confidence at 0.99", () => {
        const result = calibrateConfidence([
            {
                text: "Well-supported claim",
                sourceCount: 10,
                officialSources: 5,
                recency: new Date().toISOString(),
                sourceTrust: 1.0,
            },
        ]);
        expect(result.calibrated[0]!.confidence).toBeLessThanOrEqual(0.99);
    });

    it("handles multiple claims", () => {
        const result = calibrateConfidence([
            { text: "Claim 1", sourceCount: 3, officialSources: 1, recency: undefined, sourceTrust: 0.8 },
            { text: "Claim 2", sourceCount: 1, officialSources: 0, recency: undefined, sourceTrust: 0.4 },
        ]);
        expect(result.calibrated).toHaveLength(2);
        expect(result.calibrated[0]!.confidence).toBeGreaterThan(result.calibrated[1]!.confidence);
    });
});
