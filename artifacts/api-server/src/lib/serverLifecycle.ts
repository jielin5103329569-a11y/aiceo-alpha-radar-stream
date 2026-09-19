import type { Server } from "node:http";
import { request } from "node:http";
import type { Socket } from "node:net";
import { spawnSync } from "node:child_process";

export type ListeningPortOccupant = {
  readonly pid: number | null;
  readonly command: string | null;
  readonly raw: string;
};

export type ExistingApiSingletonProbe =
  | { readonly state: "empty" }
  | { readonly state: "healthy-singleton"; readonly occupant: ListeningPortOccupant; readonly ownerPid: number }
  | { readonly state: "occupied"; readonly occupants: readonly ListeningPortOccupant[]; readonly reason: string };

export function inspectListeningPorts(port: number): readonly ListeningPortOccupant[] {
  const result = spawnSync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpct"],
    { encoding: "utf8" },
  );
  const raw = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (!raw) return [];
  const occupants: ListeningPortOccupant[] = [];
  let current: { pid: number | null; command: string | null; lines: string[] } | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      if (current) occupants.push({ ...current, raw: current.lines.join("\n") });
      const pid = Number(line.slice(1));
      current = {
        pid: Number.isInteger(pid) && pid > 0 ? pid : null,
        command: null,
        lines: [line],
      };
    } else if (current) {
      current.lines.push(line);
      if (line.startsWith("c")) current.command = line.slice(1) || null;
    }
  }
  if (current) occupants.push({ ...current, raw: current.lines.join("\n") });
  return occupants;
}

/**
 * Best-effort diagnostics for an incumbent listener. This never attempts to
 * stop the incumbent or retry the bind; it only provides context before the
 * duplicate process exits.
 */
export function inspectListeningPort(port: number): ListeningPortOccupant {
  return inspectListeningPorts(port)[0] ?? { pid: null, command: null, raw: "" };
}

export async function probeExistingApiSingleton(
  port: number,
  timeoutMs = 1_500,
): Promise<ExistingApiSingletonProbe> {
  const occupants = inspectListeningPorts(port);
  if (occupants.length === 0) return { state: "empty" };
  if (occupants.length !== 1 || !occupants[0].pid) {
    return { state: "occupied", occupants, reason: "listener count is not exactly one or its PID is unavailable" };
  }
  const occupant = occupants[0];
  const ownerPid = occupants[0].pid!;
  try {
    const health = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const probe = request({
        hostname: "127.0.0.1",
        port,
        path: "/api/healthz",
        method: "GET",
        timeout: timeoutMs,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.once("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error(`health endpoint returned ${response.statusCode ?? "no status"}`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("health endpoint did not return JSON"));
          }
        });
      });
      probe.once("timeout", () => probe.destroy(new Error("health endpoint timed out")));
      probe.once("error", reject);
      probe.end();
    });
    if (
      health.status === "ok"
      && health.singleton === true
      && health.port === port
      && health.ownerPid === ownerPid
    ) {
      return { state: "healthy-singleton", occupant, ownerPid };
    }
    return { state: "occupied", occupants, reason: "listener health identity does not match the API singleton contract" };
  } catch (error) {
    return {
      state: "occupied",
      occupants,
      reason: error instanceof Error ? error.message : "health probe failed",
    };
  }
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