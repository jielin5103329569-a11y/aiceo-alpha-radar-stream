import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { aiceoContinuityProjectsTable, aiceoMemoryCandidatesTable, aiceoMemoryEventsTable, aiceoThoughtNodesTable, db, pool } from "@workspace/db";
import { aiceoMemory, counterfactualEvidenceDigest, outcomeEvidenceDigest, thoughtEvidenceDigest } from "../artifacts/api-server/src/lib/aiceoMemory";

const stages = [
  "motivation","context","observation","interpretation","belief","principle","decision",
  "action","outcome","reflection","updated_belief","next_decision",
] as const;
const typeState = (stage: string) =>
  ["motivation","context","observation","action","outcome"].includes(stage) ? "observed"
    : ["interpretation","reflection"].includes(stage) ? "inferred" : "hypothesized";
const errorText = (error: unknown): string => {
  if (!error || typeof error !== "object") return String(error);
  const value = error as { message?: string; cause?: unknown };
  return `${value.message ?? ""} ${value.cause ? errorText(value.cause) : ""}`;
};
const rejected = async (expected: RegExp, work: () => Promise<unknown>) => {
  try {
    await work();
    assert.fail("operation unexpectedly succeeded");
  } catch (error) {
    assert.match(errorText(error), expected);
  }
};

async function main() {
  const [project] = await db.select().from(aiceoContinuityProjectsTable)
    .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).limit(1);
  assert.ok(project);
  const before = await db.select().from(aiceoThoughtNodesTable);
  const candidatesBefore = await db.select().from(aiceoMemoryCandidatesTable);
  const eventsBefore = await db.select().from(aiceoMemoryEventsTable);
  await rejected(/intentional rollback/, () => db.transaction(async (tx) => {
    const graphId = randomUUID();
    let parentNodeId: string | undefined;
    let beliefId: string | undefined;
    let actionId: string | undefined;
    for (const [index, nodeKind] of stages.entries()) {
      const content = `${nodeKind}-${randomUUID()}`;
      const postAction = ["outcome","reflection","updated_belief","next_decision"].includes(nodeKind);
      const observedAt = new Date(Date.now() - 1000).toISOString();
      const sourceType = postAction ? "observed_outcome" : "owner_statement";
      const evidence = { sourceType, sourceId: `${nodeKind}-${index}`, evidenceHash: "", observedAt };
      evidence.evidenceHash = thoughtEvidenceDigest(content, evidence);
      const counterfactual = {
        alternative: "do nothing", assumption: "conditions remain stable", predictedOutcome: "no change",
        sourceType: "owner_statement", sourceId: `counterfactual-${index}`, observedAt, evidenceHash: "",
      };
      counterfactual.evidenceHash = counterfactualEvidenceDigest(counterfactual);
      const outcome = actionId ? {
        status: nodeKind === "updated_belief" ? "mismatched" : "matched",
        actualResult: "observed reality", sourceType: "observed_outcome", sourceId: `outcome-${index}`,
        observedAt, actionNodeId: actionId, evidenceHash: "",
        ...(nodeKind === "updated_belief" ? { supersedeReason: "outcome contradicted the earlier belief" } : {}),
      } : undefined;
      if (outcome) outcome.evidenceHash = outcomeEvidenceDigest(outcome);
      const result = await aiceoMemory.createThoughtNode({
        projectId: project.id, graphId, nodeKind, content,
        epistemicState: typeState(nodeKind), sourceActorId: "thought-test",
        authorityLevel: "ordinary_agent",
        evidenceLineage: [evidence],
        parentNodeId, relationFromParent: parentNodeId ? `causes_${nodeKind}` : undefined,
        intendedResult: ["decision","action","next_decision"].includes(nodeKind) ? "produce a verifiable result" : undefined,
        counterfactuals: ["decision","next_decision"].includes(nodeKind)
          ? [counterfactual] : [],
        outcomeValidation: postAction ? outcome : { status: "not_applicable" },
        supersedesNodeId: nodeKind === "updated_belief" ? beliefId : undefined,
        transaction: tx,
      });
      if (nodeKind === "belief") beliefId = result.node.id;
      if (nodeKind === "action") actionId = result.node.id;
      parentNodeId = result.node.id;
    }
    const trace = await aiceoMemory.traceThoughtNode(project.id, parentNodeId!, tx);
    assert.equal(trace.length, stages.length);
    assert.deepEqual(trace.map((row: any) => row.node_kind), stages);
    assert.deepEqual(trace.map((row: any) => Number(row.append_sequence)), stages.map((_, i) => i + 1));
    await rejected(/immutable/, () => tx.update(aiceoThoughtNodesTable).set({ epistemicState: "contradicted" })
      .where(eq(aiceoThoughtNodesTable.id, beliefId!)));
    throw new Error("intentional rollback");
  }));
  await rejected(/independent source type/, () => aiceoMemory.createThoughtNode({
    projectId: project.id, graphId: randomUUID(), nodeKind: "motivation", content: "self reinforcement",
    epistemicState: "unverified", sourceActorId: "thought-test", authorityLevel: "ordinary_agent",
    evidenceLineage: [{ sourceType: "thought_node", sourceId: randomUUID(), evidenceHash: "c".repeat(64), observedAt: new Date(Date.now()-1000).toISOString() }],
  }));
  const after = await db.select().from(aiceoThoughtNodesTable);
  assert.equal(after.length, before.length);
  assert.equal((await db.select().from(aiceoMemoryCandidatesTable)).length, candidatesBefore.length);
  assert.equal((await db.select().from(aiceoMemoryEventsTable)).length, eventsBefore.length);
  await pool.end();
  console.log("AICEO G1-001 Thought Continuity Graph: PASS (full causal trace, correction controls, zero residue)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });