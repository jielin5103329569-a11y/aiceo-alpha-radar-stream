/**
 * Regression coverage for dashboard status selection during an SSE outage.
 *
 * The hook stores only newer server-generated revisions within an epoch. A
 * REST response can safely establish a new epoch after a server restart,
 * while delayed messages from the retired epoch stay rejected. This test
 * verifies that unchanged/null market timestamps do not block those updates
 * and that the unavailable indicator requires both paths to be unavailable.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "radar-stream-recovery-test-"));

try {
  const source = readFileSync(
    resolve("artifacts/alpha-radar-stream/src/hooks/use-radar-stream.ts"),
    "utf8",
  )
    .replace(/^import .*;\n/gm, "");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  writeFileSync(join(outputDirectory, "use-radar-stream.js"), output);

  const require = createRequire(import.meta.url);
  const {
    isBackendUnavailable,
    shouldPollRestStatus,
    selectLatestRadarStatus,
  } = require(join(outputDirectory, "use-radar-stream.js"));
  const olderSnapshot = {
    symbol: "NVDA",
    statusEpoch: "server-a",
    statusRevision: 42,
    lastUpdatedAt: null,
    connectionState: "streaming",
  };
  const newerSnapshot = {
    symbol: "NVDA",
    statusEpoch: "server-a",
    statusRevision: 43,
    lastUpdatedAt: null,
    connectionState: "error",
  };

  let selection = selectLatestRadarStatus(null, olderSnapshot, "sse", new Set());
  selection = selectLatestRadarStatus(selection.status, newerSnapshot, "rest", selection.retiredEpochs);
  assert.equal(
    selection.status,
    newerSnapshot,
    "a newer REST recovery snapshot must replace an older SSE snapshot even without a market event",
  );

  selection = selectLatestRadarStatus(null, newerSnapshot, "sse", new Set());
  selection = selectLatestRadarStatus(selection.status, olderSnapshot, "rest", selection.retiredEpochs);
  assert.equal(
    selection.status,
    newerSnapshot,
    "a delayed REST response must not replace a newer SSE connection/error snapshot",
  );

  selection = selectLatestRadarStatus(null, newerSnapshot, "sse", new Set());
  selection = selectLatestRadarStatus(selection.status, {
    symbol: "NVDA",
    statusEpoch: "server-a",
    statusRevision: 43,
    lastUpdatedAt: "2026-08-21T08:00:02.000Z",
    changedByDelayedDuplicate: true,
  }, "sse", selection.retiredEpochs);
  assert.equal(
    selection.status,
    newerSnapshot,
    "equal revision duplicates must preserve the first verified snapshot",
  );
  selection = selectLatestRadarStatus(
    selection.status,
    { symbol: "NVDA", statusEpoch: "server-b", statusRevision: 1, lastUpdatedAt: null, connectionState: "connected" },
    "rest",
    selection.retiredEpochs,
  );
  assert.equal(
    selection.status?.statusEpoch,
    "server-b",
    "a current REST response from a restarted server must replace a higher old-epoch revision",
  );
  selection = selectLatestRadarStatus(selection.status, newerSnapshot, "sse", selection.retiredEpochs);
  assert.equal(
    selection.status?.statusEpoch,
    "server-b",
    "a delayed old-epoch SSE response must not replace recovered REST state",
  );
  let needsRestEpochConfirmation = true;
  assert.equal(
    shouldPollRestStatus("connected", needsRestEpochConfirmation),
    true,
    "an SSE reconnect must keep REST polling until the new server epoch is confirmed",
  );
  const rejectedNewEpochSse = selectLatestRadarStatus(
    newerSnapshot,
    { symbol: "NVDA", statusEpoch: "server-b", statusRevision: 1, lastUpdatedAt: null, connectionState: "connected" },
    "sse",
    new Set(),
  );
  assert.equal(
    rejectedNewEpochSse.status,
    newerSnapshot,
    "a new-epoch SSE event must not switch epochs before REST confirmation",
  );
  const restRecoveredEpoch = selectLatestRadarStatus(
    rejectedNewEpochSse.status,
    { symbol: "NVDA", statusEpoch: "server-b", statusRevision: 1, lastUpdatedAt: null, connectionState: "connected" },
    "rest",
    rejectedNewEpochSse.retiredEpochs,
  );
  assert.equal(
    restRecoveredEpoch.status?.statusEpoch,
    "server-b",
    "REST polling after the SSE reconnect must adopt the restarted server epoch",
  );
  needsRestEpochConfirmation = false;
  assert.equal(
    shouldPollRestStatus("connected", needsRestEpochConfirmation),
    false,
    "REST polling may stop only after the current epoch is confirmed",
  );
  assert.equal(
    selectLatestRadarStatus(newerSnapshot, { symbol: "NVDA", lastUpdatedAt: "invalid" }, "sse", new Set()).status,
    newerSnapshot,
    "an invalid revision must not replace a verified snapshot",
  );
  assert.equal(
    isBackendUnavailable(true, "reconnecting", true),
    false,
    "a working REST fallback must suppress the reconnecting unavailable banner",
  );
  assert.equal(
    isBackendUnavailable(true, "reconnecting", false),
    true,
    "the unavailable banner requires both SSE and REST to be unavailable",
  );

  console.log("Radar stream recovery tests passed: monotonic cross-transport status selection and dual-path availability.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}