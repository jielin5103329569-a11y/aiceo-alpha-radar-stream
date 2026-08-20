import type { Server } from "node:http";
import type { Socket } from "node:net";

import app from "./app";
import { logger } from "./lib/logger";
import { databentoLive } from "./lib/databentoLive";
import { marketUniverse } from "./lib/marketUniverse";
import { alertService } from "./lib/alertService";
import { backendLifeline } from "./lib/backendLifeline";
import { internalTaskRegistry } from "./lib/internalTaskRegistry";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const ownership = backendLifeline.owner.claim(port);
if (!ownership.accepted) {
  throw new Error(ownership.reason);
}

let server: Server | null = null;
let shutdownStarted = false;
const activeSockets = new Set<Socket>();

function shutdown(signal: string): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  backendLifeline.owner.markStopping();
  logger.info({ signal }, "Stopping server-owned Alpha Radar lifeline");
  // The order prevents a stopped market feed from being evaluated by a still
  // subscribed AlertService. Market windows and scanner state are intentionally
  // discarded by DatabentoLiveService.stop() and rebuild after the next start.
  alertService.stop();
  internalTaskRegistry.stop();
  databentoLive.stop();
  marketUniverse.stop();
  if (!server) {
    backendLifeline.owner.markStopped();
    return;
  }
  server.closeIdleConnections?.();
  const forceCloseTimer = setTimeout(() => {
    logger.warn(
      { activeConnectionCount: activeSockets.size },
      "Grace period elapsed; closing remaining API connections",
    );
    server?.closeAllConnections?.();
    for (const socket of activeSockets) {
      socket.destroy();
    }
  }, 5_000);
  forceCloseTimer.unref();
  server.close((error) => {
    clearTimeout(forceCloseTimer);
    if (error) {
      backendLifeline.owner.markFailed(error);
      logger.error({ error }, "Error while closing API server");
      process.exitCode = 1;
    } else {
      backendLifeline.owner.markStopped();
    }
  });
}

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
});

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
