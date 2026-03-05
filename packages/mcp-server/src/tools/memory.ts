export const memoryProfiles = new Map<
    string,
    {
        preferredSources: string[];
        stack: string[];
        outputFormat: string;
        notes: string[];
    }
>();

export function getProfile(projectId: string) {
    return (
        memoryProfiles.get(projectId) ?? {
            preferredSources: [],
            stack: [],
            outputFormat: "markdown",
            notes: [],
        }
    );
}

export function setProfile(
    projectId: string,
    profile: {
        preferredSources?: string[] | undefined;
        stack?: string[] | undefined;
        outputFormat?: string | undefined;
        notes?: string[] | undefined;
    }
) {
    const existing = getProfile(projectId);
    memoryProfiles.set(projectId, {
        preferredSources: profile.preferredSources ?? existing.preferredSources,
        stack: profile.stack ?? existing.stack,
        outputFormat: profile.outputFormat ?? existing.outputFormat,
        notes: profile.notes ?? existing.notes,
    });
    return memoryProfiles.get(projectId)!;
}
