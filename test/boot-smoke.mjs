#!/usr/bin/env node
/**
 * boot-smoke.mjs — runtime boot smoke test for agentpact-mcp-server.
 *
 * Ships in response to atomic-habits 2026-06-11 rank-1:
 *   "Current CI smoke is structural-only (never boots the server)"
 *
 * What this does:
 *   1. Spawns `node dist/index.js` on a random ephemeral port.
 *   2. Polls /health until the server is ready (up to 10s).
 *   3. Sends MCP `initialize` over Streamable HTTP, captures session ID.
 *   4. Sends `tools/list` with the session ID.
 *   5. Asserts quick_buy / quick_sell / paid_deal_templates are present
 *      (canonical paid-deal flow, added in e873207 with zero runtime coverage).
 *   6. Kills the server.
 *
 * Exit 0 = pass, non-zero = fail. Pure Node stdlib, no deps.
 *
 * Required: `npm run build` must run first (CI wires boot-smoke after build).
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const ok = (name) => console.log(`PASS ${name}`);
const bad = (name, detail) => {
  console.error(`FAIL ${name}: ${detail}`);
  failed++;
};

// ── 1. Pick an ephemeral port ─────────────────────────────────────────

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// ── 2. Spawn the server ───────────────────────────────────────────────

const port = await getEphemeralPort();
const serverEntry = join(root, "dist/index.js");

const child = spawn("node", [serverEntry], {
  env: {
    ...process.env,
    PORT: String(port),
    MCP_PORT: String(port),
    MCP_HOST: "127.0.0.1",
    // API_BASE_URL intentionally left absent — tool calls are not made in
    // this smoke; we only assert the tool schema is advertised.
    API_BASE_URL: "http://127.0.0.1:0", // unreachable on purpose
    NODE_ENV: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: false,
});

child.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

// Ensure the child is killed on exit even if we throw
process.on("exit", () => { try { child.kill(); } catch { /**/ } });
process.on("SIGINT", () => process.exit(1));

// ── 3. Wait for /health ───────────────────────────────────────────────

async function waitForHealth(maxMs = 10_000) {
  const deadline = Date.now() + maxMs;
  const base = `http://127.0.0.1:${port}`;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) {
        const j = await r.json();
        if (j.ok) return base;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not become healthy within ${maxMs}ms on port ${port}`);
}

let base;
try {
  base = await waitForHealth();
  ok(`server booted and /health returned ok=true (port ${port})`);
} catch (e) {
  bad("server boot", e.message);
  child.kill();
  process.exit(1);
}

// ── SSE body parser ───────────────────────────────────────────────────
// The MCP Streamable HTTP transport responds with text/event-stream for
// POST /mcp. Parse the first `data:` line and return its JSON.
async function parseMcpResponse(res) {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (ct.includes("application/json")) {
    return JSON.parse(text);
  }
  // SSE format: "event: message\ndata: {...}\n\n"
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) {
    throw new Error(`No data line in SSE response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(dataLine.slice("data:".length).trim());
}

const initPayload = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "boot-smoke", version: "0.0.1" },
  },
};

let sessionId;
try {
  const initRes = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // MCP Streamable HTTP spec (2024-11-05): POST MUST include
      // Accept: application/json, text/event-stream
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify(initPayload),
    signal: AbortSignal.timeout(5_000),
  });

  if (!initRes.ok) {
    bad("mcp initialize", `HTTP ${initRes.status}`);
    child.kill();
    process.exit(1);
  }

  sessionId = initRes.headers.get("mcp-session-id");
  const initBody = await parseMcpResponse(initRes);

  if (initBody.error) {
    bad("mcp initialize rpc", JSON.stringify(initBody.error));
    child.kill();
    process.exit(1);
  }

  if (!sessionId) {
    bad("mcp session-id header", "missing in initialize response");
    child.kill();
    process.exit(1);
  }

  ok(`mcp initialize handshake succeeded (session=${sessionId.slice(0, 8)}…)`);
} catch (e) {
  bad("mcp initialize", e.message);
  child.kill();
  process.exit(1);
}

// ── 5. tools/list → assert required tools present ─────────────────────

const listPayload = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
};

let toolNames;
try {
  const listRes = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify(listPayload),
    signal: AbortSignal.timeout(5_000),
  });

  if (!listRes.ok) {
    bad("mcp tools/list", `HTTP ${listRes.status}`);
    child.kill();
    process.exit(1);
  }

  const listBody = await parseMcpResponse(listRes);
  if (listBody.error) {
    bad("mcp tools/list rpc", JSON.stringify(listBody.error));
    child.kill();
    process.exit(1);
  }

  const rawTools = listBody.result?.tools ?? [];
  toolNames = new Set(rawTools.map((t) => t.name));

  if (toolNames.size >= 40) {
    ok(`tools/list returned ${toolNames.size} tools (≥40 expected)`);
  } else {
    bad("tools/list count", `expected ≥40, got ${toolNames.size}`);
  }
} catch (e) {
  bad("mcp tools/list", e.message);
  child.kill();
  process.exit(1);
}

// ── 6. Assert canonical paid-deal flow tools ──────────────────────────

const required = [
  "agentpact.quick_buy",
  "agentpact.quick_sell",
  "agentpact.paid_deal_templates",
];
for (const t of required) {
  if (toolNames.has(t)) {
    ok(`canonical flow tool present at runtime: ${t}`);
  } else {
    bad("canonical flow tool (runtime)", `missing ${t} in live tools/list response (regression on e873207)`);
  }
}

// ── Teardown ─────────────────────────────────────────────────────────

child.kill();

console.log(`\n${failed === 0 ? "ALL PASS" : failed + " FAILED"}`);
process.exit(failed === 0 ? 0 : 1);
