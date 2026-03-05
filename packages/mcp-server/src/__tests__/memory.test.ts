import { describe, expect, it, beforeEach } from "vitest";
import { getProfile, setProfile, memoryProfiles } from "../tools/memory.js";

describe("memory profiles", () => {
    beforeEach(() => {
        memoryProfiles.clear();
    });

    it("returns default profile for unknown project", () => {
        const profile = getProfile("unknown");
        expect(profile.preferredSources).toEqual([]);
        expect(profile.stack).toEqual([]);
        expect(profile.outputFormat).toBe("markdown");
        expect(profile.notes).toEqual([]);
    });

    it("sets and retrieves a profile", () => {
        setProfile("my-project", {
            preferredSources: ["docs.python.org"],
            stack: ["python", "fastapi"],
            outputFormat: "json",
            notes: ["Use type hints"],
        });
        const profile = getProfile("my-project");
        expect(profile.preferredSources).toEqual(["docs.python.org"]);
        expect(profile.stack).toEqual(["python", "fastapi"]);
        expect(profile.outputFormat).toBe("json");
        expect(profile.notes).toEqual(["Use type hints"]);
    });

    it("merges partial updates with existing profile", () => {
        setProfile("merge-test", {
            preferredSources: ["a.com"],
            stack: ["node"],
        });
        setProfile("merge-test", {
            notes: ["new note"],
        });
        const profile = getProfile("merge-test");
        expect(profile.preferredSources).toEqual(["a.com"]);
        expect(profile.stack).toEqual(["node"]);
        expect(profile.notes).toEqual(["new note"]);
    });
});
