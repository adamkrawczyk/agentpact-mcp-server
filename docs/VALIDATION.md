# Validation record

What has actually been executed against this repo and the hosted endpoint, and what has not.
Anything not listed under **Verified paths** should be treated as unverified.

Environment for all runs below: Linux x86_64, Node v26.7.0, npm 11.19.0, git 2.43.0,
curl 8.5.0, Claude Code 2.1.283, codex-cli 0.160.0.

## Verified paths

### 1. Hosted endpoint health — 2026-10-11

- **What:** `https://mcp.agentpact.xyz/health` is up.
- **How:** `curl -sS https://mcp.agentpact.xyz/health`
- **Result:** `{"ok":true,"service":"agentpact-mcp","timestamp":"2026-10-11T06:53:44.744Z"}`

### 2. Hosted MCP handshake (read-only) — 2026-10-11

- **What:** Streamable-HTTP `initialize` → `notifications/initialized` → `tools/list`. No tool
  was called.
- **How:** the bash snippet in [AGENT_SETUP.md § 4 Path A](../AGENT_SETUP.md#4-verify),
  extracted verbatim from the file and run with `bash`.
- **Result (cold run 2, verbatim):**

  ```
  session id: received
  notifications/initialized: HTTP 202
  tools/list: tool count = 60
  ```

- Raw `initialize` response: HTTP/2 200, `content-type: text/event-stream`, an
  `mcp-session-id` response header, body
  `data: {"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"agentpact-mcp","version":"0.1.0"}},"jsonrpc":"2.0","id":1}`.
- Tool annotations on the hosted list: 15 `readOnlyHint: true`, 10 `destructiveHint: true`.

### 3. Hosted vs. source vs. README tool sets — 2026-10-11

- **How:** names from hosted `tools/list` vs.
  `grep -oE 'name:\s*"agentpact\.[A-Za-z0-9_]+"' src/index.ts | sort -u` vs. the README tables.
- **Counts:** hosted **60**, source **46**, README tables **45**. The README heading said 45; it
  now says 60 (hosted), with a note about the source count.
- **On hosted, not in this source (17):** `accept_intent_b`, `acknowledge`, `cancel_stream`,
  `claim_intent`, `claim_unit`, `create_intent`, `deliver`, `discover_intents`, `get_intent`,
  `get_verification_status`, `heartbeat`, `register_encryption_pubkey`, `reject`, `reveal`,
  `set_autoclose`, `submit_funding_authorization`, `submit_reveal_preimage`.
- **In this source, not on hosted (3):** `quick_buy`, `quick_sell`, `paid_deal_templates`. The
  README's "Canonical Paid Deal Flow" uses these, so it now carries a note saying they are
  self-hosted only as of this date.
- **In source, not in README tables (1):** `seller_match_digest`.
- **Conclusion:** the hosted deployment is not built from this repo's `main` (262686f).

### 4. Error modes on the hosted endpoint — 2026-10-11

Used in the AGENT_SETUP.md Troubleshooting table. Neither request calls a tool.

- `tools/list` with no session header → HTTP 400
  `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: No valid session ID provided"},"id":null}`
- `initialize` with `Accept: application/json` only → HTTP 406
  `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must accept both application/json and text/event-stream"},"id":null}`

### 5. Claude Code registration — 2026-10-11

- **What:** the `claude mcp add` command from the runbook connects.
- **How:** in a throwaway `HOME` (so the user's real `~/.claude.json` was not touched):
  `claude mcp add --transport http agentpact https://mcp.agentpact.xyz/mcp` then
  `claude mcp list`.
- **Result:** `Added HTTP MCP server agentpact with URL: https://mcp.agentpact.xyz/mcp to local config`
  and `agentpact: https://mcp.agentpact.xyz/mcp (HTTP) - ✔ Connected`. Ran twice (once per cold run).

### 6. Codex CLI registration (config only) — 2026-10-11

- **How:** `CODEX_HOME=<tmp> codex mcp add agentpact --url https://mcp.agentpact.xyz/mcp` then
  `codex mcp list`.
- **Result:** wrote `[mcp_servers.agentpact]` / `url = "https://mcp.agentpact.xyz/mcp"`; list
  shows it `enabled`. `codex mcp list` does not connect, so this only proves the config syntax.

### 7. Self-hosted build cold run — 2026-10-11 (two runs)

- **How:** `git clone <this branch's worktree>` into a fresh temp directory, then only the
  AGENT_SETUP.md Path B commands: `npm install`, `npm run build`, `npm test`,
  `node test/boot-smoke.mjs`. The server was only started by `boot-smoke.mjs` on
  `127.0.0.1:<random port>` with `API_BASE_URL` pointed at an unreachable address; no
  marketplace backend was contacted.
- **Run 1 (commit aea6e04, draft runbook):** every command exited 0 (hosted handshake: 60 tools;
  `npm test` ALL PASS; boot smoke ALL PASS, 46 tools). The runbook's pasted "Expected" blocks
  were wrong: the `npm install` output (real: `added 108 packages`, `10 vulnerabilities (2 low, 3 moderate, 4 high, 1 critical)`,
  and an npm 11 `install-scripts` warning for `esbuild`) and the last `npm test` line (real:
  `PASS server.json npm package matches (agentpact-mcp-server)` then `ALL PASS`). Fixed:
  replaced them with the real output and added the audit/install-scripts row to
  Troubleshooting.
- **Run 2 (commit c980e3e, fixed runbook):** fresh clone, same commands, everything exited 0
  and matched the runbook:

  ```
  added 108 packages, and audited 109 packages in 1s
  10 vulnerabilities (2 low, 3 moderate, 4 high, 1 critical)

  > agentpact-mcp-server@0.2.0 build
  > tsc -p tsconfig.json

  PASS dist/index.js built (101857 bytes)
  PASS tool registry advertises 46 agentpact.* tools
  PASS canonical flow tool present: agentpact.quick_buy
  PASS canonical flow tool present: agentpact.quick_sell
  PASS canonical flow tool present: agentpact.paid_deal_templates
  PASS server.json npm package matches (agentpact-mcp-server)

  ALL PASS
  [server] MCP stdio transport connected
  [server] AgentPact MCP server listening on 127.0.0.1:37333 (Streamable HTTP at /mcp)
  PASS server booted and /health returned ok=true (port 37333)
  PASS mcp initialize handshake succeeded (session=…)
  PASS tools/list returned 46 tools (≥40 expected)
  PASS canonical flow tool present at runtime: agentpact.quick_buy
  PASS canonical flow tool present at runtime: agentpact.quick_sell
  PASS canonical flow tool present at runtime: agentpact.paid_deal_templates

  ALL PASS
  ```

### 8. Self-hosted stdio stdout pollution — 2026-10-11

- **How:** piped one `initialize` line into
  `PORT=0 MCP_HOST=127.0.0.1 API_BASE_URL=http://127.0.0.1:9 node dist/index.js` (5 s timeout).
- **Result:** stdout was `MCP stdio transport connected`, then
  `AgentPact MCP server listening on 127.0.0.1:0 (Streamable HTTP at /mcp)`, then the JSON-RPC
  reply. Stdio MCP clients expect pure JSON-RPC on stdout, so the runbook says to use the HTTP
  endpoint instead. (Not fixed in code here; this PR is docs-only.)

## Not yet validated

- **Calling any tool on the hosted endpoint.** Deliberately skipped (production, real USDC).
  Includes the read-only ones: `get_overview` etc. were not called.
- **`agentpact.register` and the API-key flow**: how a key is supplied to the hosted server
  (tool argument vs. `x-api-key` header) was not exercised.
- **Codex live connection**: config written and listed; no Codex session actually used the tools.
- **Cursor** (`.cursor/mcp.json` with `url`): not executed.
- **Claude Desktop** (Settings → Connectors, or the `mcp-remote` bridge): not executed.
- **Windsurf / `serverUrl` config** from the README: not executed.
- **`npm start` against a real backend** (`API_BASE_URL` set to a live AgentPact API): not run.
  The self-hosted server was only booted by `boot-smoke.mjs` against an unreachable backend.
- **Node 20 / 22**: the cold runs used Node 26. CI's matrix covers 20.x and 22.x, but CI results
  are not part of this record.
- **macOS / Windows**: only Linux was used. The macOS `lsof` preflight command and the AirPlay
  port-5000 note are untested here.
- **Docker image** (`Dockerfile`): not built.
- **`npx agentpact-mcp-server`** (advertised in `server.json`): not tested. `server.json` still
  says "42 tools" and was not changed.
- **The README prompt's link** to `AGENT_SETUP.md` on `main`: it only resolves after this branch
  is merged.
- **The 10 npm audit advisories**: reported, not triaged.
