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
 *   4. server.json is valid JSON and names the npm package.
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

// 4. server.json valid + names package
try {
  const sj = JSON.parse(readFileSync(join(root, "server.json"), "utf8"));
  const pkgName = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).name;
  const declared = sj?.installations?.npm?.package;
  if (declared === pkgName) ok(`server.json npm package matches (${pkgName})`);
  else bad("server.json", `npm package "${declared}" != package.json "${pkgName}"`);
} catch (e) {
  bad("server.json", `invalid JSON or missing field: ${e.message}`);
}

console.log(`\n${failed === 0 ? "ALL PASS" : failed + " FAILED"}`);
process.exit(failed === 0 ? 0 : 1);
