import type { Server } from "node:http";
import type { Socket } from "node:net";

type LifecycleOwner = {
  markStopping(): void;
  markStopped(): void;
  markFailed(error: unknown): void;
};

type LifecycleLogger = {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
};

export type GracefulShutdownOptions = {
  readonly owner: LifecycleOwner;
  readonly getServer: () => Server | null;
  readonly activeSockets: Set<Socket>;
  readonly closeEventStreams: (reason: string) => number;
  readonly stopServices: () => void;
  readonly logger: LifecycleLogger;
  readonly gracePeriodMs?: number;
  readonly onComplete?: (state: "stopped" | "failed") => void;
};

/**
 * The sole graceful-stop coordinator used by the production API process.
 * It closes observational SSE streams before stopping service dependencies,
 * then bounds residual TCP connections. It has no market-data authority.
 */
export function createGracefulShutdown(options: GracefulShutdownOptions): (signal: string) => void {
  let shutdownStarted = false;
  const gracePeriodMs = options.gracePeriodMs ?? 5_000;

  return (signal: string): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    options.owner.markStopping();
    options.logger.info({ signal }, "Stopping server-owned Alpha Radar lifeline");
    const closedSseConnections = options.closeEventStreams("server_stopping");
    options.stopServices();

    const server = options.getServer();
    if (!server) {
      options.owner.markStopped();
      options.onComplete?.("stopped");
      return;
    }

    server.closeIdleConnections?.();
    const forceCloseTimer = setTimeout(() => {
      options.logger.warn(
        { activeConnectionCount: options.activeSockets.size, closedSseConnections },
        "Grace period elapsed; closing remaining API connections",
      );
      server.closeAllConnections?.();
      for (const socket of options.activeSockets) socket.destroy();
    }, gracePeriodMs);
    forceCloseTimer.unref();

    server.close((error) => {
      clearTimeout(forceCloseTimer);
      if (error) {
        options.owner.markFailed(error);
        options.logger.error({ error }, "Error while closing API server");
        options.onComplete?.("failed");
      } else {
        options.owner.markStopped();
        options.onComplete?.("stopped");
      }
    });
  };
}