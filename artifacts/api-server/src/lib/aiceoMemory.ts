import { createHash } from "node:crypto";
import {
  aiceoContinuityProjectsTable, aiceoControlStateTable, aiceoMemoryCandidatesTable,
  aiceoThoughtNodesTable, db, type AiceoEvidenceLineage, type AiceoThoughtNodeKind,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export type MemoryActor = "ordinary_agent" | "external_source" | "brain" | "owner" | "governance";
export const PROTECTED_CAPABILITIES = ["production", "trading", "alerts", "governance", "database"];
const GOVERNANCE_LAYER = "governance";

export function assertMemoryWritePermission(actor: MemoryActor, layer: string, operation: "candidate" | "promote"): void {
  if (operation === "promote" && layer === GOVERNANCE_LAYER && actor !== "owner" && actor !== "governance") {
    throw new Error("Governance promotion requires Owner/governance path");
  }
  if (operation === "promote" && (actor === "ordinary_agent" || actor === "external_source")) {
    throw new Error("Ordinary agents and external sources may only create candidates");
  }
  if (operation === "promote" && layer !== GOVERNANCE_LAYER && actor !== "brain" && actor !== "owner") {
    throw new Error("Memory promotion requires Brain or Owner authority");
  }
}

export function assertEvidenceValid(lineage: AiceoEvidenceLineage[], now = new Date(), content?: string): void {
  if (!lineage.length) throw new Error("Promotion requires evidence lineage");
  for (const evidence of lineage) {
    if (!evidence.sourceType || !evidence.sourceId || !evidence.observedAt) throw new Error("Evidence requires source provenance and observedAt");
    if (!/^[a-f0-9]{64}$/.test(evidence.evidenceHash)) throw new Error("Evidence hash is invalid");
    const observedAt = new Date(evidence.observedAt);
    if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > now.getTime()) throw new Error("Evidence observedAt is invalid or future");
    if (content !== undefined && evidence.evidenceHash !== evidenceDigest(content, evidence)) throw new Error("Evidence is not bound to content/provenance");
    if (evidence.validUntil && new Date(evidence.validUntil).getTime() <= now.getTime()) {
      throw new Error("Evidence is stale or expired");
    }
    if (evidence.validFrom && new Date(evidence.validFrom).getTime() > now.getTime()) {
      throw new Error("Evidence is not temporally valid");
    }
  }
}

function assertIndependentCorroboration(candidate: { authorityLevel: string; memoryType: string; evidenceLineage: AiceoEvidenceLineage[] }): void {
  if (candidate.authorityLevel === "external_source" && ["fact", "rule"].includes(candidate.memoryType)) {
    const independent = new Set(candidate.evidenceLineage.map((item) => item.sourceId ?? item.sourceType));
    if (independent.size < 2) throw new Error("External fact/rule requires independent corroboration");
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function evidenceDigest(content: string, evidence: AiceoEvidenceLineage): string {
  return hash({ sourceType: evidence.sourceType, sourceId: evidence.sourceId ?? null, observedAt: evidence.observedAt, content });
}
export function contentEvidenceHash(content: string, evidence: AiceoEvidenceLineage[]): string {
  return hash({ content, evidence });
}
export function thoughtEvidenceDigest(content: string, evidence: AiceoEvidenceLineage): string {
  return createHash("sha256")
    .update(`${content}:${evidence.sourceType}:${evidence.sourceId}:${evidence.observedAt}`)
    .digest("hex");
}
export function counterfactualEvidenceDigest(value: {
  alternative: string; assumption: string; predictedOutcome: string;
  sourceType: string; sourceId: string; observedAt: string;
}): string {
  return createHash("sha256").update(
    `${value.alternative}:${value.assumption}:${value.predictedOutcome}:${value.sourceType}:${value.sourceId}:${value.observedAt}`,
  ).digest("hex");
}
export function outcomeEvidenceDigest(value: {
  actualResult: string; sourceType: string; sourceId: string; observedAt: string; actionNodeId: string;
}): string {
  return createHash("sha256").update(
    `${value.actualResult}:${value.sourceType}:${value.sourceId}:${value.observedAt}:${value.actionNodeId}`,
  ).digest("hex");
}
export const aiceoMemory = {
  async createCandidate(input: {
    projectId: string; content: string; memoryLayer: string; memoryType: string;
    cognitiveState: string; sourceActorId: string; authorityLevel: MemoryActor; truthLevel?: string;
    evidenceLineage?: AiceoEvidenceLineage[]; validFrom?: Date; validUntil?: Date; transaction?: any;
  }) {
    if (!["ordinary_agent", "external_source"].includes(input.authorityLevel)
      || !["observation", "interpretation", "hypothesis"].includes(input.memoryType)
      || input.memoryType !== input.cognitiveState) {
      throw new Error("Only unverified observation/interpretation/hypothesis candidates are accepted");
    }
    if (input.truthLevel && input.truthLevel !== "unverified") throw new Error("Candidate truth must be unverified");
    assertEvidenceValid(input.evidenceLineage ?? []);
    assertMemoryWritePermission(input.authorityLevel, input.memoryLayer, "candidate");
    if (input.validUntil && input.validFrom && input.validUntil <= input.validFrom) {
      throw new Error("Temporal validity interval is invalid");
    }
    const operation = async (tx: any) => {
      const [control] = await tx.select().from(aiceoControlStateTable).limit(1).for("update");
      if (!control?.queueActive || control.killSwitch || control.circuitState !== "CLOSED") {
        throw new Error("AICEO memory writes are blocked by kill switch/circuit breaker");
      }
      const [project] = await tx.select().from(aiceoContinuityProjectsTable)
        .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).limit(1);
      if (!project || project.id !== input.projectId || project.environment !== "development"
        || project.authority !== "grok_restricted_development" || project.productionAuthority) {
        throw new Error("Candidate writes require the canonical restricted AICEO project");
      }
      const [candidate] = await tx.insert(aiceoMemoryCandidatesTable).values({
        ...input, authorityLevel: input.authorityLevel,
        evidenceLineage: input.evidenceLineage ?? [], lifecycle: "candidate",
      }).returning();
      return candidate;
    };
    return input.transaction ? operation(input.transaction) : db.transaction(operation);
  },

  async promoteCandidate(input: { projectId: string; candidateId: string; actorId: string; actorAuthority: MemoryActor; productionAuthority?: boolean }) {
    void input;
    throw new Error("G1-001 Learning Promotion is DEFERRED");
  },

  async createThoughtNode(input: {
    projectId: string; graphId: string; nodeKind: AiceoThoughtNodeKind; content: string;
    epistemicState: string; sourceActorId: string; authorityLevel: "ordinary_agent" | "external_source";
    evidenceLineage: AiceoEvidenceLineage[]; parentNodeId?: string; relationFromParent?: string;
    supersedesNodeId?: string; intendedResult?: string;
    outcomeValidation?: Record<string, unknown>; counterfactuals?: Record<string, unknown>[];
    transaction?: any;
  }) {
    const memoryType = ["motivation", "context", "observation", "action", "outcome"].includes(input.nodeKind)
      ? "observation"
      : ["interpretation", "reflection"].includes(input.nodeKind) ? "interpretation" : "hypothesis";
    const operation = async (tx: any) => {
      const candidate = await this.createCandidate({
        projectId: input.projectId, content: input.content, memoryLayer: "semantic",
        memoryType, cognitiveState: memoryType, sourceActorId: input.sourceActorId,
        authorityLevel: input.authorityLevel, evidenceLineage: input.evidenceLineage,
        transaction: tx,
      });
      const [node] = await tx.insert(aiceoThoughtNodesTable).values({
        projectId: input.projectId, graphId: input.graphId, memoryCandidateId: candidate.id,
        nodeKind: input.nodeKind, epistemicState: input.epistemicState,
        parentNodeId: input.parentNodeId, relationFromParent: input.relationFromParent,
        supersedesNodeId: input.supersedesNodeId, intendedResult: input.intendedResult,
        outcomeValidation: input.outcomeValidation ?? { status: "not_applicable" },
        counterfactuals: input.counterfactuals ?? [], appendSequence: 0,
        productionAuthority: false,
      }).returning();
      return { candidate, node };
    };
    return input.transaction ? operation(input.transaction) : db.transaction(operation);
  },

  async traceThoughtNode(projectId: string, nodeId: string, transaction?: any) {
    const executor = transaction ?? db;
    const result = await executor.execute(sql`
      WITH RECURSIVE trace AS (
        SELECT n.*, 0 AS distance FROM aiceo_thought_nodes n
          WHERE n.id=${nodeId}::uuid AND n.project_id=${projectId}::uuid
        UNION ALL
        SELECT p.*, trace.distance+1 FROM aiceo_thought_nodes p
          JOIN trace ON trace.parent_node_id=p.id
          WHERE p.project_id=${projectId}::uuid AND p.graph_id=trace.graph_id
      )
      SELECT * FROM trace ORDER BY distance DESC
    `);
    return result.rows;
  },

  // Retrieval, routing, compilation, distribution, learning-promotion and temporal replay are deferred.
  deferredCapabilities: ["retrieval", "router", "compiler", "distribution", "learning_promotion", "temporal_replay"] as const,
};