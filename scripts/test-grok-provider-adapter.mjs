import assert from "node:assert/strict";
import { executeGrokDevelopmentAttempt } from "../artifacts/api-server/src/lib/grokProviderAdapter.ts";

const input = {
  action: "contract.echo",
  resource: "ARCH-001:test:ACK",
  model: "grok-test-fixed",
  timeoutMs: 25,
};

const response = (status, payload) => async () => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json" },
});

const success = await executeGrokDevelopmentAttempt(input, response(200, {
  id: "response-test",
  created_at: Math.floor(Date.now() / 1000),
  output_text: "ARCH-001:test:ACK",
  usage: { total_tokens: 12 },
}));
assert.equal(success.ok, true);
assert.equal(success.tokens, 12);

const missingUsage = await executeGrokDevelopmentAttempt(input, response(200, {
  id: "response-test",
  created_at: Math.floor(Date.now() / 1000),
  output_text: "ARCH-001:test:ACK",
}));
assert.deepEqual(
  { ok: missingUsage.ok, state: missingUsage.ok ? null : missingUsage.state, retryable: missingUsage.ok ? null : missingUsage.retryable },
  { ok: false, state: "UNKNOWN", retryable: false },
);

const stale = await executeGrokDevelopmentAttempt(input, response(200, {
  id: "response-test",
  created_at: Math.floor((Date.now() - 180_000) / 1000),
  output_text: "ARCH-001:test:ACK",
  usage: { total_tokens: 12 },
}));
assert.deepEqual(
  { ok: stale.ok, state: stale.ok ? null : stale.state },
  { ok: false, state: "STALE" },
);

const settledFailure = await executeGrokDevelopmentAttempt(input, response(503, {
  error: "synthetic provider failure",
  usage: { total_tokens: 0 },
}));
assert.deepEqual(
  { ok: settledFailure.ok, settled: settledFailure.settled, retryable: settledFailure.ok ? null : settledFailure.retryable, state: settledFailure.ok ? null : settledFailure.state },
  { ok: false, settled: true, retryable: true, state: "FAILED" },
);

const unknownUsageFailure = await executeGrokDevelopmentAttempt(input, response(503, {
  error: "synthetic provider failure with unknown usage",
}));
assert.deepEqual(
  { ok: unknownUsageFailure.ok, retryable: unknownUsageFailure.ok ? null : unknownUsageFailure.retryable, state: unknownUsageFailure.ok ? null : unknownUsageFailure.state },
  { ok: false, retryable: false, state: "UNKNOWN" },
);

const timeout = await executeGrokDevelopmentAttempt(input, async () => new Promise(() => {}));
assert.deepEqual(
  { ok: timeout.ok, settled: timeout.settled, retryable: timeout.ok ? null : timeout.retryable, state: timeout.ok ? null : timeout.state },
  { ok: false, settled: false, retryable: false, state: "UNKNOWN" },
);

const stalledBody = await executeGrokDevelopmentAttempt(input, async () => ({
  ok: true,
  status: 200,
  text: async () => new Promise(() => {}),
}));
assert.deepEqual(
  { ok: stalledBody.ok, settled: stalledBody.settled, retryable: stalledBody.ok ? null : stalledBody.retryable, state: stalledBody.ok ? null : stalledBody.state },
  { ok: false, settled: false, retryable: false, state: "UNKNOWN" },
);

console.log("Grok provider adapter behavior passed: success evidence, usage fail-closed, stale timestamps, settled retryability, dispatch timeout, and stalled-body timeout.");