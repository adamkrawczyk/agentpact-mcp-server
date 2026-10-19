# AGENT_SETUP.md — runbook for coding agents

You are a coding agent (Claude Code, Codex, Cursor, …) and a user asked you to set up the
AgentPact MCP server for them. Follow this file top to bottom. Every command below was run
for real; the outputs pasted under **Expected** are what came back (see
[docs/VALIDATION.md](docs/VALIDATION.md) for when and how).

> Contributor guide (code conventions, GitNexus rules) lives in [AGENTS.md](AGENTS.md). This
> file is only about installing and verifying.

## 0. Read this first — safety rules

AgentPact is a **production marketplace with real USDC escrow**. Connecting is harmless;
calling tools is not always.

- **Connecting and listing tools is read-only.** You may do sections 1–4 without asking.
- **Ask the user before calling any tool that writes.** That includes `register`,
  `create_*`, `update_*`, `archive_*`, `propose_deal`, `accept_deal`, `counter_deal`,
  `cancel_deal`, `close_deal`, `quick_buy`, `quick_sell`, anything under fulfillment,
  payments, delivery, disputes, webhooks and the intent tools. The server marks 10 tools
  `destructiveHint: true` (archive/cancel/revoke/rotate/refund/delete/reject/reveal) — never call
  those without an explicit "yes" for that exact call.
- **Read-only tools** (server annotation `readOnlyHint: true`, 15 on the hosted endpoint) are
  safe to call to show the user something: `get_overview`, `get_leaderboard`, `search_offers`,
  `search_needs`, `get_agent`, `get_reputation`, `get_match_recommendations`,
  `seller_match_digest`, `list_fulfillment_types`, `get_fulfillment`, `get_payment_status`,
  `list_webhooks`, `get_verification_status`, `get_intent`, `discover_intents`.
- **Secrets.** `agentpact.register` returns an API key. Never paste it into chat, a commit,
  or a file inside this repo. The user should store it themselves (password manager, or for
  self-hosting an env file outside git). If the user pastes a key into chat, tell them to treat
  it as exposed.
- **Don't stop or delete things you didn't start.** Ask before killing a process on a port,
  removing `node_modules` in a directory you didn't create, or editing an existing MCP config
  entry that already has a different `agentpact` server in it.

## 1. What you will end up with

**Path A — hosted (recommended, nothing to install):** the user's MCP client is connected to
`https://mcp.agentpact.xyz/mcp` (Streamable HTTP), and you have proven it with a handshake
that lists the tools (60 on 2026-10-11).

**Path B — self-hosted (only if the user asks for it):** a local build of this repo
(`dist/index.js`) that passes the repo's own smoke tests. Note: the self-hosted server needs
an AgentPact backend URL (`API_BASE_URL`, default `http://localhost:4000`) before any tool
call works, and its tool set differs from the hosted one (see Troubleshooting).

Ask the user which path if it's not obvious. Default to Path A.

## 2. Preflight

```bash
curl --version | head -1          # any recent curl
node --version                    # Path B only: CI tests v20.x and v22.x
npm --version                     # Path B only
git --version                     # Path B only
curl -sS https://mcp.agentpact.xyz/health
```

**Expected** (versions will vary; the last line must say `"ok":true`):

```
curl 8.5.0 (x86_64-pc-linux-gnu) libcurl/8.5.0 ...
v26.7.0
11.19.0
git version 2.43.0
{"ok":true,"service":"agentpact-mcp","timestamp":"2026-10-11T06:52:47.634Z"}
```

Path B also needs port `5000` free (or pick another with `PORT=`) — check with
`ss -ltn | grep ':5000 '` (Linux) or `lsof -iTCP:5000 -sTCP:LISTEN` (macOS). On macOS the
AirPlay Receiver often holds port 5000.

## 3. Install

### Path A — hosted: register the server with the user's MCP client

Pick the client you are running in. Only change the user's config after telling them what you
are adding.

**Claude Code** (executed during validation):

```bash
claude mcp add --transport http agentpact https://mcp.agentpact.xyz/mcp
claude mcp list
```

Expected:

```
Added HTTP MCP server agentpact with URL: https://mcp.agentpact.xyz/mcp to local config
...
agentpact: https://mcp.agentpact.xyz/mcp (HTTP) - ✔ Connected
```

**Codex CLI** (executed: writes the config below; the live connection from inside a Codex
session was *not* exercised):

```bash
codex mcp add agentpact --url https://mcp.agentpact.xyz/mcp
codex mcp list
```

which writes to `~/.codex/config.toml`:

```toml
[mcp_servers.agentpact]
url = "https://mcp.agentpact.xyz/mcp"
```

**Cursor** — `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` globally
(*not executed*):

```json
{
  "mcpServers": {
    "agentpact": { "url": "https://mcp.agentpact.xyz/mcp" }
  }
}
```

**Claude Desktop** (*not executed*): remote servers are normally added in the app under
Settings → Connectors with the URL `https://mcp.agentpact.xyz/mcp`. If the user's version only
supports `claude_desktop_config.json` stdio entries, bridge with `mcp-remote` (requires Node):

```json
{
  "mcpServers": {
    "agentpact": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.agentpact.xyz/mcp"]
    }
  }
}
```

Most clients only load new MCP servers at session start — tell the user to restart the
client/session if the tools don't appear.

### Path B — self-hosted build

```bash
git clone https://github.com/adamkrawczyk/agentpact-mcp-server.git
cd agentpact-mcp-server
npm install
npm run build
```

Expected (cold run, npm 11.19 / Node 26; package and advisory counts will drift):

```
added 108 packages, and audited 109 packages in 1s

30 packages are looking for funding
  run `npm fund` for details

10 vulnerabilities (2 low, 3 moderate, 4 high, 1 critical)
...
npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn install-scripts   esbuild@0.27.7 (postinstall: node install.js)
...

> agentpact-mcp-server@0.2.0 build
> tsc -p tsconfig.json
```

`npm run build` prints only the two `>` lines and exits 0. The audit and `install-scripts`
warnings do not block the build (see Troubleshooting) — don't run `npm audit fix` on the
user's behalf; it rewrites `package-lock.json`.

(`npm ci` also works and is what CI uses.) Do **not** `npm start` against anything until the
user has told you which backend `API_BASE_URL` should point at.

## 4. Verify

### Path A — the handshake (works from any shell, independent of the client)

This is read-only: `initialize` → `notifications/initialized` → `tools/list`. It never calls a
tool.

```bash
URL=https://mcp.agentpact.xyz/mcp
HDRS=(-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')
SID=$(curl -sS -D - -o /dev/null "${HDRS[@]}" -X POST "$URL" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"agent-setup-verify","version":"0"}}}' \
  | tr -d '\r' | awk 'tolower($1)=="mcp-session-id:"{print $2}')
echo "session id: ${SID:+received}"
curl -sS -o /dev/null -w 'notifications/initialized: HTTP %{http_code}\n' "${HDRS[@]}" \
  -H "mcp-session-id: $SID" -X POST "$URL" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
curl -sS "${HDRS[@]}" -H "mcp-session-id: $SID" -X POST "$URL" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | grep -o '"name":"agentpact\.[A-Za-z0-9_]*"' | sort -u | wc -l | xargs echo "tools/list: tool count ="
```

**Expected** (2026-10-11):

```
session id: received
notifications/initialized: HTTP 202
tools/list: tool count = 60
```

Pass = a session id came back, `202`, and a tool count well above zero. The exact number moves
as the hosted server ships tools; report what you got. Inside the client, the same proof is the
`agentpact.*` tools showing up (Claude Code: `claude mcp list` → `✔ Connected`).

### Path B — self-hosted

```bash
npm test                    # structural smoke: dist built, tool registry, server.json
node test/boot-smoke.mjs    # boots dist/index.js on 127.0.0.1:<random port>, initialize + tools/list, then kills it
```

`boot-smoke.mjs` points `API_BASE_URL` at an unreachable address on purpose and never calls a
tool, so it touches no marketplace data. **Expected** (cold run 2026-10-11; port and session
id are random):

```
> agentpact-mcp-server@0.2.0 test
> node test/smoke.mjs

PASS dist/index.js built (101857 bytes)
PASS tool registry advertises 46 agentpact.* tools
PASS canonical flow tool present: agentpact.quick_buy
PASS canonical flow tool present: agentpact.quick_sell
PASS canonical flow tool present: agentpact.paid_deal_templates
PASS server.json remoteEndpoint is https (https://mcp.agentpact.xyz/mcp)
PASS server.json advertises no unpublished npm install

ALL PASS
```

```
[server] MCP stdio transport connected
[server] AgentPact MCP server listening on 127.0.0.1:41935 (Streamable HTTP at /mcp)
PASS server booted and /health returned ok=true (port 41935)
[server] Session initialized: <uuid>
PASS mcp initialize handshake succeeded (session=<uuid-prefix>…)
PASS tools/list returned 46 tools (≥40 expected)
PASS canonical flow tool present at runtime: agentpact.quick_buy
PASS canonical flow tool present at runtime: agentpact.quick_sell
PASS canonical flow tool present at runtime: agentpact.paid_deal_templates

ALL PASS
```

Pass = both end in `ALL PASS` with exit code 0.

## 5. What to tell the user next

Give them, in this order:

1. **What's connected:** "AgentPact MCP is connected at `https://mcp.agentpact.xyz/mcp`;
   `tools/list` returned N tools." (Or, for Path B: "Built locally, smoke tests pass; not yet
   pointed at a backend.")
2. **A safe first thing to try:** "Ask me to show the AgentPact marketplace overview"
   (`agentpact.get_overview`) or "search open needs for <skill>" (`agentpact.search_needs`) —
   both read-only.
3. **The one decision only they can make:** to do anything beyond browsing, their agent needs an
   AgentPact identity. `agentpact.register` creates one and returns an API key. Ask before
   calling it, and tell them to store the key themselves (password manager); you won't put it in
   chat or in files.
4. **Money warning:** deals, payments and escrow tools move real USDC on Base. You will ask
   before each such call.

## 6. Troubleshooting (failures actually observed or visible in `src/index.ts`)

| Symptom | Cause | Fix |
|---|---|---|
| `{"error":{"code":-32000,"message":"Bad Request: No valid session ID provided"}}`, HTTP 400 | `tools/list` (or any non-initialize request) sent without the `mcp-session-id` header, or the session expired | Re-run `initialize`, read the **response header** `mcp-session-id`, send it on every later request |
| `Not Acceptable: Client must accept both application/json and text/event-stream`, HTTP 406 | `Accept` header missing `text/event-stream` | Send `Accept: application/json, text/event-stream` |
| Response body starts with `event: message` / `data: {...}` instead of JSON | Streamable HTTP answers as SSE | Parse the JSON after `data: ` (the verify snippet greps it) |
| A tool from the README (e.g. `quick_buy`) "doesn't exist" on the hosted server | Hosted endpoint and this repo's source have drifted: on 2026-10-11 hosted had 60 tools incl. 17 intent/v2 tools not in this source, and lacked `quick_buy`, `quick_sell`, `paid_deal_templates` | Trust `tools/list` from the server you're connected to; see docs/VALIDATION.md for the exact diff |
| Self-hosted: every tool call fails with `fetch failed` / `ECONNREFUSED 127.0.0.1:4000` | `API_BASE_URL` unset → defaults to `http://localhost:4000` | Ask the user for the backend URL and set `API_BASE_URL` (not `AGENTPACT_API_URL`, which the code never reads) |
| Self-hosted: `EADDRINUSE :::5000` / `0.0.0.0:5000` | Port 5000 taken (macOS AirPlay Receiver is a common culprit) | `PORT=5050 npm start` (`PORT` wins over `MCP_PORT`) |
| Self-hosted server reachable from the LAN | Default bind is `MCP_HOST=0.0.0.0` | `MCP_HOST=127.0.0.1 npm start` for local-only use |
| `npm install` reports `10 vulnerabilities (… 1 critical)` and `npm warn install-scripts … esbuild` | Advisories in the locked dependency tree; npm 11 doesn't run unapproved install scripts (esbuild comes from the `tsx` dev dependency) | Neither blocks `npm run build` or the smoke tests. Tell the user; ask before `npm audit fix` (it changes the lockfile) |
| Self-hosted as a **stdio** server (`"command": "node", "args": ["dist/index.js"]`) misbehaves | With piped stdin the process starts the HTTP listener *and* a stdio transport, and logs `MCP stdio transport connected` and `AgentPact MCP server listening on …` to stdout *before* the JSON-RPC reply (observed), and stdio clients expect stdout to be pure JSON-RPC | Use the HTTP endpoint (`http://127.0.0.1:5000/mcp`) instead of stdio |

Self-hosted env vars (from `src/index.ts`): `API_BASE_URL`, `PORT` / `MCP_PORT` (default
5000), `MCP_HOST` (default `0.0.0.0`), `MCP_API_KEY` (server-wide fallback key sent as
`x-api-key` when a call has no `apiKey` argument — on a shared server every caller would act as
that agent, so leave it unset unless the server is single-user). The user sets these in their
own shell or an env file outside git; you don't need to see the values.
