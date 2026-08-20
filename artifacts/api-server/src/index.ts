import type { Server } from "node:http";
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
import { createGracefulShutdown } from "./lib/serverLifecycle";

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

const ownership = backendLifeline.owner.claim(port);
if (!ownership.accepted) {
  throw new Error(ownership.reason);
}

let server: Server | null = null;
const activeSockets = new Set<Socket>();

const shutdown = createGracefulShutdown({
  owner: backendLifeline.owner,
  getServer: () => server,
  activeSockets,
  closeEventStreams: (reason) => radarSseConnections.closeAll(reason),
  logger,
  // The order prevents a stopped market feed from being evaluated by a still
  // subscribed AlertService. Market windows and scanner state are intentionally
  // discarded by DatabentoLiveService.stop() and rebuild after the next start.
  stopServices: () => {
    runtimeSupervisor.stop();
    alertService.stop();
    internalTaskRegistry.stop();
    databentoLive.stop();
    marketUniverse.stop();
  },
  onComplete: (state) => {
    if (state === "failed") process.exitCode = 1;
  },
});

server = app.listen(port);
server.on("connection", (socket) => {
  activeSockets.add(socket);
  socket.once("close", () => activeSockets.delete(socket));
});

server.once("error", (error: NodeJS.ErrnoException) => {
  backendLifeline.owner.markFailed(error);
  logger.error(
    {
      code: error.code,
      port,
      error: error.message,
    },
    error.code === "EADDRINUSE"
      ? "Backend lifeline could not claim its managed listener port; refusing a duplicate instance"
      : "Backend lifeline listener failed",
  );
  process.exitCode = 1;
});

server.once("listening", () => {
  backendLifeline.owner.markListening();
  logger.info({ port, ownerId: ownership.ownerId }, "Server-owned Alpha Radar lifeline is listening");
  marketUniverse.start();
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
});

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
