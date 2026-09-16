import { ReplitConnectors } from "@replit/connectors-sdk";

export const APPROVED_GROK_DEVELOPMENT_ACTIONS = [
  "contract.echo",
  "development.analyze",
] as const;

export type ApprovedGrokDevelopmentAction =
  (typeof APPROVED_GROK_DEVELOPMENT_ACTIONS)[number];

export type GrokAttemptResult =
  | {
      ok: true;
      settled: true;
      text: string;
      responseId: string;
      providerTimestamp: Date;
      tokens: number;
    }
  | {
      ok: false;
      settled: boolean;
      retryable: boolean;
      state: "FAILED" | "UNKNOWN" | "STALE";
      reason: string;
      providerTimestamp?: Date;
      tokens: number;
    };

type GrokProxyInit = {
  method: string;
  headers?: Record<string, string>;
  body?: string;
};

const MAX_PROVIDER_CLOCK_SKEW_MS = 120_000;

function extractText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";
  const text: string[] = [];
  for (const item of payload.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        text.push((part as { text: string }).text);
      }
    }
  }
  return text.join("\n");
}

function providerTime(payload: Record<string, unknown>): Date | null {
  const raw = payload.created_at ?? payload.created;
  const date = typeof raw === "number"
    ? new Date(raw * 1_000)
    : typeof raw === "string"
      ? new Date(raw)
      : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function tokenUsage(payload: Record<string, unknown>): number | null {
  const usage = payload.usage;
  if (!usage || typeof usage !== "object") return null;
  const total = (usage as { total_tokens?: unknown }).total_tokens;
  return typeof total === "number" && Number.isFinite(total) && total >= 0
    ? Math.floor(total)
    : null;
}

function promptFor(action: ApprovedGrokDevelopmentAction, resource: string): string {
  if (action === "contract.echo") {
    return `ARCH-001 synthetic contract echo. Return the following text exactly, with no tools or external data:\n${resource}`;
  }
  return [
    "ARCH-001 restricted development analysis.",
    "Analyze only the supplied text. Do not use tools, web search, files, production data, or external context.",
    "Return a concise plain-text analysis.",
    resource,
  ].join("\n");
}

export async function executeGrokDevelopmentAttempt(input: {
  action: ApprovedGrokDevelopmentAction;
  resource: string;
  model: string;
  timeoutMs: number;
}, proxy?: (path: string, init: GrokProxyInit) => Promise<Response>): Promise<GrokAttemptResult> {
  const providerProxy = proxy ?? ((path: string, init: GrokProxyInit) => new ReplitConnectors().proxy("xai", path, init));
  let timeout: NodeJS.Timeout | undefined;
  try {
    const lifecycle = (async () => {
      const response = await providerProxy("/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          input: promptFor(input.action, input.resource),
          temperature: 0,
          max_output_tokens: 512,
        }),
      });
      return { response, raw: await response.text() };
    })();
    const { response, raw } = await Promise.race([
      lifecycle,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("ARCH-001 provider timeout")), input.timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, settled: true, retryable: false, state: "UNKNOWN", reason: "Provider returned malformed JSON", tokens: 0 };
    }
    const tokens = tokenUsage(payload);
    if (!response.ok && tokens === null && response.status !== 429) {
      return { ok: false, settled: true, retryable: false, state: "UNKNOWN", reason: "Provider failure omitted usage evidence", tokens: 0 };
    }
    if (!response.ok) {
      return {
        ok: false,
        settled: true,
        retryable: response.status === 429 || response.status >= 500,
        state: "FAILED",
        reason: `Provider rejected the restricted request with status ${response.status}`,
        tokens: tokens ?? 0,
      };
    }
    if (tokens === null) {
      return { ok: false, settled: true, retryable: false, state: "UNKNOWN", reason: "Provider usage evidence is missing", tokens: 0 };
    }
    const timestamp = providerTime(payload);
    if (!timestamp) {
      return { ok: false, settled: true, retryable: false, state: "UNKNOWN", reason: "Provider timestamp is missing", tokens };
    }
    if (Math.abs(Date.now() - timestamp.getTime()) > MAX_PROVIDER_CLOCK_SKEW_MS) {
      return { ok: false, settled: true, retryable: false, state: "STALE", reason: "Provider timestamp is stale", providerTimestamp: timestamp, tokens };
    }
    const text = extractText(payload).trim();
    const responseId = typeof payload.id === "string" ? payload.id : "";
    if (!text || !responseId) {
      return { ok: false, settled: true, retryable: false, state: "UNKNOWN", reason: "Provider response evidence is incomplete", providerTimestamp: timestamp, tokens };
    }
    return { ok: true, settled: true, text, responseId, providerTimestamp: timestamp, tokens };
  } catch (error) {
    if (timeout) clearTimeout(timeout);
    return {
      ok: false,
      settled: false,
      retryable: false,
      state: "UNKNOWN",
      reason: error instanceof Error && error.message.includes("timeout")
        ? "Provider result is unsettled after timeout"
        : "Provider connection failed before a settled response",
      tokens: 0,
    };
  }
}