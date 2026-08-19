import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const sourcePath = resolve("artifacts/api-server/src/lib/marketFeed.ts");
const outputDirectory = mkdtempSync(join(tmpdir(), "market-feed-test-"));
const outputPath = join(outputDirectory, "marketFeed.cjs");

try {
  const source = readFileSync(sourcePath, "utf8");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  writeFileSync(outputPath, output);

  const require = createRequire(import.meta.url);
  const {
    marketFeedStateFor,
    marketEventIsFresh,
    shouldResetAnalysisWindow,
    MARKET_FEED_STALE_AFTER_MS,
  } = require(outputPath);
  const now = new Date("2026-08-19T09:30:00.000Z");

  assert.equal(
    marketFeedStateFor("streaming", new Date(now.getTime() - MARKET_FEED_STALE_AFTER_MS), now),
    "streaming",
    "a market event at the freshness boundary remains streaming",
  );
  assert.equal(
    marketFeedStateFor("streaming", new Date(now.getTime() - MARKET_FEED_STALE_AFTER_MS - 1), now),
    "stale",
    "a late market event must not remain streaming",
  );
  assert.equal(
    marketFeedStateFor("connected", null, now),
    "stale",
    "a healthy transport without a market event is stale, not streaming",
  );
  assert.equal(
    marketFeedStateFor("streaming", new Date(now.getTime() - MARKET_FEED_STALE_AFTER_MS - 1), now),
    "stale",
    "heartbeat-compatible transport state cannot hide an expired market event",
  );
  assert.equal(
    shouldResetAnalysisWindow(
      "streaming",
      new Date(now.getTime() - MARKET_FEED_STALE_AFTER_MS - 1),
      now,
    ),
    true,
    "the first event after a stale interval must reset the analysis window",
  );
  assert.equal(
    shouldResetAnalysisWindow("streaming", new Date(now.getTime() - 1_000), now),
    false,
    "continuous fresh events must not reset the analysis window",
  );
  assert.equal(
    marketEventIsFresh(new Date(now.getTime() - MARKET_FEED_STALE_AFTER_MS), now),
    true,
    "a recovery event at the freshness boundary is eligible",
  );
  assert.equal(
    marketEventIsFresh(new Date(now.getTime() - MARKET_FEED_STALE_AFTER_MS - 1), now),
    false,
    "a delayed recovery event must not seed a live analysis window",
  );
  assert.equal(
    marketFeedStateFor("stopped", new Date(now.getTime() - 1_000), now),
    "offline",
    "a stopped feed is offline even if it has prior observations",
  );

  console.log("Market feed state tests passed: current event, stale event, heartbeat-only transport, recovery reset, and offline feed.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}