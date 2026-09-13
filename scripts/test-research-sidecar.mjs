import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const migration = readFileSync("lib/db/drizzle/0012_research_sidecar.sql", "utf8");
const schema = readFileSync("lib/db/src/schema/researchSidecar.ts", "utf8");
const route = readFileSync("artifacts/api-server/src/routes/researchSidecar.ts", "utf8");
const service = readFileSync("artifacts/api-server/src/lib/researchSidecar.ts", "utf8");
const openApi = readFileSync("lib/api-spec/openapi.yaml", "utf8");

for (const table of ["research_observation_events", "research_resonance"]) {
  assert.match(migration, new RegExp(`CREATE TABLE "${table}"`), `${table} must have a dedicated migration table`);
}
assert.match(migration, /source_lane" text NOT NULL/, "source lane must be required");
assert.match(migration, /'alex_moonvest'/, "Alex/Moonvest lane must be explicit");
assert.match(migration, /user_conversation/, "seed provenance must be user_conversation");
assert.match(migration, /'CHA'.*?overseas_reference/s, "CHA must remain an overseas reference");
assert.match(migration, /Former US ADR is delisted/s, "CHA delisting evidence must be retained");
assert.match(migration, /'ODD'.*?'us_watch'/s, "ODD may only be a US watch record");
assert.match(migration, /active NASDAQ-listed common-equity identity|Active NASDAQ class_a_ordinary_share identity/s, "ODD identity evidence must be explicit");
assert.match(migration, /https:\/\/www\.cnbc\.com\/2021\/01\/06\/nyse-will-delist-three-big-china-telecoms-reversing-decision-once-again\.html/, "CHA must cite the public delisting report");
assert.match(migration, /https:\/\/www\.nasdaq\.com\/market-activity\/stocks\/odd/, "ODD must cite the current Nasdaq listing");
assert.match(migration, /'2026-09-13'/, "seed verification and observation dates must be explicit");
assert.match(schema, /recordHash/, "raw records need immutable hashes");
assert.match(schema, /recordVersion/, "raw records need immutable versions");
assert.match(schema, /uniqueIndex\("research_observation_events_record_hash_unique"\)/, "raw evidence hashes must be unique");
assert.match(schema, /uniqueIndex\("research_resonance_hash_unique"\)/, "derived hashes must be unique");
assert(!migration.includes("REPLACE_"), "seed hashes must be deterministic, not decorative placeholders");

assert.match(route, /router\.post\(\s*"\/research-sidecar\/observations"/, "manual append must have a dedicated POST route");
assert.match(route, /getAuth\(req\)/, "manual append must use Clerk authentication");
assert.match(route, /AppendResearchObservationBody/, "manual append must use generated contract validation");
assert.match(openApi, /\/research-sidecar\/observations:/, "append endpoint must be contract-first");
assert.match(openApi, /ResearchObservationInput/, "append input must be a named contract schema");
assert(!/eventKey:|recordHash:|recordVersion:|createdAt:/s.test(openApi.slice(openApi.indexOf("ResearchObservationInput:"), openApi.indexOf("ResearchObservationAppendResponse:"))), "caller must not provide server-owned fields");
assert.match(service, /onConflictDoNothing\(\{ target: researchObservationEventsTable\.eventKey \}\)/, "duplicate observation keys must be idempotent");
assert.match(service, /ResearchObservationConflictError/, "conflicting duplicate content must be rejected");
assert.match(service, /insert\(researchResonanceTable\)/, "derived resonance must persist");
assert.match(service, /where\(ne\(researchObservationEventsTable\.sourceLane/, "resonance comparison must use the opposite lane");
for (const forbidden of [
  "alphaRadar",
  "alertReady",
  "databento",
  "heartbeat",
  "watchdog",
  "marketFreshness",
  "aiIndustryStockPool",
  "ownerLifecycle",
]) {
  assert(!new RegExp(`from .*${forbidden}`, "i").test(route + service), `sidecar must not import ${forbidden}`);
}

const probe = `
import assert from "node:assert/strict";
import {
  deriveResearchResonances,
  normalizeResearchObservationInput,
  hashResearchObservation,
} from "../artifacts/api-server/src/lib/researchSidecar.ts";
const event = (id, lane, ticker, identity, admission, chain) => ({
  id, sourceLane: lane, ticker, tickerIdentityState: identity,
  usTickerAdmission: admission, canonicalIndustryChainKey: chain,
});
const sameLane = deriveResearchResonances([
  event("a", "alex_moonvest", "ODD", "us_watch", "admitted", "unavailable"),
  event("b", "alex_moonvest", "ODD", "us_watch", "admitted", "unavailable"),
]);
assert.deepEqual(sameLane, [], "same-lane observations cannot resonate");
const overseas = deriveResearchResonances([
  event("a", "alex_moonvest", "CHA", "overseas_reference", "not_admitted", "battery_chain"),
  event("b", "serenity", "CHA", "us_watch", "admitted", "battery_chain"),
]);
assert.equal(overseas.length, 1);
assert.equal(overseas[0].resonanceBasis, "industry_chain");
assert.equal(overseas[0].admittedUsTicker, null, "overseas records cannot admit a US ticker");
const ticker = deriveResearchResonances([
  event("a", "alex_moonvest", "ODD", "us_watch", "admitted", "unavailable"),
  event("b", "serenity", "ODD", "us_watch", "admitted", "unavailable"),
]);
assert.equal(ticker.length, 1);
assert.equal(ticker[0].resonanceBasis, "us_ticker");
assert.equal(ticker[0].admittedUsTicker, "ODD");
assert.deepEqual(
  deriveResearchResonances([
    event("a", "alex_moonvest", "ODD", "us_watch", "admitted", "unavailable"),
    event("b", "serenity", "ODD", "us_watch", "unavailable", "unavailable"),
  ]),
  [],
  "unavailable admission evidence cannot resonate",
);
const input = (overrides = {}) => ({
  sourceLane: "serenity",
  source: "Serenity Research",
  sourceReference: "https://example.test/research",
  observedDate: "2026-09-13",
  ticker: "odd",
  tickerIdentity: {
    exchange: "nasdaq",
    lifecycleStatus: "active",
    securityType: "class_a_ordinary_shares",
    identitySourceReference: "https://www.nasdaq.com/market-activity/stocks/odd",
    verificationAccessDate: "2026-09-13",
  },
  viewpoint: "viewpoint",
  thesis: "thesis",
  ...overrides,
});
const admitted = normalizeResearchObservationInput(input());
assert.equal(admitted.ticker, "ODD", "tickers must normalize to uppercase");
assert.equal(admitted.tickerIdentityState, "us_watch");
assert.equal(admitted.usTickerAdmission, "admitted");
assert.equal(admitted.valuationReversalBasis, "unavailable", "unknown optional fields stay explicit");
assert.equal(hashResearchObservation(admitted), hashResearchObservation(admitted), "observation hashes must be deterministic");
assert.equal(
  normalizeResearchObservationInput(input({
    tickerIdentity: {
      exchange: "OTC",
      lifecycleStatus: "active",
      securityType: "common_equity",
      identitySourceReference: "https://example.test/identity",
      verificationAccessDate: "2026-09-13",
    },
  })).tickerIdentityState,
  "overseas_reference",
  "non-admitted exchanges cannot become US watches",
);
assert.equal(
  normalizeResearchObservationInput(input({
    tickerIdentity: {
      exchange: "NASDAQ",
      lifecycleStatus: "active",
      securityType: "common_equity",
      identitySourceReference: "unavailable",
      verificationAccessDate: "2026-09-13",
    },
  })).usTickerAdmission,
  "not_admitted",
  "identity source references are required for US watch admission",
);
console.log("research sidecar derivation passed");
`;
const result = spawnSync(
  "pnpm",
  ["--filter", "@workspace/scripts", "exec", "tsx", "-e", probe],
  { encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgres://localhost/research-sidecar-test" } },
);
assert.equal(result.status, 0, result.stderr || result.stdout);
console.log("research sidecar tests passed: strict listing, independent lanes, resonance boundaries, immutable evidence, and isolation hold.");