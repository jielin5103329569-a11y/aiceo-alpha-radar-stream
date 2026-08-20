/**
 * Unit tests for the alert service (Task #18).
 *
 * Tests service behaviour in isolation — no real DB, no real EventEmitter,
 * no VAPID keys.  All async paths are exercised through controlled stubs.
 *
 * Usage: node scripts/test-alert-service.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "alert-service-test-"));

function transpile(sourcePath, outputName, transform = (s) => s) {
  const source = transform(readFileSync(resolve(sourcePath), "utf8"));
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: false,
    },
  }).outputText;
  writeFileSync(join(outputDirectory, outputName), output);
}

// ---------------------------------------------------------------------------
// Build stub modules the service depends on
// ---------------------------------------------------------------------------

// Stub: @workspace/db  — captures inserts/selects for inspection
function buildDbStub() {
  return `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

const records = [];
const auditRows = [];
const pushSubs = [];
const notifSettings = [];
const userAlertStates = [];

function makeQueryBuilder(table, rows) {
  let _whereFilters = [];
  let _limit = null;
  let _returning = null;
  let _values = null;
  let _onConflict = null;
  let _set = null;

  const builder = {
    where(...args) { _whereFilters.push(args); return builder; },
    limit(n) { _limit = n; return builder; },
    returning(spec) { _returning = spec; return builder; },
    values(v) { _values = v; return builder; },
    onConflictDoNothing(opts) { _onConflict = opts; return builder; },
    set(v) { _set = v; return builder; },
    orderBy() { return builder; },
    then(resolve, reject) {
      try {
        // insert
        if (_values) {
          if (_onConflict) {
            // idempotent: check eventKey uniqueness for alertRecordsTable
            if (table === exports.alertRecordsTable && rows.some(r => r.eventKey === _values.eventKey)) {
              return Promise.resolve([]).then(resolve, reject);
            }
          }
          const row = { id: "uuid-" + (rows.length + 1), ..._values };
          rows.push(row);
          if (_returning) {
            return Promise.resolve([row]).then(resolve, reject);
          }
          return Promise.resolve([row]).then(resolve, reject);
        }
        // update
        if (_set) {
          return Promise.resolve([]).then(resolve, reject);
        }
        // select
        let result = [...rows];
        if (_limit) result = result.slice(0, _limit);
        return Promise.resolve(result).then(resolve, reject);
      } catch(e) { reject(e); }
    }
  };
  return builder;
}

const db = {
  insert(table) {
    let _rows;
    if (table === exports.alertRecordsTable) _rows = records;
    else if (table === exports.alertDeliveryAuditTable) _rows = auditRows;
    else if (table === exports.pushSubscriptionsTable) _rows = pushSubs;
    else if (table === exports.notificationSettingsTable) _rows = notifSettings;
    else _rows = [];
    return makeQueryBuilder(table, _rows);
  },
  select() {
    return {
      from(table) {
        let _rows;
        if (table === exports.alertRecordsTable) _rows = records;
        else if (table === exports.alertDeliveryAuditTable) _rows = auditRows;
        else if (table === exports.pushSubscriptionsTable) _rows = pushSubs;
        else if (table === exports.notificationSettingsTable) _rows = notifSettings;
        else if (table === exports.userAlertStateTable) _rows = userAlertStates;
        else _rows = [];
        return makeQueryBuilder(table, _rows);
      }
    };
  },
  update(table) {
    let _rows;
    if (table === exports.pushSubscriptionsTable) _rows = pushSubs;
    else _rows = [];
    return makeQueryBuilder(table, _rows);
  }
};

exports.db = db;
exports.alertRecordsTable = { _name: "alert_records", eventKey: "eventKey" };
exports.alertDeliveryAuditTable = { _name: "alert_delivery_audit" };
exports.notificationSettingsTable = { _name: "notification_settings" };
exports.pushSubscriptionsTable = { _name: "push_subscriptions" };
exports.userAlertStateTable = { _name: "user_alert_state" };
exports.eq = (col, val) => ({ col, val, type: "eq" });
exports.and = (...args) => ({ type: "and", args });
exports.inArray = (col, vals) => ({ col, vals, type: "inArray" });

// Expose captured rows for assertions
exports._records = records;
exports._auditRows = auditRows;
exports._pushSubs = pushSubs;
exports._notifSettings = notifSettings;
exports._userAlertStates = userAlertStates;
exports._clearAll = () => {
  records.length = 0;
  auditRows.length = 0;
  pushSubs.length = 0;
  notifSettings.length = 0;
  userAlertStates.length = 0;
};
exports._addPushSub = (sub) => { pushSubs.push(sub); };
exports._addNotifSettings = (s) => { notifSettings.push(s); };
exports._addUserAlertState = (s) => { userAlertStates.push(s); };
`;
}

// Stub: logger
const loggerStub = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const log = [];
exports.logger = {
  info(...args) { log.push({ level: "info", args }); },
  warn(...args) { log.push({ level: "warn", args }); },
  error(...args) { log.push({ level: "error", args }); },
};
exports._log = log;
`;

// Stub: marketUniverse — only returns records explicitly marked as trusted.
const marketUniverseStub = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const references = new Map();
let summary = { freshness: "fresh", dataQuality: "good" };
exports.marketUniverse = {
  getSummary() { return summary; },
  getSecurity(symbol) { return references.get(symbol) || null; },
};
exports._setTrustedSecurity = (symbol, reference) => {
  if (reference) references.set(symbol, reference);
  else references.delete(symbol);
};
exports._setReferenceSummary = (next) => { summary = next; };
`;

// Stub: databentoLive — a simple EventEmitter-like bus for testing
const databentoLiveStub = `
"use strict";
const { EventEmitter } = require("node:events");
Object.defineProperty(exports, "__esModule", { value: true });
class MockUniverseService extends EventEmitter {
  getStatus() { return { symbolRadars: [] }; }
  start() {}
  stop() {}
}
exports.databentoLive = new MockUniverseService();
`;

try {
  // Write stubs
  writeFileSync(join(outputDirectory, "db.js"), buildDbStub());
  writeFileSync(join(outputDirectory, "logger.js"), loggerStub);
  writeFileSync(join(outputDirectory, "marketUniverse.js"), marketUniverseStub);
  writeFileSync(join(outputDirectory, "databentoLive.js"), databentoLiveStub);
  writeFileSync(join(outputDirectory, "package.json"), '{"type":"commonjs"}');

  // Transpile alertMonitor.ts (needed by alertService)
  transpile("artifacts/api-server/src/lib/alertMonitor.ts", "alertMonitor.js");

  // Stub: drizzle-orm operators (eq, and, inArray) — re-exported from our db stub
  writeFileSync(
    join(outputDirectory, "drizzle-orm.js"),
    `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eq = (col, val) => ({ col, val, type: "eq" });
exports.and = (...args) => ({ type: "and", args });
exports.inArray = (col, vals) => ({ col, vals, type: "inArray" });
`,
  );

  // Transpile alertService.ts, remapping workspace imports to our stubs
  transpile(
    "artifacts/api-server/src/lib/alertService.ts",
    "alertService.js",
    (source) => source
      .replace(/"@workspace\/db"/g, '"./db"')
      .replace(/from "@workspace\/db"/g, 'from "./db"')
      .replace(/from "\.\/logger"/g, 'from "./logger"')
      .replace(/from "\.\/marketUniverse"/g, 'from "./marketUniverse"')
      .replace(/from "\.\/databentoLive"/g, 'from "./databentoLive"')
      .replace(/from "\.\/alertMonitor"/g, 'from "./alertMonitor"')
      .replace(/"drizzle-orm"/g, '"./drizzle-orm"'),
  );

  const require = createRequire(import.meta.url);
  const {
    AlertService,
    alertService: _defaultService,
    buildAlertSectorLeaderContext,
    buildAlertPushPayload,
    vapidCapability,
  } = require(join(outputDirectory, "alertService.js"));
  const db = require(join(outputDirectory, "db.js"));
  const { databentoLive } = require(join(outputDirectory, "databentoLive.js"));
  const marketUniverse = require(join(outputDirectory, "marketUniverse.js"));

  // ---------------------------------------------------------------------------
  // Helper: build a minimal fully-passing RadarSymbolStatus fixture
  // ---------------------------------------------------------------------------

  function buildPassingSymbolStatus({
    symbol = "NVDA",
    score = 82,
    detectionState = "confirmed",
    confirmationStatus = "confirmed",
  } = {}) {
    return {
      symbol,
      connectionState: "streaming",
      marketFeedState: "streaming",
      lastUpdatedAt: new Date(),
      streams: [
        { schema: "mbp-1", state: "receiving", eventCount: 100, lastEventAt: new Date() },
        { schema: "ohlcv-1s", state: "receiving", eventCount: 80, lastEventAt: new Date() },
      ],
      scanHealth: {
        schedulerState: "scheduled",
        scanMode: "opening",
        scanIntervalMs: 1_000,
        lastScanAt: new Date(),
        lastScanAgeMs: 0,
        nextScanAt: new Date(Date.now() + 1_000),
        scanLagMs: 0,
        lastMarketEventAt: new Date(),
        lastMarketEventAgeMs: 0,
        marketDataState: "fresh",
        marketDataGateReady: true,
        degradation: "ready",
        reason: "Deterministic verified scan-health fixture.",
      },
      alphaRadar: {
        score,
        scoreState: "available",
        dataQuality: "good",
        status: "Breakout Setup",
        confidence: 100,
        generatedAt: new Date(),
        warnings: [],
        diagnostics: { fresh_quotes: 5, fresh_trades: 5, fresh_prices: 5, fresh_volume: 5, valid_window_age: 120_000, scoring_gate_reason: "ready" },
        scan: { lastScannedAt: new Date(), scanIntervalMs: 1_000, scanMode: "opening", triggerReason: "market_event", eventTriggered: true },
        alphaVelocity: { delta30s: 8, delta60s: 12, rate30s: 8, rate60s: 6 },
        changeIndicators: { momentumAcceleration: 10, volumeAcceleration: 9, orderFlowShift: 7, spreadTightening: 5 },
        preBreakoutWatch: true,
        preBreakout: {
          state: detectionState,
          latentScore: detectionState === "latent" ? 100 : null,
          breakoutCriticalScore: detectionState === "breakout_critical" ? 80 : null,
          evidenceCount: 4,
          velocityGateSatisfied: true,
          reasons: [],
          deteriorationReasons: [],
          transitionEvidenceCount: 4,
          transitionReasons: [],
          lastTransitionAt: new Date(),
          lastEvaluatedAt: new Date(),
          dataFresh: true,
          cooldownRemainingMs: null,
          confirmation: {
            status: confirmationStatus,
            evidence: [],
            satisfiedEvidence: ["Fresh price momentum", "Volume acceleration", "Alpha Velocity", "Score strength"],
            missingEvidence: [],
            persistenceScans: 4,
            requiredPersistenceScans: 3,
            evaluatedAt: new Date(),
            reason: "All required evidence satisfied.",
          },
        },
        momentum: { value: 0.12, unit: "%", score: 82, observedAt: new Date(), freshnessMs: 2_000, freshness: "fresh", available: true, scoreEligible: true, referenceValue: 0, referenceLabel: null, source: "live" },
        spread: { value: 0.01, unit: "bps", score: 78, observedAt: new Date(), freshnessMs: 2_000, freshness: "fresh", available: true, scoreEligible: true, referenceValue: null, referenceLabel: null, source: "live" },
        volumeIntensity: { value: 2.5, unit: "x", score: 85, observedAt: new Date(), freshnessMs: 2_000, freshness: "fresh", available: true, scoreEligible: true, referenceValue: null, referenceLabel: null, source: "live" },
        orderFlowPressure: { value: 0.6, unit: "ratio", score: 75, observedAt: new Date(), freshnessMs: 2_000, freshness: "fresh", available: true, scoreEligible: true, referenceValue: null, referenceLabel: null, source: "live" },
        unusualActivity: { value: 1, unit: "", score: 90, observedAt: new Date(), freshnessMs: 2_000, freshness: "fresh", available: true, scoreEligible: true, detected: true, referenceValue: null, referenceLabel: null, source: "live" },
      },
      signalHistory: [],
      market: { latestPrice: 134.56, bidPrice: 134.55, askPrice: 134.57, bidSize: 200, askSize: 100, lastTradeSize: 150, sessionVolume: 5_000_000, lastTradeAt: new Date() },
      liveIngestion: {
        subscription: { dataset: "EQUS.MINI", symbol, symbolType: "raw_symbol", schemas: ["mbp-1", "ohlcv-1s"], acceptedRecordTypes: ["mbp", "ohlcv"] },
        marketSession: { timezone: "America/New_York", phase: "regular", filterApplied: false, detail: "Regular session" },
        recentMarketEvents: [],
        verifiedMarketEventCount: 10,
        currentWindowMarketEventCount: 10,
        lastMarketEventAt: new Date(),
        lastMarketEventReceivedAt: new Date(),
        lastMarketEventAgeMs: 500,
        windowStartedAt: new Date(Date.now() - 60_000),
        lastWindowEntryAt: new Date(Date.now() - 500),
        freshnessCounters: { quotes: 8, trades: 5, prices: 8, volume: 5 },
        enteredScoringWindow: true,
        acceptanceState: "scoring_eligible",
        conditions: { subscriptionVerified: true, realMarketEventReceived: true, enteredScoringWindow: true, quoteFresh: true, tradeFresh: true, priceFresh: true, volumeFresh: true, scoringEligible: true, triggerEvidenceAvailable: true },
        triggerEvidence: { eventTriggered: true, triggerReason: "rapid_midpoint_change", scanAt: new Date(), sourceEventAt: new Date(), sourceEventType: "trade", sourceReceiveAt: new Date(), evidenceCount: 4, satisfiedEvidence: ["Fresh price momentum"], missingEvidence: [] },
        scoringStatus: { scoreState: "available", status: "Breakout Setup", score, freshness: "fresh", dataQuality: "good", gateReason: "ready" },
        reason: "Scoring eligible.",
      },
      error: null,
    };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function leaderMember(
    symbol,
    sectorWeightedScore,
    {
      preBreakoutState = "watch",
      confirmationStatus = "pending",
      marketDataState = "fresh",
      eligibility = "ranked",
    } = {},
  ) {
    return {
      symbol,
      eligibility,
      marketDataState,
      individualAlphaScore: 80,
      sectorWeightedScore,
      preBreakoutState,
      confirmationStatus,
    };
  }

  function sectorLeaderSnapshot(members) {
    return {
      state: "ranked",
      sectors: [{
        sector: "Information Technology",
        eligibility: "ranked",
        dataFresh: true,
        members,
      }],
    };
  }

  // ---------------------------------------------------------------------------
  // Test 1: vapidCapability reports unavailable when env vars absent
  // ---------------------------------------------------------------------------

  // In test environment VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY are not set
  assert.equal(vapidCapability.available, false, "VAPID must be unavailable when env vars are absent");
  assert.ok(typeof vapidCapability.reason === "string", "VAPID unavailable reason must be a string");
  assert.ok(vapidCapability.reason.length > 0, "VAPID unavailable reason must be non-empty");

  // ---------------------------------------------------------------------------
  // Test 2: health snapshot before start
  // ---------------------------------------------------------------------------

  const service = new AlertService();
  const healthBefore = service.getHealth();
  assert.equal(healthBefore.running, false, "service must not be running before start()");
  assert.equal(healthBefore.startedAt, null, "startedAt must be null before start()");
  assert.equal(healthBefore.candidatesEvaluated, 0, "no evaluations before start");
  assert.equal(healthBefore.vapid.available, false, "health must report VAPID unavailable");

  // ---------------------------------------------------------------------------
  // Test 3: start() subscribes to databentoLive status events
  // ---------------------------------------------------------------------------

  service.start();
  assert.equal(service.getHealth().running, true, "service must be running after start()");
  assert.ok(service.getHealth().startedAt instanceof Date, "startedAt must be set after start()");

  // Verify the listener was attached
  const listenerCount = databentoLive.listenerCount("status");
  assert.ok(listenerCount >= 1, "AlertService must attach at least one status listener");

  // ---------------------------------------------------------------------------
  // Test 4: double start() is a no-op
  // ---------------------------------------------------------------------------

  service.start(); // second call
  assert.equal(databentoLive.listenerCount("status"), listenerCount, "double start must not add extra listeners");

  // ---------------------------------------------------------------------------
  // Test 5: status event with passing snapshot → alert record persisted, audit skipped_no_vapid
  // ---------------------------------------------------------------------------

  db._clearAll();

  const passingStatus = {
    symbolRadars: [buildPassingSymbolStatus({ symbol: "NVDA" })],
  };

  databentoLive.emit("status", passingStatus);

  // setImmediate + async pipeline — give it a tick
  await sleep(50);

  assert.equal(db._records.length, 1, "one passing snapshot must produce one alert record");
  assert.equal(db._records[0].symbol, "NVDA", "alert record must carry the correct symbol");
  assert.ok(db._records[0].eventKey.startsWith("alert:NVDA:"), "alert record must have deterministic event key");
  assert.equal(db._records[0].severity, "critical", "confirmed breakout must be critical");
  assert.equal(db._records[0].sector, null, "missing trusted classifications must remain absent");
  assert.equal(db._records[0].industry, null, "missing trusted classifications must remain absent");

  const classifiedPush = buildAlertPushPayload(
    {
      symbol: "NVDA",
      severity: "critical",
      triggerReason: "breakout_confirmed",
      alphaScore: 82,
      eventKey: "alert:NVDA:classification-test",
    },
    "alert-record-classification-test",
    { sector: "Information Technology", industry: "Semiconductors" },
    null,
  );
  assert.equal(
    classifiedPush.body,
    "breakout confirmed · Alpha 82 · Information Technology / Semiconductors",
    "push body must append only the trusted sector and industry names",
  );
  assert.deepEqual(
    classifiedPush.data,
    {
      symbol: "NVDA",
      severity: "critical",
      triggerReason: "breakout_confirmed",
      alertRecordId: "alert-record-classification-test",
      eventKey: "alert:NVDA:classification-test",
      sector: "Information Technology",
      industry: "Semiconductors",
      sectorLeaderContext: null,
    },
    "push payload must preserve existing data while adding optional classification fields",
  );

  // With no VAPID keys and no push subscriptions, audit must record skipped_no_subscriptions or skipped_no_vapid
  const validOutcomes = ["skipped_no_subscriptions", "skipped_no_vapid"];
  // Audit rows may be 0 if no subscriptions found first
  // (no subs → skipped_no_subscriptions recorded, no per-user loop runs)
  assert.ok(
    db._auditRows.length === 0 || db._auditRows.every(r => validOutcomes.includes(r.outcome)),
    `delivery audit outcomes must be valid skipped outcomes, got: ${db._auditRows.map(r => r.outcome).join(", ")}`,
  );

  const health1 = service.getHealth();
  assert.equal(health1.newCandidatesProduced, 1, "health must count new candidate");
  assert.equal(health1.dbInsertsSucceeded, 1, "health must count successful DB insert");

  // ---------------------------------------------------------------------------
  // Test 6: sector leaders remain descriptive, omit invalid members, and never force a breakout label
  // ---------------------------------------------------------------------------

  const leaderContext = buildAlertSectorLeaderContext(
    {
      sectorPriority: sectorLeaderSnapshot([
        leaderMember("SECTORTEST", 99, { preBreakoutState: "confirmed", confirmationStatus: "confirmed" }),
        leaderMember("MU", 94, { preBreakoutState: "breakout_critical" }),
        leaderMember("AMD", 91),
        leaderMember("AVGO", 89),
        leaderMember("NVDA", 87),
        leaderMember("INTC", 86),
        leaderMember("STALE", 100, { marketDataState: "stale" }),
        leaderMember("INELIGIBLE", 98, { eligibility: "ineligible" }),
      ]),
    },
    { sector: "Information Technology", industry: "Semiconductors" },
  );
  assert.deepEqual(
    leaderContext,
    {
      sector: "Information Technology",
      leaders: [
        { rank: 1, symbol: "SECTORTEST", grade: "confirmed" },
        { rank: 2, symbol: "MU", grade: "critical" },
        { rank: 3, symbol: "AMD", grade: "watch" },
        { rank: 4, symbol: "AVGO", grade: "watch" },
        { rank: 5, symbol: "NVDA", grade: "watch" },
      ],
      strongestBreakoutSymbol: "SECTORTEST",
    },
    "leader context must use at most five fresh ranked members in deterministic score order",
  );

  for (const memberCount of [1, 2, 3, 4]) {
    const partialSectorContext = buildAlertSectorLeaderContext(
      {
        sectorPriority: sectorLeaderSnapshot(
          Array.from({ length: memberCount }, (_, index) => leaderMember(
            `PARTIAL${index + 1}`,
            100 - index,
            index === 0
              ? { preBreakoutState: "confirmed", confirmationStatus: "confirmed" }
              : { preBreakoutState: "watch" },
          )),
        ),
      },
      { sector: "Information Technology", industry: "Semiconductors" },
    );
    assert.equal(
      partialSectorContext?.leaders.length,
      memberCount,
      `${memberCount} fresh ranked members must be shown without padding or a five-member gate`,
    );
    assert.equal(
      partialSectorContext?.strongestBreakoutSymbol,
      "PARTIAL1",
      `a fully confirmed #1 must retain strongest-breakout status with only ${memberCount} member(s)`,
    );
  }

  const singleUnconfirmedContext = buildAlertSectorLeaderContext(
    {
      sectorPriority: sectorLeaderSnapshot([
        leaderMember("SINGLEPENDING", 99, { preBreakoutState: "breakout_critical", confirmationStatus: "pending" }),
      ]),
    },
    { sector: "Information Technology", industry: "Semiconductors" },
  );
  assert.deepEqual(
    singleUnconfirmedContext,
    {
      sector: "Information Technology",
      leaders: [{ rank: 1, symbol: "SINGLEPENDING", grade: "critical" }],
      strongestBreakoutSymbol: null,
    },
    "a single unconfirmed stock must remain visible but must not be labeled as strongest breakout",
  );

  const noConfirmedBreakout = buildAlertSectorLeaderContext(
    {
      sectorPriority: sectorLeaderSnapshot([
        leaderMember("MU", 94, { preBreakoutState: "latent" }),
        leaderMember("AMD", 91),
        leaderMember("AVGO", 89),
      ]),
    },
    { sector: "Information Technology", industry: "Semiconductors" },
  );
  assert.equal(noConfirmedBreakout?.leaders.length, 3, "fewer than five valid members must not be padded");
  assert.equal(
    noConfirmedBreakout?.strongestBreakoutSymbol,
    null,
    "a non-confirmed #1 must explicitly withhold the strongest-breakout designation",
  );
  assert.equal(
    buildAlertSectorLeaderContext(
      { sectorPriority: sectorLeaderSnapshot([leaderMember("MU", 94)]) },
      null,
    ),
    null,
    "missing trusted classification must withhold leader context rather than infer a sector",
  );

  const leaderPush = buildAlertPushPayload(
    {
      symbol: "SECTORTEST",
      severity: "critical",
      triggerReason: "breakout_confirmed",
      alphaScore: 99,
      eventKey: "alert:SECTORTEST:leader-test",
    },
    "alert-record-leader-test",
    { sector: "Information Technology", industry: "Semiconductors" },
    leaderContext,
  );
  assert.match(
    leaderPush.body,
    /#1 SECTORTEST 🔥 最强爆发; #2 MU 🟠 爆发临界; #3 AMD 观察/,
    "push body must provide the same concise ranking and only label #1 as strongest breakout",
  );
  assert.equal(
    leaderPush.data.sectorLeaderContext?.strongestBreakoutSymbol,
    "SECTORTEST",
    "push data must carry the immutable sector leader context for the service worker",
  );

  // ---------------------------------------------------------------------------
  // Test 7: a single confirmed sector leader persists and enters the existing push pipeline
  // ---------------------------------------------------------------------------

  db._clearAll();
  db._addPushSub({
    id: "single-breakout-subscription",
    userId: "user_single_breakout",
    active: true,
    consecutiveFailures: 0,
    subscriptionPayload: {
      provider: "web_push",
      endpoint: "https://example.com/single-breakout",
      p256dh: "key",
      auth: "auth",
    },
  });
  db._addNotifSettings({
    id: "single-breakout-settings",
    userId: "user_single_breakout",
    globalOptOut: false,
    channelPreferences: {
      webPush: true,
      inApp: true,
      minimumSeverity: "critical",
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: null,
    },
  });
  marketUniverse._setTrustedSecurity("SINGLEBREAKOUT", {
    eligibility: "eligible",
    sector: "Information Technology",
    industry: "Semiconductors",
    classificationSource: "Databento security master",
  });
  databentoLive.emit("status", {
    symbolRadars: [buildPassingSymbolStatus({ symbol: "SINGLEBREAKOUT" })],
    sectorPriority: sectorLeaderSnapshot([
      leaderMember("SINGLEBREAKOUT", 99, { preBreakoutState: "confirmed", confirmationStatus: "confirmed" }),
    ]),
  });
  await sleep(50);
  assert.equal(db._records.length, 1, "one fully confirmed candidate must persist without a five-member requirement");
  assert.equal(db._records[0].symbol, "SINGLEBREAKOUT");
  assert.equal(db._records[0].severity, "critical", "single confirmed breakout must retain existing critical severity");
  assert.equal(db._records[0].sector, "Information Technology");
  assert.equal(db._records[0].industry, "Semiconductors");
  assert.deepEqual(db._records[0].sectorLeaderContext, {
    sector: "Information Technology",
    leaders: [{ rank: 1, symbol: "SINGLEBREAKOUT", grade: "confirmed" }],
    strongestBreakoutSymbol: "SINGLEBREAKOUT",
  });
  const singleBreakoutPush = buildAlertPushPayload(
    {
      symbol: "SINGLEBREAKOUT",
      severity: "critical",
      triggerReason: "breakout_confirmed",
      alphaScore: 82,
      eventKey: db._records[0].eventKey,
    },
    db._records[0].id,
    { sector: "Information Technology", industry: "Semiconductors" },
    db._records[0].sectorLeaderContext,
  );
  assert.match(
    singleBreakoutPush.body,
    /#1 SINGLEBREAKOUT 🔥 最强爆发/,
    "a single confirmed leader must retain its strongest-breakout label in the push body",
  );
  assert.doesNotMatch(
    singleBreakoutPush.body,
    /最强爆发：暂无确认/,
    "a confirmed single leader must not be downgraded to the no-confirmation message",
  );
  assert.equal(
    singleBreakoutPush.data.sectorLeaderContext?.leaders.length,
    1,
    "the service-worker-compatible push payload must preserve the single leader",
  );
  const singleBreakoutAudit = db._auditRows.find((row) => (
    row.userId === "user_single_breakout"
    && row.alertRecordId === db._records[0].id
    && row.outcome === "skipped_no_vapid"
  ));
  assert.ok(
    singleBreakoutAudit,
    "the single confirmed breakout must enter the existing delivery pipeline; no VAPID only skips external delivery",
  );
  marketUniverse._setTrustedSecurity("SINGLEBREAKOUT", null);

  db._clearAll();
  marketUniverse._setTrustedSecurity("STALECLASSIFICATION", {
    eligibility: "eligible",
    sector: "Information Technology",
    industry: "Semiconductors",
    classificationSource: "Databento security master",
  });
  marketUniverse._setReferenceSummary({ freshness: "stale", dataQuality: "unavailable" });
  databentoLive.emit("status", {
    symbolRadars: [buildPassingSymbolStatus({ symbol: "STALECLASSIFICATION" })],
  });
  await sleep(50);
  assert.equal(db._records.length, 1, "untrusted reference state must not block a valid alert");
  assert.equal(db._records[0].sector, null, "stale classifications must not be attached to an alert");
  assert.equal(db._records[0].industry, null, "stale classifications must not be attached to an alert");
  marketUniverse._setReferenceSummary({ freshness: "fresh", dataQuality: "good" });
  marketUniverse._setTrustedSecurity("STALECLASSIFICATION", null);

  db._clearAll();
  marketUniverse._setTrustedSecurity("INELIGIBLECLASSIFICATION", {
    eligibility: "ineligible",
    sector: "Information Technology",
    industry: "Semiconductors",
    classificationSource: "Databento security master",
  });
  databentoLive.emit("status", {
    symbolRadars: [buildPassingSymbolStatus({ symbol: "INELIGIBLECLASSIFICATION" })],
  });
  await sleep(50);
  assert.equal(db._records.length, 1, "ineligible classification must not block a valid alert");
  assert.equal(db._records[0].sector, null, "ineligible classifications must not be attached to an alert");
  assert.equal(db._records[0].industry, null, "ineligible classifications must not be attached to an alert");
  marketUniverse._setTrustedSecurity("INELIGIBLECLASSIFICATION", null);

  // ---------------------------------------------------------------------------
  // Test 7: DB-level duplicate event key → idempotent (no second insert, counted as duplicate)
  //   Uses a fresh service so the monitor has no prior history, forcing the DB
  //   onConflictDoNothing path to be exercised.
  // ---------------------------------------------------------------------------

  {
    const service6 = new AlertService();
    db._clearAll();
    // Pre-seed a record with the exact transition identity the same status
    // object will replay. Score is intentionally absent from this identity.
    const transitionAt = passingStatus.symbolRadars[0].alphaRadar.preBreakout.lastTransitionAt;
    const expectedEventKey = `alert:NVDA:${transitionAt.toISOString()}:confirmed:confirmed`;
    db._records.push({ id: "existing-uuid", eventKey: expectedEventKey, symbol: "NVDA" });

    service6.start();
    databentoLive.emit("status", passingStatus);
    await sleep(50);
    service6.stop();

    // Stub returns [] (empty) for onConflictDoNothing when eventKey already exists
    // Service should see the empty result and increment dbInsertsDuplicate
    assert.equal(db._records.length, 1, "duplicate event key must not insert a second record");
    const health6 = service6.getHealth();
    assert.equal(health6.dbInsertsDuplicate, 1, "health must count the DB-level duplicate as deduplicated");
    assert.equal(health6.dbInsertsSucceeded, 0, "duplicate must not count as a successful new insert");
  }

  // ---------------------------------------------------------------------------
  // Test 8: stale snapshot → no candidate, no insert
  // ---------------------------------------------------------------------------

  db._clearAll();
  const staleStatus = {
    symbolRadars: [buildPassingSymbolStatus({ symbol: "NVDA", score: 60 })],
  };
  // Make it stale
  staleStatus.symbolRadars[0].marketFeedState = "stale";
  staleStatus.symbolRadars[0].streams = [
    { schema: "mbp-1", state: "waiting", eventCount: 0, lastEventAt: null },
    { schema: "ohlcv-1s", state: "waiting", eventCount: 0, lastEventAt: null },
  ];

  databentoLive.emit("status", staleStatus);
  await sleep(50);

  assert.equal(db._records.length, 0, "stale snapshot must not insert any alert record");

  // ---------------------------------------------------------------------------
  // Test 9: no push subscriptions → skipped_no_subscriptions audit entry
  // ---------------------------------------------------------------------------

  db._clearAll();
  // No push subs — delivery must audit skipped_no_subscriptions

  databentoLive.emit("status", { symbolRadars: [buildPassingSymbolStatus({ symbol: "MU" })] });
  await sleep(50);

  assert.equal(db._records.length, 1, "passing MU snapshot must persist record");
  // When no subscriptions exist, audit records skipped_no_subscriptions
  const muAudit = db._auditRows.find(r => r.outcome === "skipped_no_subscriptions");
  assert.ok(muAudit, "no subscriptions must produce skipped_no_subscriptions audit entry");

  // ---------------------------------------------------------------------------
  // Test 10: global opt-out → skipped_opt_out audit entry
  // ---------------------------------------------------------------------------

  db._clearAll();
  db._addPushSub({
    id: "sub-1",
    userId: "user_clerk_abc",
    active: true,
    consecutiveFailures: 0,
    subscriptionPayload: { provider: "web_push", endpoint: "https://example.com/push", p256dh: "key", auth: "auth" },
  });
  db._addNotifSettings({
    id: "ns-1",
    userId: "user_clerk_abc",
    globalOptOut: true,
    channelPreferences: { webPush: true, inApp: true, minimumSeverity: "watch", quietHoursStart: null, quietHoursEnd: null, timezone: null },
  });

  databentoLive.emit("status", { symbolRadars: [buildPassingSymbolStatus({ symbol: "AMD" })] });
  await sleep(50);

  assert.equal(db._records.length, 1, "global opt-out does not prevent record insert");
  const optOutAudit = db._auditRows.find(r => r.outcome === "skipped_opt_out");
  assert.ok(optOutAudit, "global opt-out user must produce skipped_opt_out audit entry");
  assert.equal(optOutAudit.userId, "user_clerk_abc", "opt-out audit must carry Clerk user ID (text, not UUID)");

  // ---------------------------------------------------------------------------
  // Test 11: severity threshold → skipped_severity_threshold audit entry
  // ---------------------------------------------------------------------------

  db._clearAll();
  db._addPushSub({
    id: "sub-2",
    userId: "user_clerk_def",
    active: true,
    consecutiveFailures: 0,
    subscriptionPayload: { provider: "web_push", endpoint: "https://example.com/push2", p256dh: "key2", auth: "auth2" },
  });
  db._addNotifSettings({
    id: "ns-2",
    userId: "user_clerk_def",
    globalOptOut: false,
    channelPreferences: {
      webPush: true,
      inApp: true,
      minimumSeverity: "critical", // only critical alerts
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: null,
    },
  });

  // Emit a "watch"-severity snapshot (latent/pending)
  databentoLive.emit("status", {
    symbolRadars: [buildPassingSymbolStatus({ symbol: "VRT", detectionState: "latent", confirmationStatus: "pending", score: 72 })],
  });
  await sleep(50);

  assert.equal(db._records.length, 1, "severity threshold does not prevent record insert");
  const thresholdAudit = db._auditRows.find(r => r.outcome === "skipped_severity_threshold");
  assert.ok(thresholdAudit, "below-threshold severity must produce skipped_severity_threshold audit entry");

  // ---------------------------------------------------------------------------
  // Test 12: per-symbol opt-out → skipped_opt_out
  // ---------------------------------------------------------------------------

  db._clearAll();
  db._addPushSub({
    id: "sub-3",
    userId: "user_clerk_ghi",
    active: true,
    consecutiveFailures: 0,
    subscriptionPayload: { provider: "web_push", endpoint: "https://example.com/push3", p256dh: "key3", auth: "auth3" },
  });
  // No global opt-out
  db._addNotifSettings({
    id: "ns-3",
    userId: "user_clerk_ghi",
    globalOptOut: false,
    channelPreferences: { webPush: true, inApp: true, minimumSeverity: "watch", quietHoursStart: null, quietHoursEnd: null, timezone: null },
  });
  // Per-symbol opt-out for CRDO
  db._addUserAlertState({
    id: "uas-1",
    userId: "user_clerk_ghi",
    symbol: "CRDO",
    optedOut: true,
    snoozed: false,
    snoozedUntil: null,
  });

  databentoLive.emit("status", { symbolRadars: [buildPassingSymbolStatus({ symbol: "CRDO" })] });
  await sleep(50);

  assert.equal(db._records.length, 1, "per-symbol opt-out does not prevent record insert");
  const symbolOptOutAudit = db._auditRows.find(r => r.outcome === "skipped_opt_out");
  assert.ok(symbolOptOutAudit, "per-symbol opt-out must produce skipped_opt_out audit entry");

  // ---------------------------------------------------------------------------
  // Test 13: VAPID unavailable → skipped_no_vapid per user (when subs exist, opts pass)
  // ---------------------------------------------------------------------------

  db._clearAll();
  db._addPushSub({
    id: "sub-4",
    userId: "user_clerk_jkl",
    active: true,
    consecutiveFailures: 0,
    subscriptionPayload: { provider: "web_push", endpoint: "https://example.com/push4", p256dh: "key4", auth: "auth4" },
  });
  // Permissive settings — everything allowed
  db._addNotifSettings({
    id: "ns-4",
    userId: "user_clerk_jkl",
    globalOptOut: false,
    channelPreferences: { webPush: true, inApp: true, minimumSeverity: "info", quietHoursStart: null, quietHoursEnd: null, timezone: null },
  });

  // Use a symbol not yet seen by the running service (NVDA was used in test 5)
  databentoLive.emit("status", { symbolRadars: [buildPassingSymbolStatus({ symbol: "VAPIDTEST" })] });
  await sleep(50);

  assert.equal(db._records.length, 1, "VAPID-unavailable scenario must still insert record");
  const vapidAudit = db._auditRows.find(r => r.outcome === "skipped_no_vapid");
  assert.ok(vapidAudit, "no VAPID keys must produce skipped_no_vapid audit entry when user passes all other checks");
  assert.equal(vapidAudit.channel, "web_push", "VAPID audit must record web_push channel");

  // ---------------------------------------------------------------------------
  // Test 14: stop() removes listener
  // ---------------------------------------------------------------------------

  const listenersBefore = databentoLive.listenerCount("status");
  service.stop();
  assert.equal(service.getHealth().running, false, "service must not be running after stop()");
  assert.ok(service.getHealth().stoppedAt instanceof Date, "stoppedAt must be set after stop()");
  assert.equal(
    databentoLive.listenerCount("status"),
    listenersBefore - 1,
    "stop() must remove the status listener",
  );

  // No more events should be processed after stop
  db._clearAll();
  databentoLive.emit("status", { symbolRadars: [buildPassingSymbolStatus({ symbol: "NVDA" })] });
  await sleep(50);
  assert.equal(db._records.length, 0, "events after stop() must not produce records");

  // ---------------------------------------------------------------------------
  // Test 15: double stop() is a no-op
  // ---------------------------------------------------------------------------

  const listenersAfterStop = databentoLive.listenerCount("status");
  service.stop();
  assert.equal(databentoLive.listenerCount("status"), listenersAfterStop, "double stop must not remove extra listeners");

  // ---------------------------------------------------------------------------
  // Test 16: restart — start() after stop() re-subscribes
  // ---------------------------------------------------------------------------

  db._clearAll();
  service.start();
  assert.equal(service.getHealth().running, true, "service must be running after restart");
  assert.equal(service.getHealth().candidatesEvaluated, 0, "counters must reset on restart");
  assert.equal(service.getHealth().dbInsertsSucceeded, 0, "insert counter must reset on restart");

  databentoLive.emit("status", { symbolRadars: [buildPassingSymbolStatus({ symbol: "NVDA" })] });
  await sleep(50);
  assert.equal(db._records.length, 1, "restart must resume processing status events");

  service.stop();

  // ---------------------------------------------------------------------------
  // Test 17: multiple symbols in one status event — each processed independently
  // ---------------------------------------------------------------------------

  db._clearAll();
  service.start();

  databentoLive.emit("status", {
    symbolRadars: [
      buildPassingSymbolStatus({ symbol: "NVDA", score: 82 }),
      buildPassingSymbolStatus({ symbol: "MU", score: 78 }),
      buildPassingSymbolStatus({ symbol: "AMD", score: 71 }),
    ],
  });
  await sleep(100);

  assert.equal(db._records.length, 3, "three passing symbols must produce three alert records");
  const symbols = db._records.map(r => r.symbol).sort();
  assert.deepEqual(symbols, ["AMD", "MU", "NVDA"], "all three symbols must be persisted");

  service.stop();

  // ---------------------------------------------------------------------------
  // Test 18: Clerk user ID stored as text (not UUID format) in audit
  // ---------------------------------------------------------------------------

  db._clearAll();
  db._addPushSub({
    id: "sub-5",
    userId: "user_2NvxClerkFormatId",  // Clerk format: user_XXXX
    active: true,
    consecutiveFailures: 0,
    subscriptionPayload: { provider: "web_push", endpoint: "https://example.com/push5", p256dh: "k", auth: "a" },
  });
  db._addNotifSettings({
    id: "ns-5",
    userId: "user_2NvxClerkFormatId",
    globalOptOut: true,  // opt out to get audit without VAPID
    channelPreferences: { webPush: true, inApp: true, minimumSeverity: "info", quietHoursStart: null, quietHoursEnd: null, timezone: null },
  });

  service.start();
  databentoLive.emit("status", { symbolRadars: [buildPassingSymbolStatus({ symbol: "NVDA" })] });
  await sleep(50);
  service.stop();

  const clerkAudit = db._auditRows.find(r => r.userId === "user_2NvxClerkFormatId");
  assert.ok(clerkAudit, "audit row must be findable by Clerk user ID text");
  // Confirm the userId is stored as a plain string, not parsed as UUID
  assert.equal(typeof clerkAudit.userId, "string", "userId in audit must be a string (not UUID)");
  assert.ok(
    clerkAudit.userId.startsWith("user_"),
    "Clerk-format userId must be preserved verbatim in audit row",
  );

  // ---------------------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------------------

  console.log("Alert service tests passed: VAPID unavailable → skipped_no_vapid, no delivery without VAPID, disconnect/stale suppression, opt-out/severity/per-symbol blocking, duplicate idempotency, multi-symbol independence, Clerk user ID text storage, start/stop lifecycle, restart.");

} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
