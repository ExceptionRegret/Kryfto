import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const mcpPath = join(__dirname, "packages/mcp-server/dist/index.js");
console.log("Starting MCP server at:", mcpPath);

const mcp = spawn("node", [mcpPath], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    KRYFTO_API_TOKEN: "dev_admin_token_change_me",
    API_BASE_URL: "http://localhost:3000",
  },
});

let rpcId = 1;

function sendReq(method, params) {
  const req = {
    jsonrpc: "2.0",
    id: rpcId++,
    method,
    params,
  };
  console.log("\n>>> SENDING:", JSON.stringify(req));
  mcp.stdin.write(JSON.stringify(req) + "\n");
}

let buffer = "";
mcp.stdout.on("data", (d) => {
  buffer += d.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop(); // Keep incomplete line in buffer

  for (const line of lines) {
    if (line.trim()) {
      try {
        const parsed = JSON.parse(line);
        console.log(
          "\n<<< RECEIVED:",
          JSON.stringify(parsed, null, 2).substring(0, 1000) + "...\n"
        );

        // After receiving first response, send second request
        if (parsed.id === 1) {
          sendReq("tools/call", {
            name: "search",
            arguments: {
              query: "latest tech news",
              limit: 2,
              topic: "news",
              include_images: true,
              privacy_mode: "zero_trace",
            },
          });
        } else if (parsed.id === 2) {
          // Both tests done
          console.log("\n✅ Tests finished successfully!");
          mcp.kill();
          process.exit(0);
        }
      } catch (e) {
        console.error("Failed to parse line:", line);
      }
    }
  }
});

mcp.on("error", (err) => {
  console.error("Failed to start MCP server:", err);
});

// Run Test 1: read_url with zero_trace
setTimeout(() => {
  sendReq("tools/call", {
    name: "read_url",
    arguments: {
      url: "https://example.com",
      privacy_mode: "zero_trace",
    },
  });
}, 1000);

setTimeout(() => {
  console.error("Test timed out");
  mcp.kill();
  process.exit(1);
}, 15000);
