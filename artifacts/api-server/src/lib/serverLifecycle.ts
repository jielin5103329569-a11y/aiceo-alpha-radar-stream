import type { Server } from "node:http";
import type { Socket } from "node:net";
import { spawnSync } from "node:child_process";

export type ListeningPortOccupant = {
  readonly pid: number | null;
  readonly command: string | null;
  readonly raw: string;
};

/**
 * Best-effort diagnostics for an incumbent listener. This never attempts to
 * stop the incumbent or retry the bind; it only provides context before the
 * duplicate process exits.
 */
export function inspectListeningPort(port: number): ListeningPortOccupant {
  const result = spawnSync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpct"],
    { encoding: "utf8" },
  );
  const raw = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const lines = raw.split(/\r?\n/);
  const pidLine = lines.find((line) => line.startsWith("p"));
  const commandLine = lines.find((line) => line.startsWith("c"));
  const parsedPid = pidLine ? Number(pidLine.slice(1)) : Number.NaN;

  return {
    pid: Number.isInteger(parsedPid) && parsedPid > 0 ? parsedPid : null,
    command: commandLine?.slice(1) || null,
    raw,
  };
}

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
  readonly stopServices: () => void | Promise<void>;
  readonly logger: LifecycleLogger;
  readonly gracePeriodMs?: number;
  readonly onComplete?: (state: "stopped" | "failed") => void;
};

/**
 * The sole graceful-stop coordinator used by the production API process.
 * It begins stopping service dependencies before closing observational SSE
 * streams, then bounds residual TCP connections. It has no market-data authority.
 */
export function createGracefulShutdown(options: GracefulShutdownOptions): (signal: string) => void {
  let shutdownStarted = false;
  const gracePeriodMs = options.gracePeriodMs ?? 5_000;

  return (signal: string): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    options.owner.markStopping();
    options.logger.info({ signal }, "Stopping server-owned Alpha Radar lifeline");
    try {
      void Promise.resolve(options.stopServices()).catch((error) => {
        options.logger.error({ error }, "Error while stopping service dependencies");
      });
    } catch (error) {
      options.logger.error({ error }, "Error while stopping service dependencies");
    }
    const closedSseConnections = options.closeEventStreams("server_stopping");

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