import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function run() {
    console.log("Starting MCP Server explicitly for evaluations...");
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['packages/mcp-server/dist/index.js'],
        env: {
            ...process.env,
            KRYFTO_API_TOKEN: process.env.KRYFTO_API_TOKEN || "dev_admin_token_change_me",
            API_BASE_URL: process.env.COLLECTOR_BASE_URL || "http://localhost:8080"
        }
    });

    const client = new Client(
        { name: "ci-eval-runner", version: "1.0.0" },
        { capabilities: {} }
    );

    await client.connect(transport);

    console.log("Connected. Triggering 'run_eval_suite' MCP Tool...");

    const result = await client.callTool({
        name: "run_eval_suite",
        arguments: {}
    });

    const text = result.content[0]?.text;
    if (!text) {
        console.error("No text returned from eval suite");
        process.exit(1);
    }

    const data = JSON.parse(text);
    console.log(JSON.stringify(data, null, 2));

    if (!data.sloPass) {
        console.error(`\n❌ EVAL SUITE FAILED: ${data.verdict}`);
        if (data.failedMetrics && data.failedMetrics.length > 0) {
            console.error("\nFailed metrics:");
            for (const metric of data.failedMetrics) {
                console.error(`  - ${metric}`);
            }
        }
        process.exit(1);
    }

    console.log(`\n✅ EVAL SUITE PASSED`);
    process.exit(0);
}

run().catch(e => {
    console.error("Fatal error during evaluations:", e);
    process.exit(1);
});
