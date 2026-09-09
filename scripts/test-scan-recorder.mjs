import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "scan-recorder-test-"));

try {
  writeFileSync(
    join(outputDirectory, "logger.js"),
    '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.logger = { warn() {} };',
  );
  const source = readFileSync("artifacts/api-server/src/lib/scanRecorder.ts", "utf8");
  writeFileSync(join(outputDirectory, "scanRecorder.js"), typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);
  const { ScanRecorder } = createRequire(import.meta.url)(join(outputDirectory, "scanRecorder.js"));
  const logDirectory = join(outputDirectory, "logs");
  const recorder = new ScanRecorder(logDirectory);
  const settledAt = new Date("2026-09-10T00:30:00.000Z");
  const symbols = ["NVDA", "MU", "VRT", "CRDO", "AMD"].map((symbol) => ({
    symbol,
    scanId: "scan-after-close",
    marketFeedState: "stale",
    marketWindowSettlement: {
      scanId: "scan-after-close",
      settledAt,
      quote: false,
      trade: false,
      volume: false,
      heartbeat: true,
      complete: false,
      missingSegments: ["quote", "trade", "volume"],
    },
  }));
  const snapshot = {
    ...symbols[0],
    symbolRadars: symbols,
    opportunityCenter: {
      opportunities: symbols.map(({ symbol }) => ({ symbol, alertReady: false })),
    },
    catalystRadar: {
      sourceStatuses: [{
        category: "sec_filing",
        readiness: "ready",
      }],
      events: [{
        formType: "8-K",
        filedAt: new Date("2026-09-03T12:03:56.000Z"),
        freshness: "delayed",
        dataQuality: "good",
        lagged: true,
      }],
    },
  };

  recorder.record(snapshot, settledAt);
  recorder.record(snapshot, settledAt);
  await recorder.flush();

  const path = join(logDirectory, "alpha-radar-scans-2026-09-09.jsonl");
  const lines = readFileSync(path, "utf8").trim().split("\n");
  assert.equal(lines.length, 1, "one shared scanId must produce exactly one append-only record");
  const record = JSON.parse(lines[0]);
  assert.equal(record.scanId, "scan-after-close");
  assert.equal(record.marketFeedState, "stale");
  assert.equal(record.windowFresh, false);
  assert.equal(record.complete, false);
  assert.deepEqual(record.missingSegments, ["quote", "trade", "volume"]);
  assert.equal(record.alertState, "ALERT GATED");
  assert.equal(record.catalystSourceState, "ready");
  assert.equal(record.timely8K, false);
  assert.deepEqual(record.latestSecFiling, {
    form: "8-K",
    filedAt: "2026-09-03T12:03:56.000Z",
  });
  assert.equal(record.symbols.length, 5);
  console.log("Append-only daily scan recorder tests passed.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}