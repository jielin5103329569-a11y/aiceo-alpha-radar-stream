import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import {
  aiceoContinuityProjectsTable, aiceoContinuityStateTable, aiceoControlStateTable,
  aiceoMemoryCandidatesTable, aiceoPreclassificationMemoryInboxTable,
  aiceoPromotedMemoriesTable, aiceoRetrievalDecisionsTable, aiceoRetrievalRequestsTable,
  aiceoRetrievalRunsTable, aiceoRetrievalValidatorAttestationsTable, db, pool,
} from "@workspace/db";
import {
  aiceoMemory, evidenceDigest, thoughtEvidenceDigest,
} from "../artifacts/api-server/src/lib/aiceoMemory";
import {
  AiceoRetrievalRouter, type RetrievalInput,
} from "../artifacts/api-server/src/lib/aiceoRetrievalRouter";
import { AiceoContinuityLayer } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

const ROLLBACK = new Error("ROLLBACK_RETRIEVAL_TEST");
const evidence = (content: string, sourceId: string, observedAt: Date) => {
  const base = {
    sourceType: "agent_observation", sourceId, observedAt: observedAt.toISOString(),
    evidenceHash: "",
  };
  return { ...base, evidenceHash: evidenceDigest(content, base) };
};
const thoughtEvidence = (content: string, sourceId: string, observedAt: Date) => {
  const base = {
    sourceType: "system_record", sourceId, observedAt: observedAt.toISOString(),
    evidenceHash: "",
  };
  return { ...base, evidenceHash: thoughtEvidenceDigest(content, base) };
};

async function main() {
  const before = {
    candidates: Number((await db.select({ value: count() }).from(aiceoMemoryCandidatesTable))[0].value),
    promoted: Number((await db.select({ value: count() }).from(aiceoPromotedMemoriesTable))[0].value),
    inbox: Number((await db.select({ value: count() }).from(aiceoPreclassificationMemoryInboxTable))[0].value),
    requests: Number((await db.select({ value: count() }).from(aiceoRetrievalRequestsTable))[0].value),
  };
  let report: Record<string, unknown> = {};
  await assert.rejects(db.transaction(async (tx) => {
    const [project] = await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).limit(1);
    const [state] = await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).limit(1);
    assert.equal(state.revision, 46);
    assert.equal(state.state, "RUNNING");
    assert.equal(state.currentState.verification, "NOT_VERIFIED");
    assert.equal(state.currentState.closure, "BLOCKED");
    assert.equal(project.productionAuthority, false);
    const router = new AiceoRetrievalRouter(tx, true);
    const now = new Date();
    const contents = {
      strongest: "G1-002 retrieval router should preserve persistent state and explain memory context",
      second: "G1-002 memory retrieval context must stay project isolated and budget bounded",
      irrelevant: "Unrelated horticulture notes about watering tomatoes",
      stale: "G1-002 stale retrieval memory context",
      oldEvidence: "G1-002 retrieval memory context with evidence older than the freshness budget",
      poison: "G1-002 poisoned retrieval memory context",
      future: "G1-002 future retrieval memory context",
      conflictA: "G1-002 retrieval memory says the structured branch supports option alpha",
      conflictB: "G1-002 retrieval memory says the structured branch supports option beta",
      epistemicMismatch: "G1-002 retrieval memory thought node with mismatched epistemic state",
    };
    const strongest = await aiceoMemory.createCandidate({
      projectId: project.id, content: contents.strongest, memoryLayer: "semantic",
      memoryType: "observation", cognitiveState: "observation", sourceActorId: "test-agent-a",
      authorityLevel: "ordinary_agent", evidenceLineage: [evidence(contents.strongest, "source-a", new Date(now.getTime() - 60_000))],
      transaction: tx,
    });
    const duplicate = await aiceoMemory.createCandidate({
      projectId: project.id, content: contents.strongest, memoryLayer: "semantic",
      memoryType: "observation", cognitiveState: "observation", sourceActorId: "test-agent-b",
      authorityLevel: "ordinary_agent", evidenceLineage: [evidence(contents.strongest, "source-b", new Date(now.getTime() - 120_000))],
      transaction: tx,
    });
    await aiceoMemory.createCandidate({
      projectId: project.id, content: contents.second, memoryLayer: "episodic",
      memoryType: "interpretation", cognitiveState: "interpretation", sourceActorId: "test-agent-c",
      authorityLevel: "ordinary_agent", evidenceLineage: [evidence(contents.second, "source-c", new Date(now.getTime() - 180_000))],
      transaction: tx,
    });
    const irrelevant = await aiceoMemory.createCandidate({
      projectId: project.id, content: contents.irrelevant, memoryLayer: "semantic",
      memoryType: "observation", cognitiveState: "observation", sourceActorId: "test-agent-d",
      authorityLevel: "ordinary_agent", evidenceLineage: [evidence(contents.irrelevant, "source-d", new Date(now.getTime() - 240_000))],
      transaction: tx,
    });
    const expired = await aiceoMemory.createCandidate({
      projectId: project.id, content: contents.stale, memoryLayer: "semantic",
      memoryType: "observation", cognitiveState: "observation", sourceActorId: "test-agent-e",
      authorityLevel: "ordinary_agent", evidenceLineage: [evidence(contents.stale, "source-e", new Date(now.getTime() - 300_000))],
      validUntil: new Date(now.getTime() - 1), transaction: tx,
    });
    const oldEvidence = await aiceoMemory.createCandidate({
      projectId: project.id, content: contents.oldEvidence, memoryLayer: "semantic",
      memoryType: "observation", cognitiveState: "observation", sourceActorId: "test-agent-old",
      authorityLevel: "ordinary_agent",
      evidenceLineage: [evidence(contents.oldEvidence, "source-old", new Date(now.getTime() - 100 * 86_400_000))],
      transaction: tx,
    });
    const poison = await aiceoMemory.createCandidate({
      projectId: project.id, content: contents.poison, memoryLayer: "semantic",
      memoryType: "hypothesis", cognitiveState: "hypothesis", sourceActorId: "test-agent-f",
      authorityLevel: "external_source", evidenceLineage: [{
        sourceType: "external", sourceId: "source-f", observedAt: new Date(now.getTime() - 360_000).toISOString(),
        evidenceHash: "a".repeat(64),
      }], transaction: tx,
    });
    await tx.execute(sql`SAVEPOINT future_candidate_guard`);
    await assert.rejects(tx.insert(aiceoMemoryCandidatesTable).values({
      projectId: project.id, content: contents.future, memoryLayer: "semantic",
      memoryType: "observation", cognitiveState: "observation", truthLevel: "unverified",
      sourceActorId: "test-agent-g", authorityLevel: "ordinary_agent",
      evidenceLineage: [evidence(contents.future, "source-g", new Date(now.getTime() + 86_400_000))],
      lifecycle: "candidate",
    }));
    await tx.execute(sql`ROLLBACK TO SAVEPOINT future_candidate_guard`);
    const conflictGraphId = randomUUID();
    const conflictRootContent = "G1-002 retrieval memory structured conflict motivation root";
    const conflictRoot = await aiceoMemory.createThoughtNode({
      projectId: project.id, graphId: conflictGraphId, nodeKind: "motivation",
      content: conflictRootContent, epistemicState: "observed",
      sourceActorId: "test-conflict-root", authorityLevel: "ordinary_agent",
      evidenceLineage: [thoughtEvidence(conflictRootContent, "conflict-root-source", new Date(now.getTime() - 180_000))],
      transaction: tx,
    });
    const conflictContextContent = "G1-002 retrieval memory structured conflict context parent";
    const conflictContext = await aiceoMemory.createThoughtNode({
      projectId: project.id, graphId: conflictGraphId, nodeKind: "context",
      content: conflictContextContent, epistemicState: "observed",
      sourceActorId: "test-conflict-context", authorityLevel: "ordinary_agent",
      evidenceLineage: [thoughtEvidence(conflictContextContent, "conflict-context-source", new Date(now.getTime() - 120_000))],
      parentNodeId: conflictRoot.node.id, relationFromParent: "provides_context",
      transaction: tx,
    });
    const conflictNodes = [];
    for (const [index, content] of [contents.conflictA, contents.conflictB].entries()) {
      conflictNodes.push(await aiceoMemory.createThoughtNode({
        projectId: project.id, graphId: conflictGraphId, nodeKind: "observation", content,
        epistemicState: index === 0 ? "observed" : "contradicted",
        sourceActorId: `test-conflict-${index}`,
        authorityLevel: "ordinary_agent",
        evidenceLineage: [thoughtEvidence(content, `conflict-source-${index}`, new Date(now.getTime() - (index + 1) * 60_000))],
        parentNodeId: conflictContext.node.id, relationFromParent: `observes_branch_${index}`,
        transaction: tx,
      }));
    }
    const base: RetrievalInput = {
      projectId: project.id, idempotencyKey: `g1-002-test-${randomUUID()}`,
      purpose: "why_history_context", task: String(state.currentState.activeTask),
      intent: "Retrieve only relevant context for the current G1-002 router task",
      entities: ["G1-002", "retrieval", "memory"], query: "G1-002 retrieval memory context persistent state",
      requestedLayers: ["semantic", "episodic"], requestedTypes: ["observation", "interpretation", "hypothesis"],
      maxItems: 1, maxBytes: 1024, scanLimit: 100,
      claimedPersistentRevision: 46, claimedResumeNode: "g1-002-retrieval-router-implementation",
    };
    const grants = [{
      subjectId: "retrieval-test-owner",
      projectId: project.id,
      task: base.task,
      entities: base.entities,
      revision: 46,
    }];
    const result = await router.retrieve(base, "retrieval-test-owner", "aiceo_owner", grants);
    assert.equal(result.version, "G1-002-RTR-1");
    assert.equal(result.truthSource, "persistent_state");
    assert.equal(result.request.persistentRevision, 46);
    assert.deepEqual(result.request.verifiedResumeNode, state.resumeNode);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].candidateOnly, true);
    assert.equal(result.items[0].truthLevel, "unverified");
    assert.equal(result.items[0].operationalInput, false);
    assert.equal(result.items[0].grantsAuthority, false);
    assert.equal(result.items[0].productionAuthority, false);
    assert.equal(result.contextCompiler.status, "DEFERRED");
    assert.equal(result.contextCompiler.mutatesPersistentState, false);
    assert.equal(result.stateOverrideAccepted, false);
    assert.equal(result.grantsAuthority, false);
    assert.equal(result.productionAuthority, false);
    assert.match(result.responseHmac, /^[a-f0-9]{64}$/);
    const reasons = new Set(result.explain.map((item: any) => item.reason));
    for (const reason of [
      "duplicate_deduped", "minimum_sufficiency_reached", "query_scope_mismatch", "expired_valid_until",
      "stale_evidence", "poison_or_invalid_provenance", "structured_thought_conflict",
      "thought_epistemic_conflict", "preclassification_inbox_excluded", "context_drift_excluded",
    ]) assert.ok(reasons.has(reason), `missing exclusion reason ${reason}`);
    assert.ok(result.explain.some((item: any) =>
      item.candidateId && item.reason === "poison_or_invalid_provenance"));
    assert.ok(!result.items.some((item: any) => item.content === contents.poison
      || item.content === contents.stale || item.content === contents.future));
    const budgetBlocked = await router.retrieve({
      ...base,
      idempotencyKey: `${base.idempotencyKey}-budget`,
      maxBytes: 1,
    }, "retrieval-test-owner", "aiceo_owner", grants);
    assert.equal(budgetBlocked.status, "blocked");
    assert.equal(budgetBlocked.items.length, 0);
    assert.ok(budgetBlocked.explain.some((item: any) => item.reason === "budget_exhausted"));
    const scanBlocked = await router.retrieve({
      ...base,
      idempotencyKey: `${base.idempotencyKey}-scan`,
      scanLimit: 1,
    }, "retrieval-test-owner", "aiceo_owner", grants);
    assert.equal(scanBlocked.status, "blocked");
    assert.equal(scanBlocked.items.length, 0);
    assert.ok(scanBlocked.explain.some((item: any) => item.reason === "scan_limit_exceeded"));
    const selfCheck = await router.selfCheck("aiceo_validator");
    assert.equal(selfCheck.status, "PASSED");
    assert.ok(Object.values(selfCheck.dimensions).every(Boolean));
    assert.equal(selfCheck.selfCheckIsIndependentValidation, false);
    assert.equal(selfCheck.grantsAuthority, false);
    assert.equal(selfCheck.productionAuthority, false);
    const replay = await router.retrieve(base, "retrieval-test-owner", "aiceo_owner", grants);
    assert.equal(replay.request.id, result.request.id);
    assert.equal(Number((await tx.select({ value: count() }).from(aiceoRetrievalRequestsTable))[0].value), 3);
    assert.equal((await router.get(result.request.id, "retrieval-test-owner", "aiceo_owner")).resultHash, result.resultHash);
    await assert.rejects(
      router.get(result.request.id, "different-operator", "aiceo_operator"),
      /need-to-know/,
    );
    await assert.rejects(
      router.get(result.request.id, "different-owner", "aiceo_owner"),
      /need-to-know/,
    );
    await assert.rejects(
      router.retrieve({ ...base, idempotencyKey: `${base.idempotencyKey}-no-grant` },
        "retrieval-test-owner", "aiceo_owner", []),
      /need-to-know/,
    );
    await assert.rejects(
      router.retrieve({ ...base, idempotencyKey: `${base.idempotencyKey}-wrong-grant` },
        "retrieval-test-owner", "aiceo_owner", [{
          ...grants[0],
          entities: ["G1-002"],
        }]),
      /need-to-know/,
    );
    await assert.rejects(
      router.retrieve({ ...base, idempotencyKey: `${base.idempotencyKey}-project`, projectId: randomUUID() },
        "retrieval-test-owner", "aiceo_owner", grants),
      /project isolation/,
    );
    await assert.rejects(
      router.retrieve({ ...base, idempotencyKey: `${base.idempotencyKey}-revision`, claimedPersistentRevision: 45 },
        "retrieval-test-owner", "aiceo_owner", grants),
      /revision conflicts/,
    );
    await assert.rejects(
      router.retrieve({ ...base, idempotencyKey: `${base.idempotencyKey}-resume`, claimedResumeNode: "stale-node" },
        "retrieval-test-owner", "aiceo_owner", grants),
      /Resume Node conflicts/,
    );
    await assert.rejects(
      router.retrieve({ ...base, idempotencyKey: `${base.idempotencyKey}-task`, task: "G1-001 stale task" },
        "retrieval-test-owner", "aiceo_owner", grants),
      /task conflicts/,
    );
    await assert.rejects(
      router.retrieve({ ...base, idempotencyKey: `${base.idempotencyKey}-scope`, requestedLayers: ["governance"] },
        "retrieval-test-owner", "aiceo_owner", grants),
      /unsupported memory/,
    );
    await tx.update(aiceoControlStateTable).set({ killSwitch: true });
    await assert.rejects(
      router.retrieve({ ...base, idempotencyKey: `${base.idempotencyKey}-kill` },
        "retrieval-test-owner", "aiceo_owner", grants),
      /Kill Switch/,
    );
    await tx.update(aiceoControlStateTable).set({ killSwitch: false });
    await tx.execute(sql`SAVEPOINT retrieval_immutability`);
    await assert.rejects(tx.update(aiceoRetrievalRequestsTable).set({ query: "tampered" })
      .where(eq(aiceoRetrievalRequestsTable.id, result.request.id)));
    await tx.execute(sql`ROLLBACK TO SAVEPOINT retrieval_immutability`);
    await tx.execute(sql`SAVEPOINT retrieval_post_run_decision`);
    await assert.rejects(tx.insert(aiceoRetrievalDecisionsTable).values({
      requestId: result.request.id, projectId: project.id, decision: "excluded",
      reasonCode: "context_drift_excluded", scoreComponents: {}, provenance: {},
      bytesConsumed: 0, appendSequence: 0, decisionHash: "db-owned",
      decisionHmac: "0".repeat(64), operationalInput: false,
      grantsAuthority: false, productionAuthority: false,
    }));
    await tx.execute(sql`ROLLBACK TO SAVEPOINT retrieval_post_run_decision`);
    await tx.execute(sql`SAVEPOINT retrieval_fake_hmac`);
    const [fakeRequest] = await tx.insert(aiceoRetrievalRequestsTable).values({
      projectId: project.id, idempotencyKey: `${base.idempotencyKey}-fake-hmac`,
      requestedBy: "retrieval-test-owner", requesterRole: "aiceo_owner",
      purpose: "why_history_context", task: base.task, intent: base.intent,
      entities: base.entities, query: base.query,
      requestedLayers: base.requestedLayers!, requestedTypes: base.requestedTypes!,
      maxItems: 1, maxBytes: 1024, scanLimit: 100,
      persistentRevision: 0, persistentStateHash: "db-owned", verifiedResumeNode: {},
      requestHash: "db-owned", requestHmac: "0".repeat(64), appendSequence: 0,
      grantSnapshot: {
        subjectId: "retrieval-test-owner", projectId: project.id, task: base.task,
        entities: [...base.entities].sort(), revision: 46,
        grantsAuthority: false, productionAuthority: false,
      },
      grantHmac: "0".repeat(64),
      requestEventHash: "db-owned", operationalInput: false, stateOverrideAccepted: false,
      grantsAuthority: false, productionAuthority: false,
    }).returning();
    const policy = async (candidateId: string) => {
      const value = await tx.execute(sql`
        SELECT aiceo_retrieval_candidate_policy(
          ${fakeRequest.id}::uuid,
          ${candidateId}::uuid
        ) AS reason
      `);
      return String((value as any).rows[0].reason);
    };
    assert.equal(await policy(strongest.id), "included");
    assert.equal(await policy(oldEvidence.id), "stale_evidence");
    assert.equal(await policy(poison.id), "poison_or_invalid_provenance");
    assert.equal(await policy(irrelevant.id), "query_scope_mismatch");
    assert.equal(await policy(conflictNodes[0].candidate.id), "structured_thought_conflict");
    assert.equal(await policy(conflictNodes[1].candidate.id), "thought_epistemic_conflict");
    const [candidateCount] = await tx.select({ value: count() }).from(aiceoMemoryCandidatesTable)
      .where(eq(aiceoMemoryCandidatesTable.projectId, project.id));
    await tx.execute(sql`SAVEPOINT retrieval_direct_run_guard`);
    await assert.rejects(tx.insert(aiceoRetrievalRunsTable).values({
      requestId: fakeRequest.id, projectId: project.id, status: "completed",
      includedCount: 0, excludedCount: 0, scannedCount: Number(candidateCount.value),
      consumedBytes: 0,
      budget: { maxItems: 1, maxBytes: 1024, scanLimit: 100, usedItems: 0, usedBytes: 0 },
      selectedCandidateIds: [], resultHash: "0".repeat(64), responseHmac: "0".repeat(64),
      contextCompilerStatus: "DEFERRED", stateOverrideAccepted: false,
      grantsAuthority: false, productionAuthority: false,
    }));
    await tx.execute(sql`ROLLBACK TO SAVEPOINT retrieval_direct_run_guard`);
    const snapshotOf = (candidate: any) => ({
      candidateId: candidate.id, projectId: candidate.projectId, content: candidate.content,
      memoryLayer: candidate.memoryLayer, memoryType: candidate.memoryType,
      cognitiveState: candidate.cognitiveState, truthLevel: candidate.truthLevel,
      authorityLevel: candidate.authorityLevel, sourceActorId: candidate.sourceActorId,
      evidenceLineage: candidate.evidenceLineage, validFrom: candidate.validFrom,
      validUntil: candidate.validUntil, lifecycle: candidate.lifecycle, createdAt: candidate.createdAt,
      candidateOnly: true, operationalInput: false, grantsAuthority: false, productionAuthority: false,
    });
    const directDecision = (candidate: any, rankPosition: number) => ({
      requestId: fakeRequest.id, projectId: project.id, candidateId: candidate.id,
      decision: "included" as const, reasonCode: "included", score: 1, scoreComponents: {},
      contentDigest: createHash("sha256").update(candidate.content).digest("hex"),
      evidenceDigest: createHash("sha256").update(
        candidate.evidenceLineage.map((item: any) => item.evidenceHash).sort().join(":"),
      ).digest("hex"),
      provenance: {}, candidateSnapshot: snapshotOf(candidate), rankPosition,
      bytesConsumed: Buffer.byteLength(candidate.content, "utf8"), appendSequence: 0,
      decisionHash: "db-owned", decisionHmac: "0".repeat(64), operationalInput: false,
      grantsAuthority: false, productionAuthority: false,
    });
    await tx.insert(aiceoRetrievalDecisionsTable).values(directDecision(strongest, 1));
    assert.equal(await policy(duplicate.id), "duplicate_deduped");
    await tx.execute(sql`SAVEPOINT retrieval_direct_policy_guard`);
    await assert.rejects(
      tx.insert(aiceoRetrievalDecisionsTable).values(directDecision(poison, 2)),
    );
    await tx.execute(sql`ROLLBACK TO SAVEPOINT retrieval_direct_policy_guard`);
    await assert.rejects(
      router.get(fakeRequest.id, "retrieval-test-owner", "aiceo_owner"),
      /request HMAC/,
    );
    await tx.execute(sql`ROLLBACK TO SAVEPOINT retrieval_fake_hmac`);
    const [afterState] = await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).limit(1);
    assert.equal(afterState.revision, 46);
    assert.equal(afterState.state, "RUNNING");
    const continuity = new AiceoContinuityLayer(tx, true);
    await assert.rejects(
      continuity.attestRetrievalValidation(
        { acceptedRevision: 46, evidenceDigest: "a".repeat(64) },
        "test-independent-validator",
        "aiceo_validator",
      ),
      /accepted implementation revision/,
    );
    await tx.update(aiceoContinuityStateTable).set({
      currentState: { ...afterState.currentState, acceptedRevision: 46 },
    }).where(eq(aiceoContinuityStateTable.projectId, project.id));
    await assert.rejects(
      continuity.attestRetrievalValidation(
        { acceptedRevision: 46, evidenceDigest: "a".repeat(64) },
        "aiceo:g1-002-retrieval-router-starter",
        "aiceo_validator",
      ),
      /differ/,
    );
    const attestation = await continuity.attestRetrievalValidation(
      { acceptedRevision: 46, evidenceDigest: "b".repeat(64) },
      "test-independent-validator",
      "aiceo_validator",
    );
    assert.equal(attestation.implementationActorId, "aiceo:g1-002-retrieval-router-starter");
    assert.equal(attestation.validatorId, "test-independent-validator");
    await tx.execute(sql`SAVEPOINT retrieval_attestation_immutable`);
    await assert.rejects(tx.update(aiceoRetrievalValidatorAttestationsTable)
      .set({ evidenceDigest: "c".repeat(64) })
      .where(eq(aiceoRetrievalValidatorAttestationsTable.id, attestation.id)));
    await tx.execute(sql`ROLLBACK TO SAVEPOINT retrieval_attestation_immutable`);
    await tx.update(aiceoContinuityStateTable).set({ currentState: afterState.currentState })
      .where(eq(aiceoContinuityStateTable.projectId, project.id));
    await continuity.update({
      state: afterState.state as any,
      currentState: afterState.currentState,
      decisionRuleRegistry: afterState.decisionRuleRegistry,
      entityRegistry: afterState.entityRegistry,
      aliasDictionary: afterState.aliasDictionary,
      evidencePointers: afterState.evidencePointers,
      resumeNode: afterState.resumeNode,
      failureReason: afterState.failureReason,
      recoveryStrategy: "Rollback-only valid revision advancement for stale replay regression.",
      ownerGateReason: afterState.ownerGateReason,
    }, "retrieval-stale-replay-test");
    await assert.rejects(router.get(result.request.id, "retrieval-test-owner", "aiceo_owner"),
      /stale against current Persistent State/);
    assert.equal(Number((await tx.select({ value: count() }).from(aiceoPromotedMemoriesTable))[0].value), before.promoted);
    assert.equal(Number((await tx.select({ value: count() }).from(aiceoPreclassificationMemoryInboxTable))[0].value), before.inbox);
    assert.equal(Number((await tx.select({ value: count() }).from(aiceoRetrievalRunsTable))[0].value), 3);
    assert.ok(Number((await tx.select({ value: count() }).from(aiceoRetrievalDecisionsTable))[0].value) >= 7);
    report = {
      revision: afterState.revision, included: result.items.length, exclusionReasons: [...reasons].sort(),
      idempotent: true, projectIsolation: true, persistentStateWins: true, appendOnly: true,
      authenticatedGrantRequired: true, crossRequesterReadBlocked: true,
      inboxExcluded: true, contextDriftExcluded: true, futureEvidenceRejectedUpstream: true,
      minimumSufficient: true, budgetFailClosed: true,
      staleEvidenceExcluded: true, structuredConflictExcluded: true,
      epistemicMismatchExcluded: true, scanLimitFailClosed: true,
      requestHmacTamperReadBlocked: true, postRunDecisionBlocked: true, localSelfCheckPassed: true,
      dbOwnedInclusionPolicy: true, dbOwnedRunPolicy: true, staleReplayBlocked: true,
      independentAttestationBound: true, selfAttestationBlocked: true,
      contextCompiler: "DEFERRED",
      grantsAuthority: false, productionAuthority: false,
    };
    void strongest;
    throw ROLLBACK;
  }), (error: unknown) => error === ROLLBACK);
  assert.deepEqual({
    candidates: Number((await db.select({ value: count() }).from(aiceoMemoryCandidatesTable))[0].value),
    promoted: Number((await db.select({ value: count() }).from(aiceoPromotedMemoriesTable))[0].value),
    inbox: Number((await db.select({ value: count() }).from(aiceoPreclassificationMemoryInboxTable))[0].value),
    requests: Number((await db.select({ value: count() }).from(aiceoRetrievalRequestsTable))[0].value),
  }, before);
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}).finally(() => pool.end());