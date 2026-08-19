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

export type RadarStatus = {
  configured: boolean;
  connectionState: RadarConnectionState;
  provider: string;
  dataset: string;
  symbol: string;
  startedAt: Date | null;
  lastUpdatedAt: Date;
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
    lastUpdatedAt: new Date(),
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
  private status = blankStatus();

  getStatus(): RadarStatus {
    return this.status;
  }

  start(): RadarStatus {
    if (this.child || this.status.connectionState === "connecting") {
      return this.status;
    }

    if (!process.env.DATABENTO_API_KEY) {
      this.status = { ...blankStatus(), lastUpdatedAt: new Date() };
      this.publish();
      return this.status;
    }

    this.stopping = false;
    this.status = {
      ...blankStatus(),
      configured: true,
      connectionState: "connecting",
      startedAt: new Date(),
      lastUpdatedAt: new Date(),
      error: null,
    };
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
      this.fail("Unable to launch the Databento live bridge.");
    });
    child.on("close", (code) => {
      this.child = null;
      if (!this.stopping && this.status.connectionState !== "error") {
        this.fail(
          code === 0
            ? "The Databento live bridge stopped unexpectedly."
            : "The Databento live bridge exited before streaming data.",
        );
      }
    });

    return this.status;
  }

  stop(): RadarStatus {
    this.stopping = true;
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = null;
    this.status = {
      ...this.status,
      connectionState: "stopped",
      error: null,
      lastUpdatedAt: new Date(),
    };
    this.publish();
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
        lastUpdatedAt: now,
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

  private fail(message: string): void {
    this.status = {
      ...this.status,
      connectionState: "error",
      error: redactMessage(message),
      lastUpdatedAt: new Date(),
      streams: this.status.streams.map((stream) => ({ ...stream, state: "error" as const })),
    };
    logger.warn({ reason: this.status.error }, "Databento live stream is unavailable");
    this.publish();
  }

  private publish(): void {
    this.emit("status", this.status);
  }
}

export const databentoLive = new DatabentoLiveService();