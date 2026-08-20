import type { ServerResponse } from "node:http";

/**
 * Server-owned SSE connection registry.
 *
 * Status streams are observational only: a rejected write or an explicitly
 * closed stream never changes market freshness, scanning, or alert eligibility.
 */
export class SseConnectionRegistry {
  private readonly connections = new Set<ServerResponse>();

  add(response: ServerResponse): () => void {
    this.connections.add(response);
    return () => this.connections.delete(response);
  }

  get size(): number {
    return this.connections.size;
  }

  closeAll(reason = "server_stopping"): number {
    let closed = 0;
    for (const response of [...this.connections]) {
      this.connections.delete(response);
      if (response.destroyed || response.writableEnded) continue;
      try {
        response.write(`event: lifecycle\ndata: ${JSON.stringify({ state: "stopping", reason })}\n\n`);
      } catch {
        // A peer may disappear between the writable check and write. It is
        // already disconnected and requires no retry.
      }
      response.end();
      closed += 1;
    }
    return closed;
  }
}

export const radarSseConnections = new SseConnectionRegistry();