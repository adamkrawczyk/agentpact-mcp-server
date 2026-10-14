/**
 * stub-harness.mjs — shared helper for tool-call tests.
 *
 * Starts a local stub of the AgentPact REST API (so no live marketplace is
 * touched), boots dist/index.js pointed at it, performs the MCP Streamable-HTTP
 * handshake and returns { call, requests, close }.
 */
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { createServer as createNet } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createNet();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

async function parseMcp(res) {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("application/json")) return JSON.parse(text);
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error(`no data line: ${text.slice(0, 200)}`);
  return JSON.parse(line.slice(5).trim());
}

/** @param {(url: URL, req: import("node:http").IncomingMessage) => {status?: number, body: unknown}} route */
export async function startHarness(route) {
  const requests = [];
  const api = createHttp((req, res) => {
    const url = new URL(req.url, "http://stub");
    requests.push({ method: req.method, path: url.pathname, search: url.search });
    const out = route(url, req) ?? { status: 404, body: { error: "not found" } };
    res.writeHead(out.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(out.body));
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const apiPort = api.address().port;

  const port = await freePort();
  const child = spawn("node", [join(root, "dist/index.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      MCP_PORT: String(port),
      MCP_HOST: "127.0.0.1",
      API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      MCP_API_KEY: "",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const close = () => {
    try { child.kill(); } catch { /**/ }
    api.close();
    api.closeAllConnections?.();
  };

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) { close(); throw new Error("server did not boot"); }
    await new Promise((r) => setTimeout(r, 150));
  }

  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const init = await fetch(`${base}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tool-test", version: "0" } } }),
  });
  const sid = init.headers.get("mcp-session-id");
  await parseMcp(init);
  await fetch(`${base}/mcp`, { method: "POST", headers: { ...headers, "mcp-session-id": sid }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });

  let id = 10;
  const rpc = async (method, params) =>
    parseMcp(await fetch(`${base}/mcp`, { method: "POST", headers: { ...headers, "mcp-session-id": sid }, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }) }));

  return {
    requests,
    close,
    listTools: async () => (await rpc("tools/list", {})).result.tools,
    /** Calls a tool and returns the parsed JSON text payload (or throws on isError). */
    call: async (name, args = {}) => {
      const r = await rpc("tools/call", { name, arguments: args });
      if (r.error) throw new Error(JSON.stringify(r.error));
      const text = r.result.content[0].text;
      if (r.result.isError) throw new Error(text);
      return JSON.parse(text);
    },
  };
}

export function makeChecker() {
  let failed = 0;
  return {
    ok: (name) => console.log(`PASS ${name}`),
    check(cond, name, detail = "") {
      if (cond) console.log(`PASS ${name}`);
      else { console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`); failed++; }
    },
    done() {
      if (failed) { console.error(`\n${failed} FAILED`); process.exit(1); }
      console.log("\nALL PASS");
    },
  };
}
