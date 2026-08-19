import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "./logger";

export type RadarConnectionState =
  | "not_configured"
  | "connecting"
  | "connected"
  | "streaming"
  | "error"
  | "stopped";

export type RadarReconnectState = "idle" | "scheduled" | "reconnecting" | "exhausted";

export type RadarStatus = {
  configured: boolean;
  connectionState: RadarConnectionState;
  provider: string;
  dataset: string;
  symbol: string;
  startedAt: Date | null;
  lastUpdatedAt: Date | null;
  lastHeartbeatAt: Date | null;
  reconnectState: RadarReconnectState;
  reconnectAttempt: number;
  nextReconnectAt: Date | null;
  error: string | null;
  market: {
    latestPrice: number | null;
    bidPrice: number | null;
    askPrice: number | null;
    bidSize: number | null;
    askSize: number | null;
    lastTradeSize: number | null;
    sessionVolume: number | null;
    lastTradeAt: Date | null;
  };
  recentTrades: Array<{
    price: number;
    size: number;
    timestamp: Date;
    side: string | null;
  }>;
  streams: Array<{
    schema: "mbp-1" | "ohlcv-1s";
    state: "waiting" | "receiving" | "error";
    eventCount: number;
    lastEventAt: Date | null;
  }>;
};

type BridgeEvent =
  | { type: "ready" }
  | {
      type: "mbp";
      timestamp: string;
      bidPrice: number | null;
      askPrice: number | null;
      bidSize: number | null;
      askSize: number | null;
      trade:
        | {
            price: number;
            size: number;
            timestamp: string;
            side: string | null;
          }
        | null;
    }
  | { type: "ohlcv"; timestamp: string; close: number | null; volume: number | null }
  | { type: "error"; message: string };

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(currentDir, "databento_live_bridge.py");
const HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 30_000;

function redactMessage(message: string): string {
  const key = process.env.DATABENTO_API_KEY;
  const withoutKey = key ? message.replaceAll(key, "[redacted]") : message;
  return withoutKey.replace(/db-[a-z0-9_-]{16,}/gi, "[redacted]").slice(0, 320);
}

function blankStatus(): RadarStatus {
  const configured = Boolean(process.env.DATABENTO_API_KEY);
  return {
    configured,
    connectionState: configured ? "stopped" : "not_configured",
    provider: "Databento",
    dataset: "EQUS.MINI",
    symbol: "NVDA",
    startedAt: null,
    lastUpdatedAt: null,
    lastHeartbeatAt: null,
    reconnectState: "idle",
    reconnectAttempt: 0,
    nextReconnectAt: null,
    error: configured ? null : "DATABENTO_API_KEY is not configured.",
    market: {
      latestPrice: null,
      bidPrice: null,
      askPrice: null,
      bidSize: null,
      askSize: null,
      lastTradeSize: null,
      sessionVolume: null,
      lastTradeAt: null,
    },
    recentTrades: [],
    streams: [
      { schema: "mbp-1", state: "waiting", eventCount: 0, lastEventAt: null },
      { schema: "ohlcv-1s", state: "waiting", eventCount: 0, lastEventAt: null },
    ],
  };
}

export class DatabentoLiveService extends EventEmitter {
  private child: ChildProcess | null = null;
  private outputBuffer = "";
  private stopping = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private status = blankStatus();

  getStatus(): RadarStatus {
    return this.status;
  }

  start(): RadarStatus {
    return this.launch(false);
  }

  stop(): RadarStatus {
    this.stopping = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = null;
    this.status = {
      ...this.status,
      connectionState: "stopped",
      reconnectState: "idle",
      reconnectAttempt: 0,
      nextReconnectAt: null,
      error: null,
      streams: this.status.streams.map((stream) => ({ ...stream, state: "waiting" as const })),
    };
    this.publish();
    return this.status;
  }

  private launch(isReconnect: boolean): RadarStatus {
    if (this.child || this.status.connectionState === "connecting") {
      return this.status;
    }

    if (!process.env.DATABENTO_API_KEY) {
      this.clearReconnectTimer();
      this.clearHeartbeatTimer();
      this.status = { ...blankStatus() };
      this.publish();
      return this.status;
    }

    this.stopping = false;
    this.clearReconnectTimer();
    const now = new Date();
    this.status = isReconnect
      ? {
          ...this.status,
          configured: true,
          connectionState: "connecting",
          lastHeartbeatAt: now,
          reconnectState: "reconnecting",
          nextReconnectAt: null,
          error: null,
          streams: this.status.streams.map((stream) => ({ ...stream, state: "waiting" as const })),
        }
      : {
          ...blankStatus(),
          configured: true,
          connectionState: "connecting",
          startedAt: now,
          lastHeartbeatAt: now,
          error: null,
        };
    this.startHeartbeat();
    this.publish();

    const child = spawn("python3", ["-u", bridgePath], {
      env: {
        ...process.env,
        RADAR_SYMBOL: this.status.symbol,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      this.consumeOutput(chunk.toString());
    });
    child.stderr?.on("data", () => {
      // The bridge intentionally does not write raw diagnostics to the public API.
      // If it does, keep the bytes out of logs and present a generic connection error.
    });
    child.on("error", () => {
      if (this.child === child) {
        this.child = null;
      }
      this.fail("Unable to launch the Databento live bridge.", true);
    });
    child.on("close", (code) => {
      if (this.child === child) {
        this.child = null;
      }
      if (!this.stopping && !this.reconnectTimer) {
        this.fail(
          this.status.error ??
            (code === 0
              ? "The Databento live bridge stopped unexpectedly."
              : "The Databento live bridge exited before streaming data."),
          true,
        );
      }
    });

    return this.status;
  }

  private consumeOutput(chunk: string): void {
    this.outputBuffer += chunk;
    const lines = this.outputBuffer.split("\n");
    this.outputBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as BridgeEvent;
        this.applyEvent(event);
      } catch {
        this.fail("The Databento bridge returned an unreadable status update.");
      }
    }
  }

  private applyEvent(event: BridgeEvent): void {
    const now = new Date();
    if (event.type === "ready") {
      this.status = {
        ...this.status,
        connectionState: "connected",
        error: null,
        lastHeartbeatAt: now,
        reconnectState: "idle",
        reconnectAttempt: 0,
        nextReconnectAt: null,
      };
      this.publish();
      return;
    }

    if (event.type === "error") {
      this.fail(redactMessage(event.message));
      return;
    }

    const streams = this.status.streams.map((stream) =>
      stream.schema === (event.type === "mbp" ? "mbp-1" : "ohlcv-1s")
        ? {
            ...stream,
            state: "receiving" as const,
            eventCount: stream.eventCount + 1,
            lastEventAt: new Date(event.timestamp),
          }
        : stream,
    );

    if (event.type === "mbp") {
      const trade = event.trade
        ? {
            price: event.trade.price,
            size: event.trade.size,
            timestamp: new Date(event.trade.timestamp),
            side: event.trade.side,
          }
        : null;
      this.status = {
        ...this.status,
        connectionState: "streaming",
        error: null,
        lastUpdatedAt: now,
        lastHeartbeatAt: now,
        streams,
        market: {
          ...this.status.market,
          latestPrice: trade?.price ?? this.status.market.latestPrice,
          bidPrice: event.bidPrice,
          askPrice: event.askPrice,
          bidSize: event.bidSize,
          askSize: event.askSize,
          lastTradeSize: trade?.size ?? this.status.market.lastTradeSize,
          lastTradeAt: trade?.timestamp ?? this.status.market.lastTradeAt,
        },
        recentTrades: trade ? [trade, ...this.status.recentTrades].slice(0, 12) : this.status.recentTrades,
      };
    } else {
      this.status = {
        ...this.status,
        connectionState: "streaming",
        error: null,
        lastUpdatedAt: now,
        lastHeartbeatAt: now,
        streams,
        market: {
          ...this.status.market,
          latestPrice: event.close ?? this.status.market.latestPrice,
          sessionVolume:
            event.volume === null
              ? this.status.market.sessionVolume
              : (this.status.market.sessionVolume ?? 0) + event.volume,
          lastTradeAt: new Date(event.timestamp),
        },
      };
    }
    this.publish();
  }

  private fail(message: string, shouldReconnect = false): void {
    this.status = {
      ...this.status,
      connectionState: "error",
      error: redactMessage(message),
      lastHeartbeatAt: new Date(),
      streams: this.status.streams.map((stream) => ({ ...stream, state: "error" as const })),
    };
    logger.warn({ reason: this.status.error }, "Databento live stream is unavailable");
    if (shouldReconnect) {
      this.scheduleReconnect();
    } else {
      this.publish();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer || !process.env.DATABENTO_API_KEY) {
      this.publish();
      return;
    }

    const reconnectAttempt = this.status.reconnectAttempt + 1;
    if (reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
      this.status = {
        ...this.status,
        reconnectState: "exhausted",
        nextReconnectAt: null,
        error: `${this.status.error ?? "Databento live stream is unavailable."} Automatic reconnect paused after ${MAX_RECONNECT_ATTEMPTS} attempts.`,
      };
      this.publish();
      return;
    }

    const delay = Math.min(1_000 * 2 ** (reconnectAttempt - 1), MAX_RECONNECT_DELAY_MS);
    this.status = {
      ...this.status,
      reconnectState: "scheduled",
      reconnectAttempt,
      nextReconnectAt: new Date(Date.now() + delay),
    };
    this.publish();

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopping) {
        this.launch(true);
      }
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      if (this.status.connectionState === "stopped" || this.status.connectionState === "not_configured") {
        return;
      }
      this.status = {
        ...this.status,
        lastHeartbeatAt: new Date(),
      };
      this.publish();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private publish(): void {
    this.emit("status", this.status);
  }
}

export const databentoLive = new DatabentoLiveService();