#!/usr/bin/env node
/** Runs every test/tool-*.test.mjs (stub-API tool-call tests) sequentially. Needs `npm run build` first. */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => /^tool-.*\.test\.mjs$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  console.log(`── ${f}`);
  const r = spawnSync("node", [join(dir, f)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
if (failed) { console.error(`${failed} tool test file(s) failed`); process.exit(1); }
console.log(`${files.length} tool test file(s) passed`);
