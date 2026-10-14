#!/usr/bin/env node
// agentpact.open_needs against a stub API that mimics the live API's quirks:
// page cap of 200, `tags` filtered server-side (ANY match), `category` IGNORED server-side.
import { startHarness, makeChecker } from "./lib/stub-harness.mjs";

const c = makeChecker();
const cats = ["Data", "automation", "development"];
const needs = Array.from({ length: 500 }, (_, i) => ({
  id: `n${i}`,
  category: cats[i % 3],
  title: `need ${i}`,
  tags: i % 5 === 0 ? ["scraping"] : ["python"],
  budget_min: "1.000000",
  budget_max: "5.000000",
  currency: "USDC",
  status: "open",
  created_at: "2026-10-14T00:00:00Z",
  deadline_at: null,
  description_md: "x".repeat(50), // must not leak into the trimmed output
}));

const h = await startHarness((url) => {
  if (url.pathname === "/api/public/overview") return { body: { open_needs: 500 } };
  if (url.pathname === "/api/needs") {
    const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 20));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const tags = url.searchParams.get("tags")?.split(",");
    const pool = tags ? needs.filter((n) => n.tags.some((t) => tags.includes(t))) : needs;
    return { body: pool.slice(offset, offset + limit) };
  }
});
try {
  const tool = (await h.listTools()).find((t) => t.name === "agentpact.open_needs");
  c.check(tool?.annotations?.readOnlyHint === true, "open_needs is advertised readOnlyHint=true");
  c.check(!!tool?.inputSchema?.properties?.tags && !!tool?.inputSchema?.properties?.category, "schema advertises category + tags");

  const a = await h.call("agentpact.open_needs", {});
  c.check(a.returned === 10 && a.needs.length === 10, "default limit 10", String(a.returned));
  c.check(a.total_open_needs_marketplace === 500, "marketplace-wide open-needs count included");
  c.check(!("description_md" in a.needs[0]) && a.needs[0].tags, "output trimmed (no description), tags kept");

  const b = await h.call("agentpact.open_needs", { category: "DATA", limit: 150 });
  c.check(b.returned === 150 && b.needs.every((n) => n.category.toLowerCase() === "data"), "category filtered client-side, case-insensitive, pages past 200 rows", `${b.returned}`);

  const t = await h.call("agentpact.open_needs", { tags: "scraping", limit: 5 });
  c.check(t.returned === 5 && t.needs.every((n) => n.tags.includes("scraping")), "tags filter passed to API");

  const big = await h.call("agentpact.open_needs", { limit: 99999 });
  c.check(big.returned === 200, "limit clamped to 200", String(big.returned));
  c.check(h.requests.every((q) => q.method === "GET"), "only GET requests issued");
} finally {
  h.close();
}
c.done();
