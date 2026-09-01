import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";

import app from "./app";
import { logger } from "./lib/logger";
import { databentoLive } from "./lib/databentoLive";
import { marketUniverse } from "./lib/marketUniverse";
import { alertService } from "./lib/alertService";
import { backendLifeline } from "./lib/backendLifeline";
import { internalTaskRegistry } from "./lib/internalTaskRegistry";
import { radarSseConnections } from "./lib/sseConnections";
import { runtimeSupervisor } from "./lib/runtimeSupervisor";
import { diagnosticsCenter } from "./lib/diagnosticsCenter";
import { autonomousOperationsCoordinator } from "./lib/autonomousOperationsRuntime";
import { aiIndustryStockPool } from "./lib/aiIndustryStockPool";
import type { AutonomousWorkDefinition } from "./lib/autonomousOperationsCoordinator";
import { buildEngineeringGovernanceSnapshot } from "./lib/engineeringGovernance";
import { createGracefulShutdown, inspectListeningPort } from "./lib/serverLifecycle";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let server: Server | null = null;
const activeSockets = new Set<Socket>();

const shutdown = createGracefulShutdown({
  owner: backendLifeline.owner,
  getServer: () => server,
  activeSockets,
  closeEventStreams: (reason) => radarSseConnections.closeAll(reason),
  logger,
  // Stop Alert evaluation before market services, then close dashboard streams.
  // Market windows and scanner state are intentionally discarded by
  // DatabentoLiveService.stop() and rebuild after the next start.
  stopServices: async () => {
    runtimeSupervisor.stop();
    alertService.stop();
    internalTaskRegistry.stop();
    databentoLive.stop();
    marketUniverse.stop();
    aiIndustryStockPool.stop();
    await diagnosticsCenter.stop();
    await autonomousOperationsCoordinator.stop();
  },
  onComplete: (state) => {
    if (state === "failed") process.exitCode = 1;
  },
});

server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && pathname === "/api/healthz") {
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({
      status: "ok",
      ownerPid: process.pid,
      port,
      singleton: true,
    }));
    return;
  }
  app(request, response);
});
server.on("connection", (socket) => {
  activeSockets.add(socket);
  socket.once("close", () => activeSockets.delete(socket));
});

server.once("error", (error: NodeJS.ErrnoException) => {
  backendLifeline.owner.markFailed(error);
  const incumbent = error.code === "EADDRINUSE"
    ? inspectListeningPort(port)
    : null;
  logger.error(
    {
      code: error.code,
      port,
      incumbentPid: incumbent?.pid ?? null,
      incumbentCommand: incumbent?.command ?? null,
      incumbentListener: incumbent?.raw ?? null,
      error: error.message,
    },
    error.code === "EADDRINUSE"
      ? "Backend lifeline could not claim its managed listener port; refusing a duplicate instance"
      : "Backend lifeline listener failed",
  );
  process.exit(1);
});

server.once("listening", () => {
  const ownership = backendLifeline.owner.claim(port);
  if (!ownership.accepted) {
    logger.error(
      { port, ownerPid: process.pid, reason: ownership.reason },
      "Bound API listener could not claim backend ownership",
    );
    server?.close(() => process.exit(1));
    return;
  }
  backendLifeline.owner.markListening();
  logger.info({ port, ownerId: ownership.ownerId }, "Server-owned Alpha Radar lifeline is listening");
  marketUniverse.start();
    aiIndustryStockPool.start();
  const liveStatus = databentoLive.start();
  logger.info(
    {
      symbols: liveStatus.symbolRadars?.map((symbol) => symbol.symbol) ?? [liveStatus.symbol],
      configured: liveStatus.configured,
    },
    "Armed protected Databento live bridges",
  );
  alertService.start();
  try {
    internalTaskRegistry.start();
  } catch (error) {
    logger.error({ error }, "Internal task governance failed to start; production real-time services remain running");
  }
  const getOperationsObservation = () => {
    const now = new Date();
    const lifeline = backendLifeline.getSnapshot({
      now,
      symbols: databentoLive.getLifelineHealth(now),
      alert: alertService.getHealth(),
      marketUniverse: marketUniverse.getLifelineHealth(now),
      internalTasks: internalTaskRegistry.getSnapshot(now),
    });
    return {
      process: lifeline.overall.state,
      protectedFeed: lifeline.transport.errorSymbols > 0
        ? "degraded" as const
        : lifeline.recovery.phase === "running"
          ? "healthy" as const
          : "recovering" as const,
      alertService: lifeline.alertDelivery.health === "healthy" ? "healthy" as const : "degraded" as const,
      internalLeases: lifeline.internalTasks.registryState === "healthy"
        ? "healthy" as const
        : lifeline.internalTasks.recoveringCount > 0
          ? "recovering" as const
          : "blocked" as const,
      providerProbe: lifeline.marketUniverse.serviceRunning ? "ready" as const : "not_configured" as const,
      validationReadiness: lifeline.internalTasks.registryState === "healthy" ? "ready" as const : "constrained" as const,
      reason: "Existing API lifecycle observations are diagnostic-only and remain outside market and Alert authority.",
    };
  };
  const baselineOperation: AutonomousWorkDefinition = {
    workId: "api-lifecycle-baseline",
    title: "Record a read-only API lifecycle baseline",
    ownerModule: "api_lifecycle",
    implementationKey: "api-lifecycle-baseline-v1",
    resourceClaims: ["operations-observation"],
    handler: ({ checkpoint }) => {
      const observation = getOperationsObservation();
      const checkpointRecorded = checkpoint("read_only_lifeline", {
        processHealthy: observation.process === "healthy",
        protectedFeedHealthy: observation.protectedFeed === "healthy",
        alertServiceHealthy: observation.alertService === "healthy",
      });
      return {
        outcome: "verified",
        reason: "Read-only API lifecycle baseline collected without modifying market or Alert services.",
        evidence: {
          checkpointRecorded,
          processHealthy: observation.process === "healthy",
          alertServiceHealthy: observation.alertService === "healthy",
        },
      };
    },
    validate: (result) => result.evidence.checkpointRecorded === true,
  };
  void (async () => {
    await autonomousOperationsCoordinator.register(baselineOperation);
    await autonomousOperationsCoordinator.start({ getObservation: getOperationsObservation });
    const accepted = await autonomousOperationsCoordinator.acceptInternally("api-lifecycle-baseline");
    if (accepted.accepted) await autonomousOperationsCoordinator.tick(new Date());
  })().catch((error) => {
    logger.warn({ error }, "Autonomous operations coordinator could not start; market and Alert services remain isolated");
  });
  runtimeSupervisor.start({
    getLifeline: (now) => backendLifeline.getSnapshot({
      now,
      symbols: databentoLive.getLifelineHealth(now),
      alert: alertService.getHealth(),
      marketUniverse: marketUniverse.getLifelineHealth(now),
      internalTasks: internalTaskRegistry.getSnapshot(now),
    }),
    getDashboardDelivery: () => ({ activeSseConnections: radarSseConnections.size }),
    reclaimInternalTask: (taskKey, operatorId, now) => internalTaskRegistry.reclaim(taskKey, operatorId, now),
  });
  diagnosticsCenter.start(() => {
    const now = new Date();
    return {
      now,
      lifeline: backendLifeline.getSnapshot({
        now,
        symbols: databentoLive.getLifelineHealth(now),
        alert: alertService.getHealth(),
        marketUniverse: marketUniverse.getLifelineHealth(now),
        internalTasks: internalTaskRegistry.getSnapshot(now),
      }),
      supervisor: runtimeSupervisor.getSnapshot(now),
      engineeringGovernance: buildEngineeringGovernanceSnapshot({
        now,
        protectedScanners: databentoLive.getEngineeringScannerHealth(now),
        internalTaskHealth: internalTaskRegistry.getSnapshot(now),
      }),
    };
  });
});

server.listen(port);

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
