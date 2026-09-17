import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoContinuityEventsTable,
  aiceoContinuityProjectsTable,
  aiceoContinuityStateTable,
  aiceoControlStateTable,
} from "@workspace/db/schema";
import { aiceoContinuityLayer } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

const canonical = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]),
  );
  return value;
};

async function main() {
  const secret = process.env.SESSION_SECRET;
  assert.ok(secret && secret.length >= 32, "signing authority must exist");
  const project = (await db.select().from(aiceoContinuityProjectsTable)
    .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).limit(1))[0];
  assert.ok(project);
  assert.equal(project.environment, "development");
  assert.equal(project.authority, "grok_restricted_development");
  assert.equal(project.productionAuthority, false);
  const state = (await db.select().from(aiceoContinuityStateTable)
    .where(eq(aiceoContinuityStateTable.projectId, project.id)).limit(1))[0];
  assert.ok(state);
  assert.equal(state.state, "COMPLETED");
  assert.equal(state.currentState.verification, "PENDING_INDEPENDENT_READ_ONLY_ACCEPTANCE");
  assert.equal(state.resumeNode.node, "independent-read-only-acceptance");
  assert.ok(state.decisionRuleRegistry.length >= 5);
  assert.ok(state.entityRegistry.length >= 5);
  assert.ok(state.evidencePointers.length >= 4);
  const events = await db.select().from(aiceoContinuityEventsTable)
    .orderBy(asc(aiceoContinuityEventsTable.serverTimestamp), asc(aiceoContinuityEventsTable.id));
  let previous: string | null = null;
  for (const event of events) {
    assert.equal(event.previousHash, previous, "continuity event chain must be unbroken");
    const input = {
      id: event.id,
      projectId: event.projectId,
      state: event.state,
      actorId: event.actorId,
      eventType: event.eventType,
      payload: event.payload,
      previousHash: event.previousHash,
      serverTimestamp: event.serverTimestamp,
    };
    const expected = createHmac("sha256", secret).update(JSON.stringify(canonical(input))).digest("hex");
    assert.equal(event.eventHash, expected, "continuity event HMAC must be valid");
    previous = event.eventHash;
  }
  assert.ok(events.length >= 1);
  const control = (await db.select().from(aiceoControlStateTable).limit(1))[0];
  assert.ok(control && !control.killSwitch && control.queueActive && control.circuitState !== "OPEN");
  for (const alias of ["AI CEO继续", "AICEO继续"]) {
    const resumed = await aiceoContinuityLayer.resume(alias, "aiceo_owner");
    assert.equal(resumed.truthSource, "persistent_state");
    assert.equal(resumed.resume.directive, "completed");
    assert.equal(resumed.resume.node.node, "independent-read-only-acceptance");
    assert.equal(resumed.productionAuthority, false);
  }
  console.log(JSON.stringify({
    state: state.state,
    revision: state.revision,
    eventCount: events.length,
    hmacChainValid: true,
    aliasesVerified: 2,
    resumeNode: state.resumeNode.node,
    productionAuthority: false,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});