import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  aiceoCapabilityPerformanceLedgerTable,
  aiceoCapabilityRoutingDecisionsTable,
  aiceoContinuityStateTable,
  aiceoExecutionContractsTable,
  aiceoExecutionGovernanceLifecycleTable,
  aiceoFirstResolutionObligationsTable,
} from "@workspace/db/schema";
import { assertCredentialPersistenceSafe } from "./aiceoCredentialPersistenceFirewall";

export const EG001_VERSION = "EG-001";
export const EG001_STATES = ["ACCEPTED", "VERIFIED", "CLOSED", "ROLLED_BACK", "REOPENED"] as const;
type GovernanceState = (typeof EG001_STATES)[number];

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const legacyDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const safe = (value: unknown, max = 2_000) => String(value).replace(/[\r\n]/g, " ").slice(0, max);
const nonEmpty = (value: unknown, label: string) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`EG-001 ${label} is required`);
  return safe(text);
};

type Candidate = { adapter: string; version: string; capability?: string };

function transitionAllowed(from: GovernanceState | null, to: GovernanceState): boolean {
  if (!from) return to === "ACCEPTED";
  if (from === "ACCEPTED") return to === "VERIFIED";
  if (from === "VERIFIED") return to === "CLOSED" || to === "ROLLED_BACK";
  if (from === "CLOSED") return to === "ROLLED_BACK";
  if (from === "ROLLED_BACK") return to === "REOPENED";
  return false;
}

export class AiceoExecutionGovernanceV1 {
  constructor(private readonly tx: any) {}

  private async binding(contractId: string) {
    const contract = (await this.tx.select().from(aiceoExecutionContractsTable)
      .where(eq(aiceoExecutionContractsTable.id, contractId)).for("update"))[0];
    const state = (await this.tx.select().from(aiceoContinuityStateTable).limit(1))[0];
    if (!contract || !state || contract.continuityRevision !== state.revision
      || contract.contextHash !== this.contextHash(state)
      || contract.productionAuthority) {
      throw new Error("EG-001 contract/context binding is stale or has production authority");
    }
    return { contract, state };
  }

  private contextHash(state: any): string {
    return legacyDigest({ revision: state.revision, state: state.currentState, rules: state.decisionRuleRegistry });
  }

  async route(input: {
    contractId: string;
    runId: string;
    capability: string;
    candidates?: Candidate[];
    policyHash?: string;
    idempotencyKey: string;
  }) {
    const { contract, state } = await this.binding(input.contractId);
    const expectedPolicyHash = digest({
      governanceVersion: EG001_VERSION,
      contractHash: contract.contractHash,
      contextHash: contract.contextHash,
      frozenRules: contract.frozenRules,
    });
    if (input.policyHash && !/^[a-f0-9]{64}$/.test(input.policyHash)) {
      throw new Error("EG-001 policyHash must be a SHA-256 digest");
    }
    if (input.policyHash && input.policyHash !== expectedPolicyHash) {
      throw new Error("EG-001 policyHash is not bound to contract/context/frozen rules");
    }
    const policyHash = input.policyHash ?? expectedPolicyHash;
    const candidates = (input.candidates ?? [{ adapter: "execution-protocol", version: EG001_VERSION }])
      .map((candidate) => ({ adapter: safe(candidate.adapter, 180), version: safe(candidate.version, 80), capability: candidate.capability ?? input.capability }))
      .filter((candidate) => candidate.adapter && candidate.version);
    if (!candidates.length) throw new Error("EG-001 capability routing requires a candidate");
    const historical = await this.tx.select({
      adapter: aiceoCapabilityPerformanceLedgerTable.adapter,
      adapterVersion: aiceoCapabilityPerformanceLedgerTable.adapterVersion,
      firstResolution: aiceoCapabilityPerformanceLedgerTable.firstResolution,
      independentlyVerified: aiceoCapabilityPerformanceLedgerTable.independentlyVerified,
    }).from(aiceoCapabilityPerformanceLedgerTable)
      .where(eq(aiceoCapabilityPerformanceLedgerTable.capability, input.capability))
      .orderBy(desc(aiceoCapabilityPerformanceLedgerTable.createdAt));
    const metrics = (candidate: Candidate) => historical
      .filter((row: any) => row.adapter === candidate.adapter && row.adapterVersion === candidate.version)
      .reduce((metric: any, row: any) => ({
        events: metric.events + 1,
        verified: metric.verified + (row.independentlyVerified ? 1 : 0),
        firstResolution: metric.firstResolution + (row.firstResolution ? 1 : 0),
      }), { events: 0, verified: 0, firstResolution: 0 });
    const score = (candidate: Candidate) => {
      const metric = metrics(candidate);
      return metric.verified * 3 + metric.firstResolution * 2 - metric.events;
    };
    const ordered = [...candidates].sort((a, b) =>
      score(b) - score(a) || a.adapter.localeCompare(b.adapter) || a.version.localeCompare(b.version));
    const selected = ordered[0];
    const selectedMetric = metrics(selected);
    const noHistory = selectedMetric.events === 0 && ordered.every((candidate) => metrics(candidate).events === 0);
    const tie = ordered.length > 1 && score(ordered[0]) === score(ordered[1]);
    const rejectedCandidates = ordered.slice(1).map((candidate) => ({
      adapter: candidate.adapter,
      version: candidate.version,
      reason: score(candidate) === score(selected)
        ? `deterministic lexical tie-break; no capability-performance advantage (score ${score(candidate)})`
        : `lower capability-performance score (${score(candidate)} < ${score(selected)})`,
      selectionBasis: "performance-evidence",
      metrics: metrics(candidate),
    }));
    const decisionHash = digest({
      contractId: input.contractId,
      runId: input.runId,
      capability: input.capability,
      selected,
      rejectedCandidates,
      contractRevision: contract.continuityRevision,
      contextHash: contract.contextHash,
      policyHash,
      selectionMetrics: {
        selected: { ...selectedMetric, score: score(selected) },
        noHistory,
        tie,
        historicalEvents: historical.length,
        deterministicBasis: "capability-performance-only",
      },
    });
    const old = (await this.tx.select().from(aiceoCapabilityRoutingDecisionsTable)
      .where(and(
        eq(aiceoCapabilityRoutingDecisionsTable.contractId, input.contractId),
        eq(aiceoCapabilityRoutingDecisionsTable.idempotencyKey, input.idempotencyKey),
      )).limit(1))[0];
    if (old) {
      if (old.decisionHash !== decisionHash) throw new Error("EG-001 routing decision idempotency conflict");
      return old;
    }
    assertCredentialPersistenceSafe({ selected, rejectedCandidates }, "eg001-routing-decision");
    return (await this.tx.insert(aiceoCapabilityRoutingDecisionsTable).values({
      contractId: input.contractId,
      runId: input.runId,
      capability: safe(input.capability, 120),
      selectedAdapter: selected.adapter,
      adapterVersion: selected.version,
      rejectedCandidates,
      contractRevision: state.revision,
      contextHash: contract.contextHash,
      policyHash: safe(policyHash, 128),
      decisionHash,
      idempotencyKey: safe(input.idempotencyKey, 180),
      selectionMetrics: {
        selected: { ...selectedMetric, score: score(selected) },
        noHistory,
        tie,
        historicalEvents: historical.length,
        deterministicBasis: "capability-performance-only",
      },
      payloadHash: decisionHash,
      productionAuthority: false,
    }).returning())[0];
  }

  async obligation(input: {
    contractId: string; runId: string; rootCauseDiagnosis?: string; minimalEffectiveAction?: string;
    ownerActionBudget?: Record<string, unknown>;
  }) {
    const { contract } = await this.binding(input.contractId);
    const rootCauseDiagnosis = nonEmpty(input.rootCauseDiagnosis, "rootCauseDiagnosis");
    const minimalEffectiveAction = nonEmpty(input.minimalEffectiveAction, "minimalEffectiveAction");
    const ownerActionBudget = input.ownerActionBudget;
    if (!ownerActionBudget
      || typeof ownerActionBudget.maxOwnerInterruptions !== "number"
      || ownerActionBudget.maxOwnerInterruptions < 0
      || ownerActionBudget.maxOwnerInterruptions > 1
      || ownerActionBudget.mergeHumanActions !== true
      || ownerActionBudget.noScreenshotWhenAutoVerifiable !== true) {
      throw new Error("EG-001 owner action budget is missing or exceeds the protected budget");
    }
    const obligationKey = `eg001:${input.runId}`;
    const old = (await this.tx.select().from(aiceoFirstResolutionObligationsTable)
      .where(eq(aiceoFirstResolutionObligationsTable.obligationKey, obligationKey)).limit(1))[0];
    if (old) {
      if (
        old.contractId !== input.contractId
        || old.runId !== input.runId
        || old.contractRevision !== contract.continuityRevision
        || old.contextHash !== contract.contextHash
        || old.rootCauseDiagnosis !== rootCauseDiagnosis
        || old.minimalEffectiveAction !== minimalEffectiveAction
        || digest(old.ownerActionBudget) !== digest(ownerActionBudget)
      ) {
        throw new Error("EG-001 First-Resolution Obligation idempotency conflict");
      }
      return old;
    }
    assertCredentialPersistenceSafe(input, "eg001-first-resolution-obligation");
    return (await this.tx.insert(aiceoFirstResolutionObligationsTable).values({
      contractId: input.contractId,
      runId: input.runId,
      obligationKey,
      contractRevision: contract.continuityRevision,
      contextHash: contract.contextHash,
      rootCauseDiagnosis,
      minimalEffectiveAction,
      ownerActionBudget,
      productionAuthority: false,
    }).returning())[0];
  }

  async recordPerformance(input: {
    contractId: string; runId: string; routingDecisionId: string; eventType: "STARTED" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "RETRY" | "TIMEOUT" | "SCOPE_DRIFT" | "BUDGET_EXCEEDED";
    capability: string; adapter: string; adapterVersion: string; firstResolution?: boolean;
    independentlyVerified?: boolean; retryCount?: number; timeoutCount?: number; scopeDriftCount?: number;
    costMicrousd?: number; outcome: string; outcomeAttribution?: Record<string, unknown>; idempotencyKey: string;
  }) {
    const { contract } = await this.binding(input.contractId);
    const outcomeAttribution = input.outcomeAttribution ?? {
      source: "aiceo-agent-execution-protocol",
      governanceVersion: EG001_VERSION,
    };
    const payloadHash = digest({
      contractId: input.contractId, runId: input.runId, routingDecisionId: input.routingDecisionId,
      eventType: input.eventType, capability: input.capability, adapter: input.adapter,
      adapterVersion: input.adapterVersion, firstResolution: input.firstResolution ?? false,
      independentlyVerified: input.independentlyVerified ?? false, retryCount: input.retryCount ?? 0,
      timeoutCount: input.timeoutCount ?? 0, scopeDriftCount: input.scopeDriftCount ?? 0,
      costMicrousd: input.costMicrousd ?? 0, outcome: input.outcome,
      outcomeAttribution, idempotencyKey: input.idempotencyKey,
      contractRevision: contract.continuityRevision, contextHash: contract.contextHash,
    });
    const old = (await this.tx.select().from(aiceoCapabilityPerformanceLedgerTable)
      .where(and(
        eq(aiceoCapabilityPerformanceLedgerTable.runId, input.runId),
        eq(aiceoCapabilityPerformanceLedgerTable.idempotencyKey, input.idempotencyKey),
      )).limit(1))[0];
    if (old) {
      if (old.payloadHash !== payloadHash) throw new Error("EG-001 performance idempotency conflict");
      return old;
    }
    assertCredentialPersistenceSafe({ ...input, outcomeAttribution }, "eg001-performance-ledger");
    return (await this.tx.insert(aiceoCapabilityPerformanceLedgerTable).values({
      contractId: input.contractId,
      runId: input.runId,
      routingDecisionId: input.routingDecisionId,
      eventType: input.eventType,
      capability: safe(input.capability, 120),
      adapter: safe(input.adapter, 180),
      adapterVersion: safe(input.adapterVersion, 80),
      firstResolution: input.firstResolution ?? false,
      independentlyVerified: input.independentlyVerified ?? false,
      retryCount: Math.max(0, input.retryCount ?? 0),
      timeoutCount: Math.max(0, input.timeoutCount ?? 0),
      scopeDriftCount: Math.max(0, input.scopeDriftCount ?? 0),
      costMicrousd: Math.max(0, input.costMicrousd ?? 0),
      outcome: safe(input.outcome, 64),
      outcomeAttribution,
      idempotencyKey: safe(input.idempotencyKey, 180),
      payloadHash,
      productionAuthority: false,
    }).returning())[0];
  }

  private async currentLifecycle(runId: string) {
    const rows = await this.tx.select().from(aiceoExecutionGovernanceLifecycleTable)
      .where(eq(aiceoExecutionGovernanceLifecycleTable.runId, runId))
      .orderBy(desc(aiceoExecutionGovernanceLifecycleTable.createdAt));
    const referenced = new Set(rows.map((row: any) => row.previousHash).filter(Boolean));
    return (rows.find((row: any) => !referenced.has(row.payloadHash)) ?? rows[0]) as any;
  }

  async transition(input: {
    contractId: string; runId: string; contextHash: string; state: GovernanceState; eventKey: string;
    reason: string; evidence?: Record<string, unknown>[]; actorId: string;
  }) {
    const { contract } = await this.binding(input.contractId);
    if (contract.contextHash !== input.contextHash) throw new Error("EG-001 lifecycle context binding mismatch");
    const eventKey = safe(nonEmpty(input.eventKey, "lifecycle event key"), 180);
    const reason = nonEmpty(input.reason, "lifecycle reason");
    const actorId = safe(nonEmpty(input.actorId, "lifecycle actor"), 180);
    const old = (await this.tx.select().from(aiceoExecutionGovernanceLifecycleTable)
      .where(and(
        eq(aiceoExecutionGovernanceLifecycleTable.runId, input.runId),
        eq(aiceoExecutionGovernanceLifecycleTable.eventKey, eventKey),
      )).limit(1))[0];
    const current = await this.currentLifecycle(input.runId);
    const previousHash = old ? old.previousHash : (current?.payloadHash ?? null);
    const payloadHash = digest({
      contractId: input.contractId, runId: input.runId, state: input.state,
      previousState: old ? old.previousState : (current?.state ?? null), eventKey,
      contextHash: contract.contextHash, reason, evidence: input.evidence ?? [],
      actorId, previousHash,
    });
    if (old) {
      if (old.payloadHash !== payloadHash) throw new Error("EG-001 lifecycle idempotency conflict");
      return old;
    }
    if (!transitionAllowed(current?.state ?? null, input.state)) {
      throw new Error(`EG-001 illegal lifecycle transition ${current?.state ?? "NONE"} -> ${input.state}`);
    }
    assertCredentialPersistenceSafe({ ...input, reason, actorId }, "eg001-lifecycle");
    return (await this.tx.insert(aiceoExecutionGovernanceLifecycleTable).values({
      contractId: input.contractId,
      runId: input.runId,
      state: input.state,
      previousState: current?.state ?? null,
      eventKey,
      contextHash: contract.contextHash,
      reason,
      evidence: input.evidence ?? [],
      actorId,
      payloadHash,
      previousHash,
      productionAuthority: false,
    }).returning())[0];
  }

  async accept(input: { contractId: string; runId: string; contextHash: string; actorId: string; evidence?: Record<string, unknown>[] }) {
    return this.transition({
      ...input,
      state: "ACCEPTED",
      eventKey: `accepted:${input.runId}:initial`,
      reason: "Accepted after first result submission.",
    });
  }

  async markVerified(input: { contractId: string; runId: string; contextHash: string; actorId: string; passed: boolean; evidence?: Record<string, unknown>[] }) {
    const obligation = (await this.tx.select().from(aiceoFirstResolutionObligationsTable)
      .where(eq(aiceoFirstResolutionObligationsTable.runId, input.runId)).for("update"))[0];
    if (!input.passed) {
      await this.markUnresolved(input.runId, "Independent verification rejected the result.");
      return null;
    }
    if (!obligation || !obligation.firstSubmittedAt) throw new Error("EG-001 First-Resolution Obligation is not satisfied");
    const firstResolution = await this.isFirstResolution(input.runId);
    const now = new Date();
    await this.tx.update(aiceoFirstResolutionObligationsTable).set({
      firstResolvedAt: firstResolution ? (obligation.firstResolvedAt ?? now) : null,
      status: firstResolution ? "RESOLVED" : "UNRESOLVED",
      unresolvedReason: firstResolution ? null : "Verification passed after retry, timeout, or scope-drift evidence.",
      updatedAt: now,
    }).where(eq(aiceoFirstResolutionObligationsTable.id, obligation.id));
    return this.transition({ ...input, state: "VERIFIED", eventKey: `verified:${input.runId}`, reason: firstResolution
      ? "Independent verification passed and First-Resolution Obligation resolved."
      : "Independent verification passed, but First-Resolution Obligation remains unresolved due to adverse evidence." });
  }

  async isFirstResolution(runId: string) {
    const outcomes = await this.tx.select({
      eventType: aiceoCapabilityPerformanceLedgerTable.eventType,
      retryCount: aiceoCapabilityPerformanceLedgerTable.retryCount,
      timeoutCount: aiceoCapabilityPerformanceLedgerTable.timeoutCount,
      scopeDriftCount: aiceoCapabilityPerformanceLedgerTable.scopeDriftCount,
    }).from(aiceoCapabilityPerformanceLedgerTable)
      .where(eq(aiceoCapabilityPerformanceLedgerTable.runId, runId));
    const adverse = outcomes.filter((row: any) =>
      row.eventType === "RETRY" || row.eventType === "TIMEOUT" || row.eventType === "SCOPE_DRIFT"
      || row.retryCount > 0 || row.timeoutCount > 0 || row.scopeDriftCount > 0);
    return adverse.length === 0;
  }

  async markUnresolved(runId: string, reason: string) {
    const obligation = (await this.tx.select().from(aiceoFirstResolutionObligationsTable)
      .where(eq(aiceoFirstResolutionObligationsTable.runId, runId)).for("update"))[0];
    if (!obligation) throw new Error("EG-001 First-Resolution Obligation is missing");
    const unresolvedReason = nonEmpty(reason, "unresolved reason");
    await this.tx.update(aiceoFirstResolutionObligationsTable).set({
      status: "UNRESOLVED", unresolvedReason, updatedAt: new Date(),
    }).where(eq(aiceoFirstResolutionObligationsTable.id, obligation.id));
    return { ...obligation, status: "UNRESOLVED", unresolvedReason };
  }

  async markSubmitted(runId: string) {
    const obligation = (await this.tx.select().from(aiceoFirstResolutionObligationsTable)
      .where(eq(aiceoFirstResolutionObligationsTable.runId, runId)).for("update"))[0];
    if (!obligation) throw new Error("EG-001 First-Resolution Obligation is missing");
    if (!obligation.firstSubmittedAt) {
      await this.tx.update(aiceoFirstResolutionObligationsTable).set({
        firstSubmittedAt: new Date(), status: "SUBMITTED", updatedAt: new Date(),
      }).where(eq(aiceoFirstResolutionObligationsTable.id, obligation.id));
    }
    return obligation;
  }

  async close(input: { contractId: string; runId: string; contextHash: string; actorId: string; reason: string; evidence?: Record<string, unknown>[] }) {
    const obligation = (await this.tx.select().from(aiceoFirstResolutionObligationsTable)
      .where(eq(aiceoFirstResolutionObligationsTable.runId, input.runId)).for("update"))[0];
    if (!obligation || obligation.status !== "RESOLVED") throw new Error("EG-001 closure requires a resolved First-Resolution Obligation");
    return this.transition({ ...input, state: "CLOSED", eventKey: `closed:${input.runId}`, reason: input.reason });
  }

  async rollback(input: { contractId: string; runId: string; contextHash: string; actorId: string; reason: string; evidence?: Record<string, unknown>[] }) {
    nonEmpty(input.reason, "rollback reason");
    await this.markUnresolved(input.runId, input.reason);
    return this.transition({ ...input, state: "ROLLED_BACK", eventKey: `rollback:${input.runId}:${digest(input.reason).slice(0, 16)}`, reason: input.reason });
  }

  async reopen(input: { contractId: string; runId: string; contextHash: string; actorId: string; reason: string; evidence?: Record<string, unknown>[] }) {
    nonEmpty(input.reason, "reopen reason");
    await this.markUnresolved(input.runId, input.reason);
    return this.transition({ ...input, state: "REOPENED", eventKey: `reopened:${input.runId}:${digest(input.reason).slice(0, 16)}`, reason: input.reason });
  }
}