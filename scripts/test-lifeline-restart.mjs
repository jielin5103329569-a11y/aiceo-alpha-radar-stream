/**
 * Process-isolated restart rehearsal for the server-owned lifeline.
 *
 * It uses the same production SSE connection registry but a deliberately
 * provider-free fixture: no Databento bridge, database, AlertService, or
 * production PORT is ever imported or contacted. The fixture proves that a
 * held dashboard stream exits on SIGTERM, a replacement can reclaim the port,
 * and its window begins unavailable until a newly injected verified event.
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createServer, request } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

import typescript from "typescript";

const outputDirectory = mkdtempSync(join(tmpdir(), "lifeline-restart-test-"));
const registryPath = join(outputDirectory, "sseConnections.cjs");
const lifecyclePath = join(outputDirectory, "serverLifecycle.cjs");
const fixturePath = join(outputDirectory, "fixture-server.cjs");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function spawnFixture(port, reportPath) {
  const child = fork(fixturePath, [String(port), reportPath], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: {
      NODE_ENV: "test",
      ALPHA_RADAR_RESTART_FIXTURE: "1",
      SSE_REGISTRY_PATH: registryPath,
      SERVER_LIFECYCLE_PATH: lifecyclePath,
    },
  });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Fixture did not start in time.")), 5_000);
    child.once("message", (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
    child.once("error", reject);
  });
  return { child, ready };
}

function waitForExit(child, timeoutMs = 5_000) {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Fixture process did not exit within the bounded timeout."));
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolvePromise({ code, signal });
    });
  });
}

function openSse(port) {
  const messages = [];
  const waiters = new Set();
  let response = null;
  let ended = false;
  let buffer = "";

  const notify = () => {
    for (const waiter of [...waiters]) {
      const found = messages.find(waiter.predicate);
      if (found) {
        waiters.delete(waiter);
        clearTimeout(waiter.timeout);
        waiter.resolve(found);
      }
    }
  };
  const waitFor = (predicate, timeoutMs = 5_000) => new Promise((resolvePromise, reject) => {
    const found = messages.find(predicate);
    if (found) return resolvePromise(found);
    const waiter = {
      predicate,
      resolve: resolvePromise,
      timeout: setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error("Timed out waiting for SSE message."));
      }, timeoutMs),
    };
    waiters.add(waiter);
  });
  const endedPromise = new Promise((resolvePromise, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path: "/api/radar/events",
      method: "GET",
      headers: { Accept: "text/event-stream" },
      agent: false,
    });
    req.once("error", reject);
    req.end();
    req.once("response", (incoming) => {
      response = incoming;
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk) => {
        buffer += chunk;
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event = frame.match(/^event: (.+)$/m)?.[1] ?? "message";
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (!data) continue;
          messages.push({ event, data: JSON.parse(data) });
          notify();
        }
      });
      incoming.once("end", () => {
        ended = true;
        resolvePromise();
      });
      incoming.once("error", reject);
    });
  });

  return { messages, waitFor, ended: endedPromise, get endedNow() { return ended; }, get response() { return response; } };
}

function postVerifiedEvent(port) {
  return new Promise((resolvePromise, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path: "/test/verified-market-event",
      method: "POST",
      agent: false,
    }, (res) => {
      res.resume();
      res.once("end", () => resolvePromise(res.statusCode));
    });
    req.once("error", reject);
    req.end();
  });
}

const fixtureSource = `
"use strict";
const { createServer } = require("node:http");
const { writeFileSync } = require("node:fs");
const { SseConnectionRegistry } = require(process.env.SSE_REGISTRY_PATH);
const { createGracefulShutdown } = require(process.env.SERVER_LIFECYCLE_PATH);

const port = Number(process.argv[2]);
const reportPath = process.argv[3];
const streams = new SseConnectionRegistry();
const instanceId = "fixture-" + process.pid;
const windowId = "window-" + process.pid + "-" + Date.now();
const shutdownOrder = [];
let marketEventFresh = false;
const activeSockets = new Set();
const owner = {
  state: "listening",
  markStopping() { this.state = "stopping"; },
  markStopped() { this.state = "stopped"; },
  markFailed() { this.state = "failed"; },
};

function status() {
  return { instanceId, windowId, marketEventFresh };
}
function writeStatus(response) {
  if (response.destroyed || response.writableEnded) return;
  response.write("event: status\\ndata: " + JSON.stringify(status()) + "\\n\\n");
}
const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/radar/events") {
    res.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    const remove = streams.add(res);
    writeStatus(res);
    req.once("close", () => {
      remove();
      if (!res.writableEnded) res.end();
    });
    return;
  }
  if (req.method === "POST" && req.url === "/test/verified-market-event") {
    marketEventFresh = true;
    // The registry intentionally hides its collection; broadcast through the
    // live responses registered by this fixture instead.
    for (const response of activeResponses) writeStatus(response);
    res.writeHead(204).end();
    return;
  }
  res.writeHead(404).end();
});
const activeResponses = new Set();
const originalAdd = streams.add.bind(streams);
streams.add = (response) => {
  activeResponses.add(response);
  const remove = originalAdd(response);
  return () => { activeResponses.delete(response); remove(); };
};
server.on("connection", (socket) => {
  activeSockets.add(socket);
  socket.once("close", () => activeSockets.delete(socket));
});
const shutdown = createGracefulShutdown({
  owner,
  getServer: () => server,
  activeSockets,
  closeEventStreams: (reason) => {
    shutdownOrder.push("sse");
    return streams.closeAll(reason);
  },
  stopServices: () => {
    shutdownOrder.push("alert", "internal_tasks", "databento", "market_universe");
  },
  logger: { info() {}, warn() {}, error() {} },
  gracePeriodMs: 1_000,
  onComplete: (state) => {
    writeFileSync(reportPath, JSON.stringify({ state, instanceId, windowId, shutdownOrder, remainingStreams: streams.size, ownerState: owner.state }));
    process.exit(state === "stopped" ? 0 : 1);
  },
});
server.once("error", (error) => {
  writeFileSync(reportPath, JSON.stringify({ error: error.code || error.message, shutdownOrder, remainingStreams: streams.size }));
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  if (process.send) process.send({ port, instanceId, windowId });
});
process.once("SIGTERM", () => shutdown("SIGTERM"));
`;

try {
  const source = readFileSync(resolve("artifacts/api-server/src/lib/sseConnections.ts"), "utf8");
  writeFileSync(registryPath, typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);
  const lifecycleSource = readFileSync(resolve("artifacts/api-server/src/lib/serverLifecycle.ts"), "utf8");
  writeFileSync(lifecyclePath, typescript.transpileModule(lifecycleSource, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText);
  writeFileSync(fixturePath, fixtureSource);

  const port = await reservePort();
  const firstReport = join(outputDirectory, "first-report.json");
  const first = spawnFixture(port, firstReport);
  const firstReady = await first.ready;
  const heldDashboardStream = openSse(port);
  const firstStatus = await heldDashboardStream.waitFor((message) => message.event === "status");
  assert.equal(firstStatus.data.instanceId, firstReady.instanceId);
  assert.equal(firstStatus.data.marketEventFresh, false, "a freshly started process must not invent a fresh window");

  const firstExit = waitForExit(first.child);
  first.child.kill("SIGTERM");
  await heldDashboardStream.ended;
  assert.equal(heldDashboardStream.endedNow, true, "SIGTERM must end the held SSE stream before process exit");
  assert.deepEqual(await firstExit, { code: 0, signal: null }, "graceful shutdown must exit cleanly");
  const firstShutdown = JSON.parse(readFileSync(firstReport, "utf8"));
  assert.deepEqual(
    firstShutdown.shutdownOrder,
    ["alert", "internal_tasks", "databento", "market_universe", "sse"],
    "Alert and market services must stop before the held dashboard stream closes",
  );
  assert.equal(firstShutdown.remainingStreams, 0, "shutdown must not leave zombie SSE streams");
  assert.equal(firstShutdown.ownerState, "stopped", "production graceful lifecycle must mark the replacement-safe stopped state");

  const secondReport = join(outputDirectory, "second-report.json");
  const second = spawnFixture(port, secondReport);
  const secondReady = await second.ready;
  assert.notEqual(secondReady.instanceId, firstReady.instanceId, "replacement must be a new process");
  const recoveredDashboardStream = openSse(port);
  const replacementStatus = await recoveredDashboardStream.waitFor((message) => message.event === "status");
  assert.equal(replacementStatus.data.marketEventFresh, false, "old fresh evidence cannot survive a replacement process");
  assert.notEqual(replacementStatus.data.windowId, firstStatus.data.windowId, "replacement must allocate a distinct market window");
  assert.equal(await postVerifiedEvent(port), 204);
  const rebuiltStatus = await recoveredDashboardStream.waitFor(
    (message) => message.event === "status" && message.data.marketEventFresh === true,
  );
  assert.equal(rebuiltStatus.data.windowId, replacementStatus.data.windowId, "only a current-process verified event can rebuild its new window");

  const conflictReport = join(outputDirectory, "conflict-report.json");
  const conflict = spawnFixture(port, conflictReport);
  void conflict.ready.catch(() => undefined);
  const conflictExit = await waitForExit(conflict.child);
  assert.deepEqual(conflictExit, { code: 1, signal: null }, "same-port duplicate fixture must fail rather than create another listener");
  assert.equal(JSON.parse(readFileSync(conflictReport, "utf8")).error, "EADDRINUSE");

  const secondExit = waitForExit(second.child);
  second.child.kill("SIGTERM");
  await recoveredDashboardStream.ended;
  assert.deepEqual(await secondExit, { code: 0, signal: null });
  assert.equal(JSON.parse(readFileSync(secondReport, "utf8")).remainingStreams, 0);

  const indexSource = readFileSync(resolve("artifacts/api-server/src/index.ts"), "utf8");
  const radarRouteSource = readFileSync(resolve("artifacts/api-server/src/routes/radar.ts"), "utf8");
  const streamHookSource = readFileSync(resolve("artifacts/alpha-radar-stream/src/hooks/use-radar-stream.ts"), "utf8");
  assert.match(indexSource, /createGracefulShutdown/);
  assert.match(indexSource, /closeEventStreams: \(reason\) => radarSseConnections\.closeAll\(reason\)/);
  assert.match(radarRouteSource, /backpressured/);
  assert.match(radarRouteSource, /res\.once\("drain"/);
  assert.match(streamHookSource, /EventSource/);
  assert.match(streamHookSource, /reconnecting/);
  assert.doesNotMatch(fixtureSource, /Databento|@workspace\/db|DATABENTO_API_KEY/);

  console.log("Lifeline restart tests passed: production graceful-shutdown module, isolated SIGTERM, held SSE exit, clean same-port replacement, dashboard stream recovery, new-window evidence, conflict refusal, and no zombie streams.");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}