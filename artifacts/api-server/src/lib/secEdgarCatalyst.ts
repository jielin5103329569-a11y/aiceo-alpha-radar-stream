import { EventEmitter } from "node:events";

import type { CatalystEvent, CatalystRadarSnapshot, CatalystSourceStatus } from "./catalystRadar";
import { logger } from "./logger";
import { isTimelySec8K } from "./sec8kTimeliness";

export const SEC_EDGAR_COMPANIES = [
  { symbol: "NVDA", cik: "0001045810", company: "NVIDIA CORP" },
  { symbol: "MU", cik: "0000723125", company: "MICRON TECHNOLOGY INC" },
  { symbol: "VRT", cik: "0001674101", company: "Vertiv Holdings Co" },
  { symbol: "CRDO", cik: "0001807794", company: "Credo Technology Group Holding Ltd" },
  { symbol: "AMD", cik: "0000002488", company: "ADVANCED MICRO DEVICES INC" },
] as const;

const SOURCE = "SEC EDGAR";
const POLL_INTERVAL_MS = 5 * 60_000;
const EVENT_LOOKBACK_MS = 30 * 24 * 60 * 60_000;
const LAGGED_AFTER_MS = 15 * 60_000;
const INCLUDED_FORMS = new Set(["8-K", "10-Q", "10-K"]);

type SecRecentFilings = {
  accessionNumber?: unknown[];
  filingDate?: unknown[];
  acceptanceDateTime?: unknown[];
  form?: unknown[];
  primaryDocument?: unknown[];
};

type SecSubmission = {
  name?: unknown;
  filings?: { recent?: SecRecentFilings };
};

type FetchLike = typeof fetch;

export type SecEdgarEvent = CatalystEvent & {
  formType: "8-K" | "10-Q" | "10-K";
  accession: string;
  filingUrl: string;
  company: string;
  filedAt: Date;
  receivedAt: Date;
  lagged: boolean;
};

function stringAt(values: unknown[] | undefined, index: number): string | null {
  const value = values?.[index];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseSecTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
  const parsed = compact
    ? new Date(`${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseSecEdgarEvents(
  company: (typeof SEC_EDGAR_COMPANIES)[number],
  submission: SecSubmission,
  receivedAt: Date,
): SecEdgarEvent[] {
  const recent = submission.filings?.recent;
  const count = recent?.form?.length ?? 0;
  const events: SecEdgarEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const form = stringAt(recent?.form, index);
    if (!form || !INCLUDED_FORMS.has(form)) continue;
    const accession = stringAt(recent?.accessionNumber, index);
    const primaryDocument = stringAt(recent?.primaryDocument, index);
    const filedAt = parseSecTimestamp(
      stringAt(recent?.acceptanceDateTime, index)
      ?? stringAt(recent?.filingDate, index),
    );
    if (!accession || !primaryDocument || !filedAt) continue;
    const ageMs = receivedAt.getTime() - filedAt.getTime();
    if (ageMs < 0 || ageMs > EVENT_LOOKBACK_MS) continue;
    const lagged = ageMs > LAGGED_AFTER_MS;
    const isSignalEligibleForm = form === "8-K";
    const freshness = isSignalEligibleForm && isTimelySec8K(filedAt, receivedAt)
      ? "fresh"
      : isSignalEligibleForm
        ? "delayed"
        : "insufficient";
    const accessionPath = accession.replaceAll("-", "");
    const filingUrl = `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${accessionPath}/${primaryDocument}`;
    const companyName = typeof submission.name === "string" && submission.name.length > 0
      ? submission.name
      : company.company;
    events.push({
      id: `sec-edgar:${accession}`,
      symbol: company.symbol,
      category: "sec_filing",
      observedAt: filedAt,
      freshness,
      source: SOURCE,
      summary: `${form} filing for ${companyName}.`,
      dataQuality: "good",
      formType: form as SecEdgarEvent["formType"],
      accession,
      filingUrl,
      company: companyName,
      filedAt,
      receivedAt,
      lagged,
    });
  }
  return events.sort((left, right) => {
    const formPriority = (event: SecEdgarEvent) => event.formType === "8-K" ? 0 : 1;
    return formPriority(left) - formPriority(right)
      || right.filedAt.getTime() - left.filedAt.getTime();
  });
}

function unconfiguredStatuses(): CatalystSourceStatus[] {
  return [
    ["company_news", "Company news"],
    ["earnings_guidance", "Earnings / guidance"],
    ["fda_clinical_regulatory", "FDA / clinical / regulatory"],
    ["partnership_order_ma", "Partnership / order / M&A"],
  ].map(([category, label]) => ({
    category: category as CatalystSourceStatus["category"],
    label,
    availability: "unavailable",
    authorized: false,
    source: null,
    freshness: "missing",
    dataQuality: "unavailable",
    lastEventAt: null,
    reason: "No authorized external source is configured; no catalyst event is being inferred.",
    readiness: "unconfigured",
    nextAction: "Connect and authorize a source for this category. Configuration alone will not create or satisfy a catalyst event.",
  }));
}

export class SecEdgarCatalystService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private events: SecEdgarEvent[] = [];
  private lastPollAt: Date | null = null;
  private lastError: string | null = null;

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(fetcher: FetchLike = fetch, now = new Date()): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const collected: SecEdgarEvent[] = [];
      for (const company of SEC_EDGAR_COMPANIES) {
        const response = await fetcher(`https://data.sec.gov/submissions/CIK${company.cik}.json`, {
          headers: {
            Accept: "application/json",
            "User-Agent": "AlphaRadar/1.0 (bounded SEC EDGAR filings monitor)",
          },
        });
        if (!response.ok) throw new Error(`SEC EDGAR returned HTTP ${response.status}.`);
        collected.push(...parseSecEdgarEvents(company, await response.json() as SecSubmission, now));
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      this.events = collected;
      this.lastPollAt = now;
      this.lastError = null;
      this.emit("status");
    } catch (error) {
      this.events = [];
      this.lastPollAt = now;
      this.lastError = error instanceof Error ? error.message : "SEC EDGAR request failed.";
      logger.warn({ error: this.lastError }, "SEC EDGAR catalyst poll failed closed");
      this.emit("status");
    } finally {
      this.polling = false;
    }
  }

  getSnapshot(now = new Date()): CatalystRadarSnapshot {
    const pollFresh = this.lastPollAt !== null
      && now.getTime() - this.lastPollAt.getTime() <= POLL_INTERVAL_MS * 2;
    const available = this.lastError === null && pollFresh;
    const events = available ? this.events : [];
    const secStatus: CatalystSourceStatus = {
      category: "sec_filing",
      label: "SEC filing",
      availability: available ? "available" : this.lastError ? "blocked" : "unavailable",
      authorized: true,
      source: SOURCE,
      freshness: available ? "fresh" : this.lastError ? "missing" : "stale",
      dataQuality: available ? "good" : "unavailable",
      lastEventAt: events[0]?.filedAt ?? null,
      reason: available
        ? events.length > 0
          ? "Real recent SEC EDGAR filing metadata is available; no filing text or trade signal is inferred."
          : "SEC EDGAR is connected, but no recent 8-K, 10-Q, or 10-K filing exists for the monitored symbols."
        : this.lastError ?? "Awaiting the first SEC EDGAR poll; configuration alone does not create an event.",
      readiness: available ? "ready" : this.lastError ? "blocked" : "stale",
      nextAction: available
        ? "Continue bounded polling. Only a timely real 8-K can satisfy the catalyst evidence gate."
        : "Wait for a successful SEC EDGAR metadata poll.",
    };
    return {
      generatedAt: now,
      eventState: events.length > 0 ? "observed" : "unavailable",
      sourceCount: 5,
      availableSourceCount: available ? 1 : 0,
      sourceStatuses: [...unconfiguredStatuses(), secStatus],
      events,
      reason: events.length > 0
        ? "Catalyst Radar shows only real SEC EDGAR filing metadata; 10-Q and 10-K records are filings, not trade signals."
        : "No recent SEC EDGAR filing event is available; catalyst confirmation remains fail-closed.",
    };
  }
}

export const secEdgarCatalyst = new SecEdgarCatalystService();