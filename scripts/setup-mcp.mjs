import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const MCP_INDEX_PATH = path.join(
  REPO_ROOT,
  "packages",
  "mcp-server",
  "dist",
  "index.js"
);

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("==============================================");
  console.log("🤖 Kryfto MCP Configuration Wizard");
  console.log("==============================================\n");

  console.log("Select your AI Assistant / Client:");
  console.log("1. Claude Desktop (or Cursor)");
  console.log("2. OpenAI Codex (.codex/config.toml)");
  console.log("3. RooCode / Cline (mcp_settings.json)");
  console.log("4. Generic (JSON)");

  const clientChoice = await rl.question("\nEnter number [1-4]: ");

  const baseUrl = await rl.question(
    "\nEnter Kryfto API Base URL [http://localhost:8080]: "
  );
  const finalBaseUrl = baseUrl.trim() || "http://localhost:8080";

  let token = await rl.question(
    "Enter Kryfto API Token (leave empty to use .env KRYFTO_API_TOKEN): "
  );
  token = token.trim();
  if (!token) {
    try {
      const envFile = await fs.readFile(path.join(REPO_ROOT, ".env"), "utf-8");
      const match = envFile.match(/^KRYFTO_API_TOKEN=(.*)$/m);
      if (match && match[1]) {
        token = match[1].trim();
        console.log(
          `\n✅ Auto-detected token from .env: ${token.substring(0, 5)}...`
        );
      }
    } catch (e) {
      // ignore missing .env
    }
  }

  if (!token) {
    token = "<your_api_token>";
  }

  console.log("\n==============================================");
  console.log("🎉 Generated Configuration");
  console.log("==============================================\n");

  if (clientChoice === "2") {
    // Codex (TOML)
    const toml = `[mcp_servers.kryfto]
command = "node"
args = ["${MCP_INDEX_PATH.replace(/\\/g, "\\\\")}"]

[mcp_servers.kryfto.env]
API_BASE_URL = "${finalBaseUrl}"
API_TOKEN = "${token}"
`;
    console.log(toml);
    console.log("\n👉 Instructions:");
    console.log(
      "Copy the above TOML and append it to your project's `.codex/config.toml` file, or your global `~/.codex/config.toml`."
    );
  } else {
    // Claude Desktop, Cursor, RooCode, Generic (JSON)
    const jsonConfig = {
      mcpServers: {
        kryfto: {
          command: "node",
          args: [MCP_INDEX_PATH],
          env: {
            API_BASE_URL: finalBaseUrl,
            API_TOKEN: token,
          },
        },
      },
    };

    if (clientChoice === "1") {
      console.log(JSON.stringify(jsonConfig, null, 2));
      console.log("\n👉 Instructions:");
      console.log(
        "For Claude Desktop: Copy this into `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\\Claude\\claude_desktop_config.json` (Windows)."
      );
      console.log(
        'For Cursor: Go to Cursor Settings > Features > MCP, click "+ Add new MCP server", select type "command", command `node`, and pass the absolute path/env variables shown above.'
      );
    } else if (clientChoice === "3") {
      // RooCode often just wants the inner object
      console.log(JSON.stringify(jsonConfig, null, 2));
      console.log("\n👉 Instructions:");
      console.log(
        "Copy this into your global `mcp_settings.json` file used by RooCode/Cline."
      );
    } else {
      console.log(JSON.stringify(jsonConfig, null, 2));
    }
  }

  console.log("\n==============================================");
  console.log("Make sure you have run `pnpm build` so the dist file exists!");
  console.log("==============================================\n");

  rl.close();
}

main().catch(console.error);
