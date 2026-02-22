# MCP Integration

The MCP server lives at `packages/mcp-server` and maps MCP tools to REST endpoints.

## Environment
- `API_BASE_URL` (default: `http://localhost:8080`)
- `API_TOKEN` (or `KRYFTO_API_TOKEN`)

## Tools
- `browse(url, steps?, options?)`
- `crawl(seed, rules)`
- `extract(input, schema, mode)`
- `search(query, limit?, engine?, safeSearch?, locale?)`
- `get_job(jobId)`
- `list_artifacts(jobId)`
- `fetch_artifact(artifactId)`

Search engines:
- `duckduckgo`
- `bing`
- `yahoo`
- `google` (uses free HTML fallback by default; API is optional)
- `brave` (uses free HTML fallback by default; API is optional)

## Build and Run
```bash
pnpm --filter @kryfto/mcp-server build
API_BASE_URL=http://localhost:8080 API_TOKEN=<token> node packages/mcp-server/dist/index.js
```

## Local Claude Code / Codex Config

If you are using Kryfto as a headless browser engine for your own local projects, you **must use the absolute path** to your downloaded Kryfto repository, so your IDE can find the server regardless of what directory your current project is in.

```json
{
  "mcpServers": {
    "kryfto": {
      "command": "node",
      "args": ["/Users/yourname/path/to/kryfto/packages/mcp-server/dist/index.js"],
      "env": {
        "API_BASE_URL": "http://localhost:8080",
        "API_TOKEN": "<your-token-here>"
      }
    }
  }
}
```

## Remote VPS Config (SSH Tunneling)

If your Kryfto instance is hosted remotely on a VPS, your local AI IDE (Cursor, Claude Code) cannot use a physical file path. Because the MCP server uses `stdio` (standard input/output) for communication, the most secure way to connect is by tunneling the node command through SSH.

This securely pipes the remote `index.js` outputs directly into your local AI assistant's brain without exposing the MCP server to the public internet!

**⚠️ Critical Requirement (SSH Keys):** Since MCP servers run silently in the background of your IDE, they **cannot** accept password prompts. You *must* configure passwordless SSH Key authentication between your local machine and your VPS just once. It will then work automatically for every project on your computer!

### macOS / Linux User Guide
Open your Terminal and run the following commands:
```bash
# 1. Generate the key (press Enter to accept default location)
ssh-keygen -t ed25519 -C "your_email@example.com"

# 2. Automatically copy it to your VPS securely
ssh-copy-id user@your-vps-ip

# 3. Test that it logs you in without asking for a password!
ssh user@your-vps-ip "echo 'Success'"
```

### Windows User Guide
Open **PowerShell** as Administrator and run the following commands:
```powershell
# 1. Generate the key (press Enter to accept default location)
ssh-keygen -t ed25519 -C "your_email@example.com"

# 2. Windows doesn't have ssh-copy-id, so run this simple PowerShell script to push the key:
$RemoteUser = "user@your-vps-ip"
$Key = Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
ssh $RemoteUser "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$Key' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# 3. Test that it logs you in without asking for a password!
ssh user@your-vps-ip "echo 'Success'"
```

---

Once `ssh user@your-vps-ip` allows you to instantly connect without a password prompt, add this to your AI's MCP config:

```json
{
  "mcpServers": {
    "kryfto-remote": {
      "command": "ssh",
      "args": [
        "user@your-vps-ip",
        "API_BASE_URL=http://localhost:8080",
        "API_TOKEN=<token>",
        "node",
        "/absolute/path/on/vps/to/kryfto/packages/mcp-server/dist/index.js"
      ]
    }
  }
}
```
