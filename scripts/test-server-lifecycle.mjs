import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "server-lifecycle-test-"));
const outputPath = join(outputDirectory, "serverLifecycle.cjs");

try {
  const source = readFileSync(resolve("artifacts/api-server/src/lib/serverLifecycle.ts"), "utf8");
  writeFileSync(outputPath, typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);
  const { createGracefulShutdown } = createRequire(import.meta.url)(outputPath);

  let resolveSlowStop;
  let closeCalled = false;
  let idleClosed = false;
  let lifecycleState = null;
  const shutdown = createGracefulShutdown({
    owner: {
      markStopping() {},
      markStopped() {
        lifecycleState = "stopped";
      },
      markFailed() {
        lifecycleState = "failed";
      },
    },
    getServer: () => ({
      closeIdleConnections() {
        idleClosed = true;
      },
      close(callback) {
        closeCalled = true;
        callback();
      },
      closeAllConnections() {},
    }),
    activeSockets: new Set(),
    closeEventStreams: () => 0,
    stopServices: () => new Promise((resolve) => {
      resolveSlowStop = resolve;
    }),
    logger: { info() {}, warn() {}, error() {} },
    gracePeriodMs: 10,
  });

  shutdown("SIGTERM");
  assert.equal(idleClosed, true, "listener drain begins immediately");
  assert.equal(closeCalled, true, "listener close must not wait for service persistence");
  assert.equal(lifecycleState, "stopped");
  resolveSlowStop();
  await new Promise((resolve) => setImmediate(resolve));
  console.log("Server lifecycle test passed: slow service shutdown cannot delay bounded listener closure.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}