#!/usr/bin/env node
/**
 * smoke.mjs — non-booting structural smoke test for agentpact-mcp-server.
 *
 * The server starts an HTTP listener + stdio transport at import time
 * (top-level `app.listen` in src/index.ts), so we CANNOT import it without
 * hanging CI. Instead we assert against source + built artifact:
 *   1. dist/index.js exists and is non-trivial (build ran).
 *   2. The tool registry in src/index.ts advertises a sane number of tools.
 *   3. The canonical paid-deal flow tools (quick_buy / quick_sell /
 *      paid_deal_templates, added in e873207) are present — guards the
 *      commit that shipped with zero regression coverage.
 *   4. server.json is a valid official MCP Registry manifest for the hosted endpoint.
 *
 * Exit 0 = pass, non-zero = fail. Pure Node stdlib, no deps.
 */
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const ok = (name) => console.log(`PASS ${name}`);
const bad = (name, detail) => {
  console.error(`FAIL ${name}: ${detail}`);
  failed++;
};

// 1. dist built
try {
  const sz = statSync(join(root, "dist/index.js")).size;
  if (sz > 10_000) ok(`dist/index.js built (${sz} bytes)`);
  else bad("dist built", `too small: ${sz} bytes`);
} catch (e) {
  bad("dist built", `missing — run \`npm run build\` first (${e.message})`);
}

// 2 + 3. tool registry in source
const src = readFileSync(join(root, "src/index.ts"), "utf8");
const toolNames = [...src.matchAll(/name:\s*"(agentpact\.[A-Za-z0-9_]+)"/g)].map(
  (m) => m[1],
);
const uniqueTools = new Set(toolNames);
if (uniqueTools.size >= 40) {
  ok(`tool registry advertises ${uniqueTools.size} agentpact.* tools`);
} else {
  bad("tool registry", `expected >=40 tools, found ${uniqueTools.size}`);
}

const requiredFlow = [
  "agentpact.quick_buy",
  "agentpact.quick_sell",
  "agentpact.paid_deal_templates",
  "agentpact.market_pulse",
];
for (const t of requiredFlow) {
  if (uniqueTools.has(t)) ok(`canonical flow tool present: ${t}`);
  else bad("canonical flow tool", `missing ${t} (regression on e873207)`);
}

// 4. server.json valid, points at the hosted endpoint, and advertises no npm
//    install. `agentpact-mcp-server` is NOT published on npm (`npm view` -> E404,
//    2026-10-19), so an `npx agentpact-mcp-server` line sends every new agent to a
//    404. Publish to npm first, then re-add `installations.npm` and flip this check.
//
//    server.json is the OFFICIAL MCP Registry manifest (2025-12-11 schema),
//    published by .github/workflows/publish-mcp-registry.yml. The registry
//    rejects names outside the OIDC namespace and descriptions over 100 chars,
//    so both are pinned here rather than discovered at publish time.
try {
  const sj = JSON.parse(readFileSync(join(root, "server.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (String(sj?.$schema).startsWith("https://static.modelcontextprotocol.io/schemas/"))
    ok("server.json uses the official MCP Registry schema");
  else bad("server.json", `$schema is not the official registry schema: ${sj?.$schema}`);
  if (typeof sj?.name === "string" && sj.name.startsWith("io.github.adamkrawczyk/"))
    ok(`server.json name is in the OIDC namespace (${sj.name})`);
  else bad("server.json", `name must start with io.github.adamkrawczyk/: ${sj?.name}`);
  if (typeof sj?.description === "string" && sj.description.length <= 100)
    ok(`server.json description fits the registry limit (${sj.description.length}/100)`);
  else bad("server.json", `description missing or over 100 chars`);
  if (sj?.version === pkg.version) ok(`server.json version matches package.json (${sj.version})`);
  else bad("server.json", `version ${sj?.version} != package.json ${pkg.version}`);
  const remote = (sj?.remotes ?? []).find((r) => r?.type === "streamable-http");
  if (remote && remote.url === "https://mcp.agentpact.xyz/mcp")
    ok(`server.json streamable-http remote is the hosted endpoint (${remote.url})`);
  else bad("server.json", `streamable-http remote missing or wrong: ${JSON.stringify(sj?.remotes)}`);
  if ((sj?.packages ?? []).some((p) => p?.registryType === "npm"))
    bad("server.json", "advertises an npm package but agentpact-mcp-server is not on npm");
  else ok("server.json advertises no unpublished npm install");
} catch (e) {
  bad("server.json", `invalid JSON or missing field: ${e.message}`);
}

console.log(`\n${failed === 0 ? "ALL PASS" : failed + " FAILED"}`);
process.exit(failed === 0 ? 0 : 1);
