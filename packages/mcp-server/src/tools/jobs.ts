import { CollectorClient } from "@kryfto/sdk-ts";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8080";
const API_TOKEN = process.env.API_TOKEN ?? process.env.KRYFTO_API_TOKEN;

function getClient(tool: string): CollectorClient {
    const token = process.env[`KRYFTO_${tool.toUpperCase()}_TOKEN`] || API_TOKEN;
    return new CollectorClient({
        baseUrl: API_BASE_URL,
        token,
    });
}

export const client = new CollectorClient({
    baseUrl: API_BASE_URL,
    token: API_TOKEN ?? "",
});

export function scopedClient(tool: string) {
    return getClient(tool);
}

// ── Dynamic Recipe Plugin Discovery ─────────────────────────────────
let lastRecipesFetch = 0;
export let dynamicRecipeTools: { name: string; description: string; inputSchema: Record<string, unknown> }[] = [];
export const dynamicRecipeMap = new Map<string, string>(); // toolName -> recipeId

export async function getDynamicRecipeTools() {
    if (Date.now() - lastRecipesFetch < 60000) return dynamicRecipeTools;
    try {
        const res = await client.listRecipes();
        dynamicRecipeTools = res.items.map((r) => {
            const toolName = `recipe_${r.id
                .replace(/[^a-zA-Z0-9_-]/g, "_")
                .substring(0, 50)}`;
            dynamicRecipeMap.set(toolName, r.id);
            return {
                name: toolName,
                description: `Run Kryfto Plugin/Recipe: ${r.name}. ${r.description ?? ""
                    }`,
                inputSchema: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "URL to run this plugin against",
                        },
                    },
                    required: ["url"],
                },
            };
        });
        lastRecipesFetch = Date.now();
    } catch (err) {
        /* ignore fallback to cached */
    }
    return dynamicRecipeTools;
}
