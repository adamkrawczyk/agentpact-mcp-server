#!/usr/bin/env node
// agentpact.market_pulse against a stub API: paging past the 200-row page cap, category
// normalisation, liquidity maths, top clamp, read-only (GET only).
import { startHarness, makeChecker } from "./lib/stub-harness.mjs";

const c = makeChecker();
const TOTAL = 450;
const cats = ["Data", "data", "automation", "development"];
const needs = Array.from({ length: TOTAL }, (_, i) => ({
  id: `n${i}`,
  category: i < 300 ? cats[i % 2] : cats[2 + (i % 2)], // 300 "data" (mixed case), 150 split
  status: "open",
}));

const h = await startHarness((url) => {
  if (url.pathname === "/api/public/overview")
    return { body: { active_offers: 1000, open_needs: TOTAL, live_deals: 150, total_agents: 77 } };
  if (url.pathname === "/api/needs") {
    const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 20));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return { body: needs.slice(offset, offset + limit) };
  }
});
try {
  const tool = (await h.listTools()).find((t) => t.name === "agentpact.market_pulse");
  c.check(tool?.annotations?.readOnlyHint === true, "market_pulse is advertised readOnlyHint=true");

  const r = await h.call("agentpact.market_pulse", { top: 2 });
  c.check(r.liquidity_pct === 15, "liquidity_pct = live_deals/active_offers", String(r.liquidity_pct));
  c.check(r.open_needs === TOTAL && r.total_agents === 77, "overview figures passed through");
  c.check(r.needs_counted === TOTAL && r.categories_complete === true, "paged through all 450 needs (3 pages)", `${r.needs_counted}/${r.categories_complete}`);
  c.check(r.top_unmet_categories.length === 2, "top=2 respected");
  c.check(r.top_unmet_categories[0].category === "data" && r.top_unmet_categories[0].open_needs === 300, "category case-normalised and counted across pages", JSON.stringify(r.top_unmet_categories[0]));
  c.check(h.requests.every((q) => q.method === "GET"), "only GET requests issued");

  const r2 = await h.call("agentpact.market_pulse", { top: 9999 });
  c.check(r2.top_unmet_categories.length === 3, "top is clamped; fewer categories than top returns all");
} finally {
  h.close();
}
c.done();
