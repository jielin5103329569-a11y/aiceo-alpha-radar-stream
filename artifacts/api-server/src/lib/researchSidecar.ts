import {
  db,
  researchObservationEventsTable,
  researchResonanceTable,
  type ResearchTickerIdentity,
  type ResearchObservationEvent,
  type ResearchResonance,
} from "@workspace/db";
import { asc, desc, eq, ne } from "drizzle-orm";
import { createHash } from "node:crypto";

export const RESEARCH_SIDECAR_LANES = ["alex_moonvest", "serenity"] as const;
export type ResearchSidecarLane = (typeof RESEARCH_SIDECAR_LANES)[number];

export type DerivedResearchResonance = {
  leftObservationId: string;
  rightObservationId: string;
  sourceLanes: ResearchSidecarLane[];
  resonanceBasis: "us_ticker" | "industry_chain";
  admittedUsTicker: string | null;
  canonicalIndustryChainKey: string | null;
};

const unavailable = "unavailable";
const admittedExchanges = new Set(["NYSE", "NASDAQ", "NYSE AMERICAN"]);
const admittedSecurityTypes = new Set(["common_equity", "class_a_ordinary_share"]);

export type ResearchObservationInput = {
  sourceLane: ResearchSidecarLane;
  source: string;
  sourceReference: string;
  observedDate: string;
  ticker?: string | null;
  tickerIdentity: ResearchTickerIdentity;
  viewpoint: string;
  thesis: string;
  valuationReversalBasis?: string;
  financials?: string;
  buybacks?: string;
  cashBalanceSheet?: string;
  catalysts?: string;
  risks?: string;
  outcomes?: string;
  industryChainTags?: string[];
  canonicalIndustryChainKey?: string;
  confidence?: string;
};

export type NormalizedResearchObservation = {
  sourceLane: ResearchSidecarLane;
  source: string;
  sourceReference: string;
  observedDate: string;
  ticker: string | null;
  tickerIdentity: ResearchTickerIdentity;
  tickerIdentityState: "overseas_reference" | "us_watch";
  usTickerAdmission: "not_admitted" | "admitted";
  usTickerIdentityEvidence: string;
  viewpoint: string;
  thesis: string;
  valuationReversalBasis: string;
  financials: string;
  buybacks: string;
  cashBalanceSheet: string;
  catalysts: string;
  risks: string;
  outcomes: string;
  industryChainTags: string[];
  canonicalIndustryChainKey: string;
  confidence: string;
};

export class ResearchObservationValidationError extends Error {}
export class ResearchObservationConflictError extends Error {}

function normalizedText(value: string | undefined, field: string): string {
  const result = value?.trim() ?? "";
  if (!result) throw new ResearchObservationValidationError(`${field} is required`);
  return result;
}

function unavailableText(value: string | undefined): string {
  const result = value?.trim() ?? "";
  return result || unavailable;
}

function hasIdentityReference(value: string): boolean {
  return value !== "" && value.toLowerCase() !== unavailable;
}

export function normalizeResearchObservationInput(
  input: ResearchObservationInput,
): NormalizedResearchObservation {
  const ticker = input.ticker?.trim().toUpperCase() || null;
  const identity: ResearchTickerIdentity = {
    exchange: normalizedText(input.tickerIdentity.exchange, "tickerIdentity.exchange").toUpperCase(),
    lifecycleStatus: normalizedText(input.tickerIdentity.lifecycleStatus, "tickerIdentity.lifecycleStatus").toLowerCase(),
    securityType: normalizedText(input.tickerIdentity.securityType, "tickerIdentity.securityType")
      .toLowerCase()
      .replaceAll(" ", "_")
      .replace(/^class_a_ordinary_shares$/, "class_a_ordinary_share"),
    identitySourceReference: normalizedText(
      input.tickerIdentity.identitySourceReference,
      "tickerIdentity.identitySourceReference",
    ),
    verificationAccessDate: normalizedText(
      input.tickerIdentity.verificationAccessDate,
      "tickerIdentity.verificationAccessDate",
    ),
  };
  const canAdmitUsWatch =
    ticker !== null &&
    admittedExchanges.has(identity.exchange) &&
    identity.lifecycleStatus === "active" &&
    admittedSecurityTypes.has(identity.securityType) &&
    hasIdentityReference(identity.identitySourceReference);
  const canonicalTags = [...new Set(
    (input.industryChainTags ?? []).map((tag) => tag.trim()).filter(Boolean),
  )].sort();
  return {
    sourceLane: input.sourceLane,
    source: normalizedText(input.source, "source"),
    sourceReference: normalizedText(input.sourceReference, "sourceReference"),
    observedDate: normalizedText(input.observedDate, "observedDate"),
    ticker,
    tickerIdentity: identity,
    tickerIdentityState: canAdmitUsWatch ? "us_watch" : "overseas_reference",
    usTickerAdmission: canAdmitUsWatch ? "admitted" : "not_admitted",
    usTickerIdentityEvidence: canAdmitUsWatch
      ? `Active ${identity.exchange} ${identity.securityType} identity verified from ${identity.identitySourceReference}.`
      : "No admitted active US common-equity identity; retained as an overseas research reference.",
    viewpoint: normalizedText(input.viewpoint, "viewpoint"),
    thesis: normalizedText(input.thesis, "thesis"),
    valuationReversalBasis: unavailableText(input.valuationReversalBasis),
    financials: unavailableText(input.financials),
    buybacks: unavailableText(input.buybacks),
    cashBalanceSheet: unavailableText(input.cashBalanceSheet),
    catalysts: unavailableText(input.catalysts),
    risks: unavailableText(input.risks),
    outcomes: unavailableText(input.outcomes),
    industryChainTags: canonicalTags.length > 0 ? canonicalTags : [unavailable],
    canonicalIndustryChainKey: unavailableText(input.canonicalIndustryChainKey),
    confidence: unavailableText(input.confidence),
  };
}

function canonicalIdentityEnvelope(input: NormalizedResearchObservation) {
  return {
    sourceLane: input.sourceLane,
    source: input.source,
    sourceReference: input.sourceReference,
    observedDate: input.observedDate,
    ticker: input.ticker,
  };
}

export function canonicalResearchObservationEnvelope(input: NormalizedResearchObservation) {
  return {
    ...canonicalIdentityEnvelope(input),
    tickerIdentity: input.tickerIdentity,
    tickerIdentityState: input.tickerIdentityState,
    usTickerAdmission: input.usTickerAdmission,
    usTickerIdentityEvidence: input.usTickerIdentityEvidence,
    viewpoint: input.viewpoint,
    thesis: input.thesis,
    valuationReversalBasis: input.valuationReversalBasis,
    financials: input.financials,
    buybacks: input.buybacks,
    cashBalanceSheet: input.cashBalanceSheet,
    catalysts: input.catalysts,
    risks: input.risks,
    outcomes: input.outcomes,
    industryChainTags: input.industryChainTags,
    canonicalIndustryChainKey: input.canonicalIndustryChainKey,
    confidence: input.confidence,
  };
}

export function hashResearchObservation(input: NormalizedResearchObservation): string {
  return createHash("sha256").update(JSON.stringify(canonicalResearchObservationEnvelope(input))).digest("hex");
}

function eventKeyForObservation(input: NormalizedResearchObservation): string {
  return `research:${createHash("sha256").update(JSON.stringify(canonicalIdentityEnvelope(input))).digest("hex")}`;
}

function isAdmittedUsTicker(observation: ResearchObservationEvent): boolean {
  return (
    observation.tickerIdentityState === "us_watch" &&
    observation.usTickerAdmission === "admitted" &&
    observation.ticker !== null &&
    observation.ticker !== unavailable
  );
}

/**
 * Pure derivation used by the sidecar only. It intentionally rejects same-lane
 * pairs and never treats an overseas reference as a US ticker admission.
 */
export function deriveResearchResonances(
  observations: ResearchObservationEvent[],
): DerivedResearchResonance[] {
  const derived: DerivedResearchResonance[] = [];
  for (let leftIndex = 0; leftIndex < observations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < observations.length; rightIndex += 1) {
      const left = observations[leftIndex];
      const right = observations[rightIndex];
      if (left.sourceLane === right.sourceLane) continue;

      if (isAdmittedUsTicker(left) && isAdmittedUsTicker(right) && left.ticker === right.ticker) {
        derived.push({
          leftObservationId: left.id,
          rightObservationId: right.id,
          sourceLanes: [left.sourceLane as ResearchSidecarLane, right.sourceLane as ResearchSidecarLane],
          resonanceBasis: "us_ticker",
          admittedUsTicker: left.ticker,
          canonicalIndustryChainKey: null,
        });
        continue;
      }

      if (
        left.canonicalIndustryChainKey !== unavailable &&
        left.canonicalIndustryChainKey !== "" &&
        left.canonicalIndustryChainKey === right.canonicalIndustryChainKey
      ) {
        derived.push({
          leftObservationId: left.id,
          rightObservationId: right.id,
          sourceLanes: [left.sourceLane as ResearchSidecarLane, right.sourceLane as ResearchSidecarLane],
          resonanceBasis: "industry_chain",
          admittedUsTicker: null,
          canonicalIndustryChainKey: left.canonicalIndustryChainKey,
        });
      }
    }
  }
  return derived;
}

function asHistoryItem(
  observation: ResearchObservationEvent,
): ResearchObservationEvent {
  return observation;
}

export type ResearchSidecarSnapshot = {
  status: "ready";
  generatedAt: Date;
  lanes: ResearchSidecarLane[];
  observations: ResearchObservationEvent[];
  resonances: ResearchResonance[];
  reason: string;
};

export type ResearchSidecarDegraded = {
  status: "degraded";
  generatedAt: Date;
  lanes: ResearchSidecarLane[];
  observations: [];
  resonances: [];
  reason: string;
};

export type ResearchSidecarHistory = {
  status: "ready";
  lanes: ResearchSidecarLane[];
  events: ResearchObservationEvent[];
  resonances: ResearchResonance[];
  reason: string;
};

function resonanceForPair(
  left: ResearchObservationEvent,
  right: ResearchObservationEvent,
): DerivedResearchResonance[] {
  const [first, second] = left.id < right.id ? [left, right] : [right, left];
  return deriveResearchResonances([first, second]).map((resonance) => ({
    ...resonance,
    leftObservationId: first.id,
    rightObservationId: second.id,
    sourceLanes: [
      first.sourceLane as ResearchSidecarLane,
      second.sourceLane as ResearchSidecarLane,
    ],
  }));
}

export type AppendResearchObservationResult = {
  observation: ResearchObservationEvent;
  resonances: ResearchResonance[];
  idempotent: boolean;
};

export class ResearchSidecarService {
  async appendObservation(input: ResearchObservationInput): Promise<AppendResearchObservationResult> {
    const normalized = normalizeResearchObservationInput(input);
    const eventKey = eventKeyForObservation(normalized);
    const recordHash = hashResearchObservation(normalized);
    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(researchObservationEventsTable)
        .values({
          eventKey,
          recordVersion: 1,
          recordHash,
          sourceLane: normalized.sourceLane,
          source: normalized.source,
          researchOnlyLabel: `research_only_${normalized.sourceLane}_observation`,
          ticker: normalized.ticker,
          tickerIdentity: normalized.tickerIdentity,
          tickerIdentityState: normalized.tickerIdentityState,
          usTickerAdmission: normalized.usTickerAdmission,
          usTickerIdentityEvidence: normalized.usTickerIdentityEvidence,
          viewpoint: normalized.viewpoint,
          thesis: normalized.thesis,
          valuationReversalBasis: normalized.valuationReversalBasis,
          financials: normalized.financials,
          buybacks: normalized.buybacks,
          cashBalanceSheet: normalized.cashBalanceSheet,
          catalysts: normalized.catalysts,
          risks: normalized.risks,
          outcomes: normalized.outcomes,
          industryChainTags: normalized.industryChainTags,
          canonicalIndustryChainKey: normalized.canonicalIndustryChainKey,
          observedDate: normalized.observedDate,
          confidence: normalized.confidence,
          sourceReference: normalized.sourceReference,
          evidence: {
            identitySourceReference: normalized.tickerIdentity.identitySourceReference,
            verificationAccessDate: normalized.tickerIdentity.verificationAccessDate,
            listingTreatment: normalized.tickerIdentityState,
            researchOnly: true,
          },
        })
        .onConflictDoNothing({ target: researchObservationEventsTable.eventKey })
        .returning();
      let observation = inserted[0];
      let idempotent = false;
      if (!observation) {
        const existing = await tx
          .select()
          .from(researchObservationEventsTable)
          .where(eq(researchObservationEventsTable.eventKey, eventKey))
          .limit(1);
        observation = existing[0];
        if (!observation) throw new Error("Observation insert was not visible after conflict.");
        if (observation.recordHash !== recordHash) {
          throw new ResearchObservationConflictError(
            "An observation with this event identity already exists with conflicting content.",
          );
        }
        idempotent = true;
      }

      const oppositeLaneEvents = await tx
        .select()
        .from(researchObservationEventsTable)
        .where(ne(researchObservationEventsTable.sourceLane, observation.sourceLane));
      const persistedResonances: ResearchResonance[] = [];
      for (const opposite of oppositeLaneEvents) {
        for (const derived of resonanceForPair(observation, opposite)) {
          const resonanceKey = `research:${derived.resonanceBasis}:${derived.leftObservationId}:${derived.rightObservationId}`;
          const [persisted] = await tx
            .insert(researchResonanceTable)
            .values({
              resonanceKey,
              recordVersion: 1,
              recordHash: hashDerivedResearchResonance(derived),
              leftObservationId: derived.leftObservationId,
              rightObservationId: derived.rightObservationId,
              sourceLanes: derived.sourceLanes,
              resonanceBasis: derived.resonanceBasis,
              admittedUsTicker: derived.admittedUsTicker,
              canonicalIndustryChainKey: derived.canonicalIndustryChainKey,
              derivedAt: new Date(),
            })
            .onConflictDoNothing({ target: researchResonanceTable.resonanceKey })
            .returning();
          if (persisted) persistedResonances.push(persisted);
        }
      }
      return { observation, resonances: persistedResonances, idempotent };
    });
  }

  async getSnapshot(): Promise<ResearchSidecarSnapshot> {
    const [observations, resonances] = await Promise.all([
      db
        .select()
        .from(researchObservationEventsTable)
        .orderBy(desc(researchObservationEventsTable.observedDate), asc(researchObservationEventsTable.eventKey)),
      db
        .select()
        .from(researchResonanceTable)
        .orderBy(desc(researchResonanceTable.derivedAt)),
    ]);
    return {
      status: "ready",
      generatedAt: new Date(),
      lanes: [...RESEARCH_SIDECAR_LANES],
      observations,
      resonances,
      reason: "Research-only observation snapshot; it has no production decision authority.",
    };
  }

  async listHistory(limit: number): Promise<ResearchSidecarHistory> {
    const [events, resonances] = await Promise.all([
      db
        .select()
        .from(researchObservationEventsTable)
        .orderBy(desc(researchObservationEventsTable.observedDate), desc(researchObservationEventsTable.createdAt))
        .limit(limit),
      db
        .select()
        .from(researchResonanceTable)
        .orderBy(desc(researchResonanceTable.derivedAt))
        .limit(limit),
    ]);
    return {
      status: "ready",
      lanes: [...RESEARCH_SIDECAR_LANES],
      events: events.map(asHistoryItem),
      resonances,
      reason: "Append-only research observation and derived resonance history.",
    };
  }
}

export const researchSidecar = new ResearchSidecarService();

export function hashDerivedResearchResonance(
  resonance: DerivedResearchResonance,
): string {
  return createHash("sha256")
    .update(JSON.stringify(resonance))
    .digest("hex");
}

export const RESEARCH_SIDECAR_UNAVAILABLE_REASON =
  "Research sidecar storage is unavailable; Alpha Radar and production workflows are unaffected.";

export function degradedResearchSidecarSnapshot(): ResearchSidecarDegraded {
  return {
    status: "degraded",
    generatedAt: new Date(),
    lanes: [...RESEARCH_SIDECAR_LANES],
    observations: [],
    resonances: [],
    reason: RESEARCH_SIDECAR_UNAVAILABLE_REASON,
  };
}