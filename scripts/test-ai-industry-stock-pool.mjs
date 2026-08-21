import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const taxonomyProbe = `
import {
  AI_INDUSTRY_IDENTIFIER_CAPACITY,
  AI_INDUSTRY_TAXONOMY,
} from "../artifacts/api-server/src/lib/aiIndustryTaxonomy.ts";
console.log(JSON.stringify({
  capacity: AI_INDUSTRY_IDENTIFIER_CAPACITY,
  symbols: AI_INDUSTRY_TAXONOMY.map((entry) => entry.symbol),
  categories: [...new Set(AI_INDUSTRY_TAXONOMY.flatMap((entry) => entry.categories))],
}));
`;
const taxonomyResult = spawnSync(
  "pnpm",
  ["--filter", "@workspace/scripts", "exec", "tsx", "-e", taxonomyProbe],
  { encoding: "utf8" },
);
assert.equal(taxonomyResult.status, 0, taxonomyResult.stderr || taxonomyResult.stdout);
const taxonomy = JSON.parse(taxonomyResult.stdout.trim());

const poolAdmissionProbe = `
import assert from "node:assert/strict";
import { AiIndustryStockPoolService } from "../artifacts/api-server/src/lib/aiIndustryStockPool.ts";

void (async () => {
function createPool() {
  const pool = new AiIndustryStockPoolService() as any;
  pool.started = true;
  pool.persistenceState = "ready";
  pool.members.set("AMAT", {
    symbol: "AMAT",
    categories: ["semiconductor_equipment"],
    membershipState: "observed",
    sectorReviewState: "not_eligible",
    entryReason: "test",
    exitReason: null,
    referenceIdentifier: null,
    updatedAt: new Date(),
  });
  return pool;
}

const admittedPool = createPool();
let admitted: string[] | null = null;
admittedPool.reserveAndEnrich = async (symbols: string[]) => { admitted = symbols; };
admittedPool.considerPrequalifiedLiveCandidates([{
  symbol: "AMAT",
  marketFeedState: "streaming",
  preBreakoutState: "confirmed",
  confirmationStatus: "confirmed",
}]);
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(admitted, ["AMAT"], "a confirmed non-protected focused candidate must cross the pool admission boundary");

const failingPool = createPool();
failingPool.reserveAndEnrich = async () => { throw new Error("simulated persistence failure"); };
failingPool.considerPrequalifiedLiveCandidates([{
  symbol: "AMAT",
  marketFeedState: "streaming",
  preBreakoutState: "confirmed",
  confirmationStatus: "confirmed",
}]);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(failingPool.persistenceState, "unavailable", "background persistence failure must fail-close the pool");
assert.equal(failingPool.members.get("AMAT").membershipState, "withheld", "a failed candidate must be withheld in memory");
console.log("pool admission and background failure isolation passed");
})();
`;
const poolAdmissionResult = spawnSync(
  "pnpm",
  ["--filter", "@workspace/scripts", "exec", "tsx", "-e", poolAdmissionProbe],
  { encoding: "utf8" },
);
assert.equal(poolAdmissionResult.status, 0, poolAdmissionResult.stderr || poolAdmissionResult.stdout);

assert.equal(taxonomy.capacity, 1_000, "the identifier capacity must remain explicit and bounded");
assert(taxonomy.symbols.length > 100, "the initial system-managed AI discovery taxonomy must be meaningfully broad");
assert(taxonomy.symbols.length <= taxonomy.capacity, "the initial taxonomy must not silently exceed its distinct-identifier capacity");
assert.equal(new Set(taxonomy.symbols).size, taxonomy.symbols.length, "taxonomy symbols must be deduplicated before persistence");
for (const category of [
  "ai_chips",
  "hbm_memory",
  "semiconductor_equipment",
  "ai_servers",
  "networking",
  "data_centers",
  "liquid_cooling",
  "power_grid",
  "cloud",
  "ai_software",
  "robotics_automation",
  "ai_infrastructure",
]) {
  assert(taxonomy.categories.includes(category), `taxonomy must cover ${category}`);
}

const protectedLive = readFileSync("artifacts/api-server/src/lib/databentoLive.ts", "utf8");
assert.match(
  protectedLive,
  /MONITORED_SYMBOLS = \["NVDA", "MU", "VRT", "CRDO", "AMD"\] as const/,
  "the AI pool must not change the protected five-symbol live scanner",
);
assert.match(
  protectedLive,
  /considerPrequalifiedLiveCandidates/,
  "only existing pre-breakout confirmation may request targeted enrichment",
);

const referenceBridge = readFileSync("artifacts/api-server/src/lib/databento_reference_bridge.py", "utf8");
const referenceMain = referenceBridge.slice(referenceBridge.indexOf("def main() -> None:"));
assert(referenceMain.includes("security_master_snapshot(key)"), "existing authorized Market Universe classification refresh must remain available");
assert.match(referenceMain, /definition_snapshot\(/, "EQUS.MINI discovery must remain available for discovery/lifecycle only");

const targetedBridge = readFileSync("artifacts/api-server/src/lib/databento_targeted_reference_bridge.py", "utf8");
assert.match(targetedBridge, /symbols=symbols/, "targeted bridge must pass only the bounded candidate symbols to Security Master");
assert.match(targetedBridge, /len\(symbols\) > 2000/, "targeted bridge must retain the provider's per-request bound");
assert.match(targetedBridge, /allocate_isins=False/, "targeted bridge must not allocate ISINs");

const poolService = readFileSync("artifacts/api-server/src/lib/aiIndustryStockPool.ts", "utf8");
assert.match(poolService, /onConflictDoNothing\(\{ target: aiIndustryPoolEventsTable\.eventKey \}\)/, "membership lifecycle writes must be idempotent");
assert.match(poolService, /"protected-symbol scanners", "Alert delivery", "Operations Queue", "Shadow Learning", "signal validation"/, "pool isolation must be explicit");
assert.match(poolService, /containsEntitlementFailure/, "403/no-subscription enrichment responses must be withheld");
assert.match(poolService, /reserveEnrichmentCapacity/, "the persisted distinct-identifier ledger must gate every provider request");
assert.match(poolService, /pg_advisory_xact_lock/, "capacity reservations must serialize across API instances before provider access");
assert.match(poolService, /lastOutcome: "reserved"/, "each admitted request must be durably reserved before targeted enrichment");
assert.match(poolService, /records\.get\(symbol\)/, "partial responses must be reconciled per requested symbol");
assert.match(poolService, /isActiveCommonEquity/, "only active common-equity targeted records may be verified");
assert.match(poolService, /listRecentHistory/, "append-only lifecycle history must be readable without mutating the pool");
assert.match(poolService, /reserveAndEnrich\(symbols\)\.catch/, "background pool work must catch all persistence or bridge failures");
assert.match(poolService, /handleBackgroundFailure/, "background failures must fail-close the pool without escaping to protected services");

const openApi = readFileSync("lib/api-spec/openapi.yaml", "utf8");
assert.match(openApi, /\/radar\/ai-industry-pool\/history:/, "the contract must expose read-only pool lifecycle history");

const databentoLive = readFileSync("artifacts/api-server/src/lib/databentoLive.ts", "utf8");
const poolCall = databentoLive.slice(databentoLive.indexOf("aiIndustryStockPool.considerPrequalifiedLiveCandidates"));
assert.match(poolCall, /focusedSectorSymbols\.map/, "only independent focused-scan candidates may trigger pool enrichment");
assert(!poolCall.includes("symbolRadars.map"), "protected five-symbol radar statuses must never trigger pool enrichment");

const migration = readFileSync("lib/db/drizzle/0010_ai_industry_stock_pool.sql", "utf8");
for (const table of [
  "ai_industry_pool_snapshots",
  "ai_industry_pool_members",
  "ai_industry_pool_events",
  "ai_industry_reference_usage",
]) {
  assert.match(migration, new RegExp(`CREATE TABLE "${table}"`), `migration must persist ${table}`);
}

console.log("AI industry stock pool tests passed: broad taxonomy, bounded targeted enrichment, audit idempotency, and protected-service isolation hold.");