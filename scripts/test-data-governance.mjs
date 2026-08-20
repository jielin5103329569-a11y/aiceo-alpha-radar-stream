import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "data-governance-test-"));
const outputPath = join(outputDirectory, "dataGovernance.cjs");

try {
  const source = readFileSync(resolve("artifacts/api-server/src/lib/dataGovernance.ts"), "utf8");
  writeFileSync(outputPath, typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);
  const { buildDataGovernanceSnapshot } = createRequire(import.meta.url)(outputPath);
  const now = new Date("2026-08-20T14:30:00.000Z");
  const metric = { scoreEligible: true, source: "Databento EQUS.MINI live" };
  const alphaRadar = {
    scoreState: "available",
    dataQuality: "good",
    generatedAt: now,
    momentum: metric,
    volumeIntensity: metric,
    orderFlowPressure: metric,
    spread: metric,
    preBreakout: {
      dataFresh: true,
      state: "latent",
      lastEvaluatedAt: now,
      confirmation: { satisfiedEvidence: ["Price momentum"], reason: "Fresh direct evidence." },
    },
    postBreakout: {
      active: false,
      dataFresh: true,
      state: "unavailable",
      supportReasons: [],
      deteriorationReasons: [],
      reason: "No observed post-breakout lifecycle is active.",
    },
    counterEvidence: { blocksHighGradeUpgrade: false },
    dataConfidence: { state: "high" },
  };
  const input = {
    now,
    connectionState: "streaming",
    marketFeedState: "streaming",
    latestMarketEventAt: now,
    subscriptionVerified: true,
    realMarketEventReceived: true,
    enteredScoringWindow: true,
    marketDataGateReady: true,
    reference: { state: "unavailable", source: null, observedAt: null, reason: "Reference is classification-only." },
    alphaRadar,
  };
  const ready = buildDataGovernanceSnapshot(input);
  assert.deepEqual(ready.layers.map((layer) => layer.state), ["available", "available", "available", "available", "withheld"]);
  assert.equal(ready.decision.eligibleForProductionPromotion, false, "governance is read-only and can never authorize production promotion");
  assert.equal(ready.stages[0].productionState, "latent");
  assert.equal(ready.auditHash, buildDataGovernanceSnapshot(input).auditHash, "same frozen input must have a stable audit hash");

  const stale = buildDataGovernanceSnapshot({
    ...input,
    marketFeedState: "stale",
    marketDataGateReady: false,
    alphaRadar: { ...alphaRadar, scoreState: "stale", dataQuality: "stale", preBreakout: { ...alphaRadar.preBreakout, dataFresh: false } },
  });
  assert.equal(stale.layers[0].state, "unavailable");
  assert.equal(stale.layers[1].state, "unavailable");
  assert.equal(stale.layers[4].state, "withheld");
  assert.equal(stale.decision.eligibleForProductionPromotion, false);

  const blocked = buildDataGovernanceSnapshot({
    ...input,
    alphaRadar: { ...alphaRadar, counterEvidence: { blocksHighGradeUpgrade: true } },
  });
  assert.equal(blocked.decision.state, "withheld", "counter-evidence must withhold governance promotion without altering the underlying score");
  console.log("Data governance tests passed: ordered layers, stale propagation, audit hashing, and counter-evidence withholding.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}