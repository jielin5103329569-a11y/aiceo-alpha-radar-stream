import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import {
  aiceoContextEvidenceEventsTable, aiceoControlStateTable, aiceoMemoryCandidatesTable,
  aiceoPreclassificationMemoryInboxTable, aiceoRetrievalDecisionsTable,
  aiceoRetrievalRequestsTable, aiceoRetrievalRunsTable, aiceoThoughtNodesTable, db,
  type AiceoEvidenceLineage,
} from "@workspace/db";
import type { AiceoRole } from "./aiceoAuthorization";
import { AiceoContinuityLayer } from "./aiceoContinuityLayer";
import { assertEvidenceValid } from "./aiceoMemory";
import { assertCredentialPersistenceSafe } from "./aiceoCredentialPersistenceFirewall";

const VERSION = "G1-002-RTR-1";
const ALLOWED_LAYERS = new Set(["working", "episodic", "semantic", "procedural"]);
const ALLOWED_TYPES = new Set(["observation", "interpretation", "hypothesis"]);
const THOUGHT_EPISTEMIC_BY_TYPE: Record<string, Set<string>> = {
  observation: new Set(["observed", "unverified"]),
  interpretation: new Set(["inferred", "unverified"]),
  hypothesis: new Set(["hypothesized", "proposed", "unverified"]),
};
const MAX_EVIDENCE_AGE_MS = 90 * 86_400_000;
const canonical = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]),
  );
  return value;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const signingSecret = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("G1-002 Retrieval Router signing authority is unavailable");
  return secret;
};
const hmac = (value: unknown) => createHmac("sha256", signingSecret())
  .update(JSON.stringify(canonical(value))).digest("hex");
const secureEqual = (actual: string, expected: string) => {
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
};
const textDigest = (value: string) => createHash("sha256").update(value).digest("hex");
const evidenceDigest = (lineage: AiceoEvidenceLineage[]) => textDigest(
  lineage.map((item) => item.evidenceHash).sort().join(":"),
);
export type RetrievalGrant = {
  subjectId: string;
  projectId: string;
  task: string;
  entities: string[];
  revision: number;
};
const grantPayload = (grant: RetrievalGrant) => ({
  subjectId: grant.subjectId,
  projectId: grant.projectId,
  task: grant.task,
  entities: [...grant.entities].sort((a, b) => a.localeCompare(b)),
  revision: grant.revision,
  grantsAuthority: false,
  productionAuthority: false,
});
const tokens = (value: string) => new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []);
const byteLength = (value: string) => Buffer.byteLength(value, "utf8");
const candidateSnapshot = (candidate: any) => canonical({
  candidateId: candidate.id,
  projectId: candidate.projectId,
  content: candidate.content,
  memoryLayer: candidate.memoryLayer,
  memoryType: candidate.memoryType,
  cognitiveState: candidate.cognitiveState,
  truthLevel: candidate.truthLevel,
  authorityLevel: candidate.authorityLevel,
  sourceActorId: candidate.sourceActorId,
  evidenceLineage: candidate.evidenceLineage,
  validFrom: candidate.validFrom,
  validUntil: candidate.validUntil,
  lifecycle: candidate.lifecycle,
  createdAt: candidate.createdAt,
  candidateOnly: true,
  operationalInput: false,
  grantsAuthority: false,
  productionAuthority: false,
}) as Record<string, unknown>;
const requestAuthPayload = (request: any) => ({
  id: request.id,
  projectId: request.projectId,
  idempotencyKey: request.idempotencyKey,
  requestedBy: request.requestedBy,
  requesterRole: request.requesterRole,
  purpose: request.purpose,
  task: request.task,
  intent: request.intent,
  entities: request.entities,
  query: request.query,
  requestedLayers: request.requestedLayers,
  requestedTypes: request.requestedTypes,
  maxItems: request.maxItems,
  maxBytes: request.maxBytes,
  scanLimit: request.scanLimit,
  persistentRevision: request.persistentRevision,
  verifiedResumeNode: request.verifiedResumeNode,
  grantSnapshot: request.grantSnapshot,
  grantHmac: request.grantHmac,
  operationalInput: false,
  stateOverrideAccepted: false,
  grantsAuthority: false,
  productionAuthority: false,
});
const decisionAuthPayload = (decision: any) => ({
  requestId: decision.requestId,
  projectId: decision.projectId,
  candidateId: decision.candidateId ?? null,
  thoughtNodeId: decision.thoughtNodeId ?? null,
  decision: decision.decision,
  reasonCode: decision.reasonCode,
  score: decision.score ?? null,
  scoreComponents: decision.scoreComponents,
  contentDigest: decision.contentDigest ?? null,
  evidenceDigest: decision.evidenceDigest ?? null,
  provenance: decision.provenance,
  candidateSnapshot: decision.candidateSnapshot ?? null,
  rankPosition: decision.rankPosition ?? null,
  bytesConsumed: decision.bytesConsumed,
  operationalInput: false,
  grantsAuthority: false,
  productionAuthority: false,
});

export type RetrievalInput = {
  projectId: string;
  idempotencyKey: string;
  purpose: "why_history_context";
  task: string;
  intent: string;
  entities: string[];
  query: string;
  requestedLayers?: string[];
  requestedTypes?: string[];
  maxItems: number;
  maxBytes: number;
  scanLimit: number;
  claimedPersistentRevision?: number;
  claimedResumeNode?: string;
};

type DecisionDraft = {
  candidateId?: string;
  thoughtNodeId?: string;
  decision: "included" | "excluded";
  reasonCode: string;
  score?: number;
  scoreComponents: Record<string, number>;
  contentDigest?: string;
  evidenceDigest?: string;
  provenance: Record<string, unknown>;
  candidateSnapshot?: Record<string, unknown>;
  rankPosition?: number;
  bytesConsumed: number;
};
type RetrievalDecisionRow = typeof aiceoRetrievalDecisionsTable.$inferSelect;

export class AiceoRetrievalRouter {
  constructor(private readonly database: any = db, private readonly existingTransaction = false) {}
  private transact<T>(work: (tx: any) => Promise<T>): Promise<T> {
    return this.existingTransaction ? work(this.database) : this.database.transaction(work);
  }

  private async responseFrom(tx: any, requestId: string, role: AiceoRole, viewerId: string) {
    const [request] = await tx.select().from(aiceoRetrievalRequestsTable)
      .where(eq(aiceoRetrievalRequestsTable.id, requestId)).limit(1);
    if (!request) throw new Error("Retrieval request not found");
    if (request.requestedBy !== viewerId) {
      throw new Error("Retrieval request is outside the requester's need-to-know boundary");
    }
    if (!secureEqual(request.requestHmac, hmac(requestAuthPayload(request)))) {
      throw new Error("Retrieval request HMAC is invalid; fail closed");
    }
    const decisions = await tx.select().from(aiceoRetrievalDecisionsTable)
      .where(eq(aiceoRetrievalDecisionsTable.requestId, request.id))
      .orderBy(asc(aiceoRetrievalDecisionsTable.appendSequence)) as RetrievalDecisionRow[];
    const [run] = await tx.select().from(aiceoRetrievalRunsTable)
      .where(eq(aiceoRetrievalRunsTable.requestId, request.id)).limit(1);
    if (!run) throw new Error("Retrieval run is incomplete; fail closed");
    let previous: string | null = null;
    for (const [index, decision] of decisions.entries()) {
      if (decision.appendSequence !== index + 1 || decision.previousHash !== previous) {
        throw new Error("Retrieval decision evidence chain is invalid; fail closed");
      }
      if (!secureEqual(decision.decisionHmac, hmac(decisionAuthPayload(decision)))) {
        throw new Error("Retrieval decision HMAC is invalid; fail closed");
      }
      previous = decision.decisionHash;
    }
    const signedIntent = {
      requestId: request.id,
      requestHash: request.requestHash,
      persistentRevision: request.persistentRevision,
      decisionHashes: decisions.map((decision) => decision.decisionHash),
      selectedCandidateIds: run.selectedCandidateIds,
      selectedCandidateSnapshots: decisions.filter((decision) => decision.decision === "included")
        .sort((a, b) => Number(a.rankPosition) - Number(b.rankPosition))
        .map((decision) => decision.candidateSnapshot),
      requestHmac: request.requestHmac,
      decisionHmacs: decisions.map((decision) => decision.decisionHmac),
      budget: run.budget,
      includedCount: run.includedCount,
      excludedCount: run.excludedCount,
      consumedBytes: run.consumedBytes,
      contextCompilerStatus: "DEFERRED",
      productionAuthority: false,
    };
    if (run.resultHash !== hash(signedIntent) || !secureEqual(run.responseHmac, hmac(signedIntent))) {
      throw new Error("Retrieval response evidence is invalid; fail closed");
    }
    const snapshot = await new AiceoContinuityLayer(tx, true).snapshot(role);
    const currentTask = String(snapshot.state.currentState.activeTask ?? snapshot.state.currentState.completedTask ?? "");
    if (snapshot.project.id !== request.projectId
      || snapshot.state.revision !== request.persistentRevision
      || currentTask !== request.task
      || JSON.stringify(canonical(snapshot.state.resumeNode)) !== JSON.stringify(canonical(request.verifiedResumeNode))) {
      throw new Error("Retrieval binding is stale against current Persistent State; fail closed");
    }
    return {
      version: VERSION,
      truthSource: "persistent_state",
      request: {
        id: request.id, purpose: request.purpose, task: request.task, intent: request.intent,
        entities: request.entities, query: request.query, requesterRole: request.requesterRole,
        persistentRevision: request.persistentRevision, persistentStateHash: request.persistentStateHash,
        verifiedResumeNode: request.verifiedResumeNode, requestHash: request.requestHash,
      },
      items: decisions.filter((decision) => decision.decision === "included").map((decision) => {
        const candidate = decision.candidateSnapshot as any;
        if (!candidate || candidate.candidateId !== decision.candidateId) {
          throw new Error("Included retrieval candidate snapshot is missing; fail closed");
        }
        return {
          candidateId: candidate.candidateId, thoughtNodeId: decision.thoughtNodeId ?? undefined,
          content: candidate.content, memoryLayer: candidate.memoryLayer, memoryType: candidate.memoryType,
          cognitiveState: candidate.cognitiveState, truthLevel: candidate.truthLevel,
          authorityLevel: candidate.authorityLevel, evidenceLineage: candidate.evidenceLineage,
          validFrom: candidate.validFrom, validUntil: candidate.validUntil,
          score: decision.score, rank: decision.rankPosition,
          candidateOnly: candidate.candidateOnly, operationalInput: candidate.operationalInput,
          grantsAuthority: candidate.grantsAuthority, productionAuthority: candidate.productionAuthority,
        };
      }),
      explain: decisions.map((decision) => ({
        candidateId: decision.candidateId, thoughtNodeId: decision.thoughtNodeId,
        decision: decision.decision, reason: decision.reasonCode, score: decision.score,
        scoreComponents: decision.scoreComponents, contentDigest: decision.contentDigest,
        evidenceDigest: decision.evidenceDigest, provenance: decision.provenance,
        rank: decision.rankPosition, bytesConsumed: decision.bytesConsumed,
      })),
      budget: run.budget,
      status: run.status,
      contextCompiler: {
        status: "DEFERRED", receivesRouterItemsOnly: true,
        mutatesPersistentState: false, grantsAuthority: false, productionAuthority: false,
      },
      stateOverrideAccepted: false,
      grantsAuthority: false,
      productionAuthority: false,
      resultHash: run.resultHash,
      responseHmac: run.responseHmac,
    };
  }

  async retrieve(input: RetrievalInput, requestedBy: string, role: AiceoRole, grants: RetrievalGrant[]) {
    assertCredentialPersistenceSafe({ input, requestedBy, grants }, "retrieval-request");
    return this.transact(async (tx) => {
      const [existing] = await tx.select().from(aiceoRetrievalRequestsTable)
        .where(and(eq(aiceoRetrievalRequestsTable.projectId, input.projectId),
          eq(aiceoRetrievalRequestsTable.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) {
        if (existing.requestedBy !== requestedBy || existing.requesterRole !== role) {
          throw new Error("Retrieval idempotency key belongs to a different requester or role");
        }
        return this.responseFrom(tx, existing.id, role, requestedBy);
      }
      const snapshot = await new AiceoContinuityLayer(tx, true).snapshot(role);
      const [control] = await tx.select().from(aiceoControlStateTable).limit(1).for("update");
      if (!control?.queueActive || control.killSwitch || control.circuitState !== "CLOSED") {
        throw new Error("Retrieval is blocked by Queue, Kill Switch, or Circuit Breaker");
      }
      if (snapshot.project.id !== input.projectId || snapshot.project.productionAuthority
        || snapshot.project.environment !== "development"
        || snapshot.project.authority !== "grok_restricted_development") {
        throw new Error("Retrieval project isolation or authority boundary failed");
      }
      const currentTask = String(snapshot.state.currentState.activeTask ?? snapshot.state.currentState.completedTask ?? "");
      if (!currentTask.startsWith("G1-002")) throw new Error("G1-002 Retrieval Router is not the current Persistent State task");
      if (input.task !== currentTask) throw new Error("Claimed task conflicts with Persistent State; fail closed");
      if (input.claimedPersistentRevision != null && input.claimedPersistentRevision !== snapshot.state.revision) {
        throw new Error("Claimed revision conflicts with Persistent State; fail closed");
      }
      if (input.claimedResumeNode != null && input.claimedResumeNode !== snapshot.state.resumeNode.node) {
        throw new Error("Claimed Resume Node conflicts with Persistent State; fail closed");
      }
      const grant = grants.find((candidate) =>
        candidate.subjectId === requestedBy
        && candidate.projectId === input.projectId
        && candidate.task === currentTask
        && candidate.revision === snapshot.state.revision
        && input.entities.every((entity) => candidate.entities.includes(entity)));
      if (!input.entities.length || !grant) {
        throw new Error("Retrieval entity is outside the current task need-to-know scope");
      }
      const signedGrant = grantPayload(grant);
      const requestedLayers = input.requestedLayers?.length ? input.requestedLayers : [...ALLOWED_LAYERS];
      const requestedTypes = input.requestedTypes?.length ? input.requestedTypes : [...ALLOWED_TYPES];
      if (requestedLayers.some((item) => !ALLOWED_LAYERS.has(item))
        || requestedTypes.some((item) => !ALLOWED_TYPES.has(item))) {
        throw new Error("Requested memory scope includes deferred, governance, or unsupported memory");
      }
      const requestId = randomUUID();
      const requestDraft = {
        id: requestId, projectId: input.projectId, idempotencyKey: input.idempotencyKey,
        requestedBy: requestedBy.slice(0, 180), requesterRole: role, purpose: input.purpose,
        task: input.task, intent: input.intent, entities: input.entities, query: input.query,
        requestedLayers, requestedTypes, maxItems: input.maxItems, maxBytes: input.maxBytes,
        scanLimit: input.scanLimit, persistentRevision: snapshot.state.revision,
        verifiedResumeNode: snapshot.state.resumeNode,
        grantSnapshot: signedGrant, grantHmac: hmac(signedGrant),
      };
      const [request] = await tx.insert(aiceoRetrievalRequestsTable).values({
        id: requestId,
        projectId: input.projectId, idempotencyKey: input.idempotencyKey,
        requestedBy: requestedBy.slice(0, 180), requesterRole: role, purpose: input.purpose,
        task: input.task, intent: input.intent, entities: input.entities, query: input.query,
        requestedLayers, requestedTypes, maxItems: input.maxItems, maxBytes: input.maxBytes,
        scanLimit: input.scanLimit, persistentRevision: 0, persistentStateHash: "db-owned",
        verifiedResumeNode: {}, requestHash: "db-owned", requestHmac: hmac(requestAuthPayload(requestDraft)),
        grantSnapshot: signedGrant, grantHmac: hmac(signedGrant),
        appendSequence: 0,
        requestEventHash: "db-owned", operationalInput: false, stateOverrideAccepted: false,
        grantsAuthority: false, productionAuthority: false,
      }).returning();
      const candidates = await tx.select().from(aiceoMemoryCandidatesTable)
        .where(eq(aiceoMemoryCandidatesTable.projectId, input.projectId))
        .orderBy(desc(aiceoMemoryCandidatesTable.createdAt), asc(aiceoMemoryCandidatesTable.id))
        .limit(input.scanLimit);
      const [candidateTotal] = await tx.select({ value: count() }).from(aiceoMemoryCandidatesTable)
        .where(eq(aiceoMemoryCandidatesTable.projectId, input.projectId));
      const scanLimitExceeded = Number(candidateTotal.value) > candidates.length;
      const thoughtNodes = await tx.select().from(aiceoThoughtNodesTable)
        .where(eq(aiceoThoughtNodesTable.projectId, input.projectId));
      const nodeByCandidate = new Map(thoughtNodes.map((node: any) => [node.memoryCandidateId, node]));
      const nodeById = new Map(thoughtNodes.map((node: any) => [node.id, node]));
      const supersededCandidates = new Set<string>();
      for (const node of thoughtNodes) {
        if (node.supersedesNodeId) {
          const superseded = nodeById.get(node.supersedesNodeId) as any;
          if (!superseded || superseded.projectId !== input.projectId) {
            throw new Error("Invalid cross-project or missing supersedes link; fail closed");
          }
          supersededCandidates.add(superseded.memoryCandidateId);
        }
      }
      const structuredGroups = new Map<string, any[]>();
      for (const node of thoughtNodes) {
        if (supersededCandidates.has(node.memoryCandidateId)) continue;
        const key = `${node.graphId}:${node.parentNodeId ?? "root"}:${node.nodeKind}`;
        structuredGroups.set(key, [...(structuredGroups.get(key) ?? []), node]);
      }
      const conflictedCandidates = new Set<string>();
      for (const group of structuredGroups.values()) {
        const candidateIds = group.map((node) => node.memoryCandidateId);
        const contents = new Set(candidates.filter((candidate: any) => candidateIds.includes(candidate.id))
          .map((candidate: any) => candidate.content.trim().toLowerCase()));
        if (candidateIds.length > 1 && contents.size > 1) {
          candidateIds.forEach((id) => conflictedCandidates.add(id));
        }
      }
      const queryTokens = tokens([input.query, input.intent, input.task, ...input.entities].join(" "));
      const now = new Date();
      const drafts: Array<DecisionDraft & { candidate?: any; createdAt?: Date }> = [];
      const seenContent = new Set<string>();
      for (const candidate of candidates) {
        const contentDigest = textDigest(candidate.content);
        const dedupeDigest = textDigest(candidate.content.trim().toLowerCase());
        const evidenceLineageDigest = evidenceDigest(candidate.evidenceLineage);
        const provenance = {
          sourceActorId: candidate.sourceActorId, authorityLevel: candidate.authorityLevel,
          truthLevel: candidate.truthLevel,
          observedAt: candidate.evidenceLineage.map((item: AiceoEvidenceLineage) => item.observedAt),
          validFrom: candidate.validFrom, validUntil: candidate.validUntil,
          candidateOnly: true,
        };
        let reason = "included";
        if (candidate.lifecycle !== "candidate") reason = "lifecycle_not_candidate";
        else if (!ALLOWED_LAYERS.has(candidate.memoryLayer) || !requestedLayers.includes(candidate.memoryLayer)) reason = "query_scope_mismatch";
        else if (!ALLOWED_TYPES.has(candidate.memoryType) || !requestedTypes.includes(candidate.memoryType)
          || candidate.memoryType !== candidate.cognitiveState) reason = "unsupported_memory_type";
        else if (candidate.truthLevel !== "unverified"
          || !["ordinary_agent", "external_source"].includes(candidate.authorityLevel)) reason = "authority_or_epistemic_boundary";
        else if (candidate.validUntil && candidate.validUntil <= now) reason = "expired_valid_until";
        else if (candidate.validFrom && candidate.validFrom > now) reason = "not_yet_valid";
        else if (candidate.validFrom && candidate.validUntil && candidate.validUntil <= candidate.validFrom) reason = "invalid_time_interval";
        else if (supersededCandidates.has(candidate.id)) reason = "superseded_by_newer_node";
        else if ((nodeByCandidate.get(candidate.id) as any)?.epistemicState
          && !THOUGHT_EPISTEMIC_BY_TYPE[candidate.memoryType]
            ?.has((nodeByCandidate.get(candidate.id) as any).epistemicState)) {
          reason = "thought_epistemic_conflict";
        } else if (conflictedCandidates.has(candidate.id)) reason = "structured_thought_conflict";
        else {
          try {
            const node = nodeByCandidate.get(candidate.id) as any;
            if (node) {
              for (const evidence of candidate.evidenceLineage) {
                const expected = createHash("sha256").update(
                  `${candidate.content}:${evidence.sourceType}:${evidence.sourceId}:${evidence.observedAt}`,
                ).digest("hex");
                if (!["conversation_turn", "owner_statement", "observed_outcome", "external_document",
                  "sensor_observation", "system_record"].includes(evidence.sourceType.toLowerCase())
                  || evidence.evidenceHash !== expected) {
                  throw new Error("Thought evidence is invalid");
                }
              }
            } else {
              assertEvidenceValid(candidate.evidenceLineage, now, candidate.content);
            }
          }
          catch { reason = "poison_or_invalid_provenance"; }
        }
        if (reason === "included" && seenContent.has(dedupeDigest)) reason = "duplicate_deduped";
        const contentTokens = tokens(candidate.content);
        const overlap = [...contentTokens].filter((item) => queryTokens.has(item)).length;
        if (reason === "included" && overlap === 0) reason = "query_scope_mismatch";
        const newestObserved = Math.max(...candidate.evidenceLineage.map((item: AiceoEvidenceLineage) =>
          new Date(item.observedAt).getTime()).filter(Number.isFinite), 0);
        const ageDays = newestObserved ? Math.max(0, (now.getTime() - newestObserved) / 86_400_000) : 3650;
        if (reason === "included" && (!newestObserved || now.getTime() - newestObserved > MAX_EVIDENCE_AGE_MS)) {
          reason = "stale_evidence";
        }
        const scoreComponents = {
          relevance: overlap * 100,
          freshness: Math.max(0, 50 - Math.floor(ageDays)),
          provenance: Math.min(20, candidate.evidenceLineage.length * 10),
        };
        const score = Object.values(scoreComponents).reduce((sum, value) => sum + value, 0);
        if (reason === "included") seenContent.add(dedupeDigest);
        drafts.push({
          candidateId: candidate.id, thoughtNodeId: (nodeByCandidate.get(candidate.id) as any)?.id,
          decision: reason === "included" ? "included" : "excluded", reasonCode: reason,
          score, scoreComponents, contentDigest, evidenceDigest: evidenceLineageDigest, provenance,
          candidateSnapshot: candidateSnapshot(candidate),
          bytesConsumed: 0, candidate, createdAt: candidate.createdAt,
        });
      }
      const eligible = drafts.filter((item) => item.decision === "included")
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)
          || Number(b.createdAt) - Number(a.createdAt)
          || String(a.candidateId).localeCompare(String(b.candidateId)));
      let usedBytes = 0;
      let rank = 0;
      let status: "completed" | "blocked" = "completed";
      const requiredEntityTokens = tokens(input.entities.join(" "));
      const coveredEntityTokens = new Set<string>();
      let sufficient = false;
      for (const item of eligible) {
        const bytes = byteLength(item.candidate.content);
        if (scanLimitExceeded) {
          item.decision = "excluded"; item.reasonCode = "scan_limit_exceeded";
        } else if (sufficient) {
          item.decision = "excluded"; item.reasonCode = "minimum_sufficiency_reached";
        } else if (rank >= input.maxItems || usedBytes + bytes > input.maxBytes) {
          item.decision = "excluded"; item.reasonCode = "budget_exhausted";
        } else {
          rank += 1; item.rankPosition = rank; item.bytesConsumed = bytes; usedBytes += bytes;
          for (const token of tokens(item.candidate.content)) {
            if (requiredEntityTokens.has(token)) coveredEntityTokens.add(token);
          }
          sufficient = requiredEntityTokens.size > 0
            && [...requiredEntityTokens].every((token) => coveredEntityTokens.has(token));
        }
      }
      if (scanLimitExceeded || !sufficient) {
        status = "blocked";
        for (const item of eligible.filter((candidate) => candidate.decision === "included")) {
          item.decision = "excluded";
          item.reasonCode = scanLimitExceeded ? "scan_limit_exceeded" : "minimum_sufficiency_not_reached";
          item.rankPosition = undefined;
          item.bytesConsumed = 0;
        }
        usedBytes = 0;
      }
      const inboxCount = await tx.select({ value: count() }).from(aiceoPreclassificationMemoryInboxTable)
        .where(eq(aiceoPreclassificationMemoryInboxTable.projectId, input.projectId));
      const driftCount = await tx.select({ value: count() }).from(aiceoContextEvidenceEventsTable)
        .where(eq(aiceoContextEvidenceEventsTable.projectId, input.projectId));
      if (Number(inboxCount[0].value) > 0) drafts.push({
        decision: "excluded", reasonCode: "preclassification_inbox_excluded",
        scoreComponents: {}, provenance: { count: Number(inboxCount[0].value), retrievalAuthority: false }, bytesConsumed: 0,
      });
      if (Number(driftCount[0].value) > 0) drafts.push({
        decision: "excluded", reasonCode: "context_drift_excluded",
        scoreComponents: {}, provenance: { count: Number(driftCount[0].value), operationalInput: false }, bytesConsumed: 0,
      });
      if (scanLimitExceeded) drafts.push({
        decision: "excluded", reasonCode: "scan_limit_exceeded",
        scoreComponents: {}, provenance: { excludedCount: Number(candidateTotal.value) - candidates.length }, bytesConsumed: 0,
      });
      const inserted = [];
      for (const draft of drafts) {
        assertCredentialPersistenceSafe(draft, "retrieval-decision");
        const [decision] = await tx.insert(aiceoRetrievalDecisionsTable).values({
          requestId: request.id, projectId: input.projectId,
          candidateId: draft.candidateId, thoughtNodeId: draft.thoughtNodeId,
          decision: draft.decision, reasonCode: draft.reasonCode, score: draft.score,
          scoreComponents: draft.scoreComponents, contentDigest: draft.contentDigest,
          evidenceDigest: draft.evidenceDigest, provenance: draft.provenance,
          candidateSnapshot: draft.candidateSnapshot,
          rankPosition: draft.rankPosition, bytesConsumed: draft.bytesConsumed,
          appendSequence: 0, decisionHash: "db-owned",
          decisionHmac: hmac(decisionAuthPayload({
            requestId: request.id, projectId: input.projectId,
            candidateId: draft.candidateId, thoughtNodeId: draft.thoughtNodeId,
            decision: draft.decision, reasonCode: draft.reasonCode, score: draft.score,
            scoreComponents: draft.scoreComponents, contentDigest: draft.contentDigest,
            evidenceDigest: draft.evidenceDigest, provenance: draft.provenance,
            candidateSnapshot: draft.candidateSnapshot, rankPosition: draft.rankPosition,
            bytesConsumed: draft.bytesConsumed,
          })),
          operationalInput: false,
          grantsAuthority: false, productionAuthority: false,
        }).returning();
        inserted.push(decision);
      }
      const selectedCandidateIds = inserted.filter((item) => item.decision === "included")
        .sort((a, b) => Number(a.rankPosition) - Number(b.rankPosition))
        .map((item) => item.candidateId!);
      const budget = {
        maxItems: input.maxItems, maxBytes: input.maxBytes, scanLimit: input.scanLimit,
        usedItems: selectedCandidateIds.length, usedBytes,
      };
      const signedIntent = {
        requestId: request.id, requestHash: request.requestHash,
        persistentRevision: request.persistentRevision,
        decisionHashes: inserted.map((item) => item.decisionHash),
        selectedCandidateIds, budget, includedCount: selectedCandidateIds.length,
        selectedCandidateSnapshots: inserted.filter((item) => item.decision === "included")
          .sort((a, b) => Number(a.rankPosition) - Number(b.rankPosition))
          .map((item) => item.candidateSnapshot),
        requestHmac: request.requestHmac,
        decisionHmacs: inserted.map((item) => item.decisionHmac),
        excludedCount: inserted.length - selectedCandidateIds.length,
        consumedBytes: usedBytes, contextCompilerStatus: "DEFERRED",
        productionAuthority: false,
      };
      await tx.insert(aiceoRetrievalRunsTable).values({
        requestId: request.id, projectId: input.projectId, status,
        includedCount: selectedCandidateIds.length, excludedCount: inserted.length - selectedCandidateIds.length,
        scannedCount: candidates.length, consumedBytes: usedBytes, budget, selectedCandidateIds,
        resultHash: hash(signedIntent), responseHmac: hmac(signedIntent),
        contextCompilerStatus: "DEFERRED", stateOverrideAccepted: false,
        grantsAuthority: false, productionAuthority: false,
      });
      return this.responseFrom(tx, request.id, role, requestedBy);
    });
  }

  async get(requestId: string, requestedBy: string, role: AiceoRole) {
    return this.transact((tx) => this.responseFrom(tx, requestId, role, requestedBy));
  }

  async selfCheck(role: AiceoRole) {
    return this.transact(async (tx) => {
      const snapshot = await new AiceoContinuityLayer(tx, true).snapshot(role);
      const [control] = await tx.select().from(aiceoControlStateTable).limit(1);
      const triggerRows = await tx.execute(sql`
        select tgname from pg_trigger
        where not tgisinternal and tgname in (
          'aiceo_retrieval_request_guard','aiceo_retrieval_decision_guard',
          'aiceo_retrieval_run_guard','aiceo_retrieval_requests_immutable',
          'aiceo_retrieval_decisions_immutable','aiceo_retrieval_runs_immutable'
        )
      `);
      const recentRequests = await tx.select().from(aiceoRetrievalRequestsTable)
        .where(eq(aiceoRetrievalRequestsTable.projectId, snapshot.project.id))
        .orderBy(desc(aiceoRetrievalRequestsTable.createdAt), desc(aiceoRetrievalRequestsTable.id))
        .limit(20);
      const evidenceFailures: string[] = [];
      for (const request of recentRequests) {
        try {
          await this.responseFrom(tx, request.id, "aiceo_owner", request.requestedBy);
        } catch {
          evidenceFailures.push(request.id);
        }
      }
      const dimensions = {
        input: snapshot.state.currentState.activeTask?.startsWith("G1-002") === true,
        output: evidenceFailures.length === 0,
        state: snapshot.state.revision >= 46
          && snapshot.state.currentState.memoryPolicy === "Memory is context, Persistent State is truth",
        permission: snapshot.project.environment === "development"
          && snapshot.project.authority === "grok_restricted_development"
          && snapshot.project.productionAuthority === false,
        evidence: evidenceFailures.length === 0,
        version: VERSION === "G1-002-RTR-1",
        freshness: snapshot.state.resumeNode.node === "g1-002-retrieval-router-implementation"
          || snapshot.state.currentState.verification === "VERIFIED",
        invariants: triggerRows.rows.length === 6
          && control?.queueActive === true && control.killSwitch === false
          && control.circuitState === "CLOSED",
      };
      return {
        module: "aiceo-memory-retrieval-router",
        version: VERSION,
        checkedAt: new Date().toISOString(),
        status: Object.values(dimensions).every(Boolean) ? "PASSED" : "FAILED_CLOSED",
        dimensions,
        checkedRetrievals: recentRequests.length,
        evidenceFailureCount: evidenceFailures.length,
        selfCheckIsIndependentValidation: false,
        operationalInput: false,
        grantsAuthority: false,
        productionAuthority: false,
      };
    });
  }
}

export const aiceoRetrievalRouter = new AiceoRetrievalRouter();