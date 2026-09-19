import { createHmac, randomUUID } from "node:crypto";
import { clerkClient, getAuth } from "@clerk/express";
import { asc, desc, eq, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  aiceoAgentRunsTable,
  aiceoAgentVerificationsTable,
  aiceoAuditEventsTable,
  aiceoContinuityStateTable,
  aiceoExecutionContractsTable,
  aiceoExecutionGovernanceLifecycleTable,
} from "@workspace/db/schema";
import { AiceoAgentExecutionProtocol } from "../lib/aiceoAgentExecutionProtocol";
import {
  authorizeAiceoRole,
  aiceoRolesFromPublicMetadata,
} from "../lib/aiceoAuthorization";
import { assertCredentialPersistenceSafe } from "../lib/aiceoCredentialPersistenceFirewall";
import {
  AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID,
  AICEO_ROLE_GOVERNANCE_RULE_ID,
} from "../lib/aiceoGovernanceRoot";
import {
  aiceoGovLoginPage,
  aiceoGovTask73Page,
} from "./aiceoGovPages";

const router = Router();
export const aiceoGovPublicRouter = Router();
const GOV_TASK_ID = "73";
const GOV_REVISION = 49;
export const GOV_TASK_73_CONTRACT_KEY = "aiceo-gov-task-73-role-handoff";
export const GOV_TASK_73_SCOPE_KEY = "aiceoGovernanceTaskId";

const verificationInput = z.object({
  passed: z.boolean(),
  compliance: z.object({
    authority: z.boolean(),
    scope: z.boolean(),
    understanding: z.boolean(),
    intentGate: z.boolean(),
    noDuplicate: z.boolean(),
    noOwnerInterruption: z.boolean(),
    evidence: z.boolean(),
  }).strict(),
  evidence: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
}).strict();

const closureInput = z.object({
  reason: z.string().trim().min(1).max(2000),
  evidence: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
}).strict();

const canonical = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
};

const auditSecret = (): string => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AICEO governance audit signing authority is unavailable");
  }
  return secret;
};

async function appendAudit(
  tx: any,
  input: {
    runId: string;
    clerkUserId: string;
    eventType: "GOV_TASK_73_VERIFIED" | "GOV_TASK_73_REJECTED" | "GOV_TASK_73_CLOSED";
    fromState: string;
    toState: string;
  },
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('aiceo:audit-events'))`);
  const prior = await tx.select({
    hash: aiceoAuditEventsTable.eventHash,
    appendSequence: aiceoAuditEventsTable.appendSequence,
  }).from(aiceoAuditEventsTable)
    .orderBy(desc(aiceoAuditEventsTable.appendSequence))
    .limit(1);
  const id = randomUUID();
  const serverTimestamp = new Date();
  const previousHash = prior[0]?.hash ?? null;
  const payload = {
    task: GOV_TASK_ID,
    who: input.clerkUserId,
    when: serverTimestamp.toISOString(),
    from_state: input.fromState,
    to_state: input.toState,
    clerk_user_id: input.clerkUserId,
    integrityVersion: "hmac-sha256-v1",
  };
  assertCredentialPersistenceSafe(payload, "gov-task-73-audit-event");
  const values = {
    id,
    taskId: null,
    correlationId: input.runId,
    runId: input.runId,
    eventType: input.eventType,
    state: null,
    actorId: input.clerkUserId.slice(0, 180),
    payload,
    previousHash,
    serverTimestamp,
  };
  const eventHash = createHmac("sha256", auditSecret())
    .update(JSON.stringify(canonical(values)))
    .digest("hex");
  return (await tx.insert(aiceoAuditEventsTable).values({
    ...values,
    appendSequence: Number(prior[0]?.appendSequence ?? 0) + 1,
    eventHash,
  }).returning())[0];
}

async function authorizeValidator(req: Request, res: Response): Promise<{
  userId: string;
  roles: string[];
} | null> {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(403).json({ error: "Real Clerk session and exclusive aiceo_validator role required." });
    return null;
  }
  let publicMetadata: Record<string, unknown>;
  try {
    publicMetadata = (await clerkClient.users.getUser(auth.userId)).publicMetadata;
  } catch {
    res.status(403).json({ error: "Current Clerk role authority is unavailable." });
    return null;
  }
  const authorization = authorizeAiceoRole({
    userId: auth.userId,
    sessionClaims: auth.sessionClaims as Record<string, unknown> | null | undefined,
    publicMetadata,
  }, "aiceo_validator");
  if (!authorization.allowed) {
    res.status(403).json({ error: authorization.error });
    return null;
  }
  return {
    userId: authorization.userId,
    roles: [...aiceoRolesFromPublicMetadata(publicMetadata)],
  };
}

export function isAiceoGovTask73Contract(input: {
  idempotencyKey: string;
  continuityRevision: number;
  scope: Record<string, unknown>;
  frozenRules: Record<string, unknown>[];
}): boolean {
  return input.idempotencyKey === GOV_TASK_73_CONTRACT_KEY
    && input.continuityRevision === GOV_REVISION
    && input.scope[GOV_TASK_73_SCOPE_KEY] === GOV_TASK_ID
    && input.frozenRules.some((rule) => rule.id === AICEO_ROLE_GOVERNANCE_RULE_ID);
}

export function hasClosedLifecycle(
  lifecycle: Array<{ state: string }>,
): boolean {
  return lifecycle.some((event) => event.state === "CLOSED");
}

async function loadTask73(tx: any = db, lock = false) {
  const continuity = (await tx.select().from(aiceoContinuityStateTable)
    .orderBy(desc(aiceoContinuityStateTable.updatedAt)).limit(1))[0] ?? null;
  const contractQuery = tx.select().from(aiceoExecutionContractsTable)
    .where(eq(aiceoExecutionContractsTable.continuityRevision, GOV_REVISION))
    .orderBy(desc(aiceoExecutionContractsTable.createdAt));
  const contracts = lock ? await contractQuery.for("update") : await contractQuery;
  const contract = contracts.find((candidate: typeof aiceoExecutionContractsTable.$inferSelect) =>
    isAiceoGovTask73Contract(candidate),
  ) ?? null;
  const runQuery = contract
    ? tx.select().from(aiceoAgentRunsTable)
      .where(eq(aiceoAgentRunsTable.contractId, contract.id))
      .orderBy(desc(aiceoAgentRunsTable.createdAt)).limit(1)
    : null;
  const runRows = runQuery
    ? (lock ? await runQuery.for("update") : await runQuery)
    : [];
  const run = runRows[0] ?? null;
  const verification = run
    ? (await tx.select().from(aiceoAgentVerificationsTable)
      .where(eq(aiceoAgentVerificationsTable.runId, run.id)).limit(1))[0] ?? null
    : null;
  const lifecycle = run
    ? await tx.select().from(aiceoExecutionGovernanceLifecycleTable)
      .where(eq(aiceoExecutionGovernanceLifecycleTable.runId, run.id))
      .orderBy(asc(aiceoExecutionGovernanceLifecycleTable.createdAt))
    : [];
  return { continuity, contract, run, verification, lifecycle };
}

function taskView(snapshot: Awaited<ReturnType<typeof loadTask73>>) {
  const { continuity, contract, run, verification, lifecycle } = snapshot;
  return {
    taskId: GOV_TASK_ID,
    lifecycle: lifecycle.map((event: typeof aiceoExecutionGovernanceLifecycleTable.$inferSelect) => ({
      state: event.state,
      previousState: event.previousState,
      actorId: event.actorId,
      at: event.createdAt,
    })),
    executionIdentity: run?.agentActorId ?? null,
    contractRevision49: contract ? {
      id: contract.id,
      status: contract.status,
      revision: contract.continuityRevision,
      brainActorId: contract.brainActorId,
      roleProfilePresent: true,
      productionAuthority: contract.productionAuthority,
    } : {
      id: null,
      status: "NOT_ISSUED",
      revision: continuity?.revision ?? GOV_REVISION,
      brainActorId: null,
      roleProfilePresent: false,
      productionAuthority: false,
    },
    evidence: {
      run: run?.evidence ?? [],
      verification: verification?.evidence ?? [],
      lifecycle: lifecycle.flatMap(
        (event: typeof aiceoExecutionGovernanceLifecycleTable.$inferSelect) => event.evidence,
      ),
    },
    validatorIdentity: verification?.validatorActorId ?? null,
    verificationResult: verification ? {
      passed: verification.passed,
      finalStatus: verification.finalStatus,
      at: verification.createdAt,
    } : null,
    closureState: hasClosedLifecycle(lifecycle) ? "CLOSED" : "NOT_CLOSED",
  };
}

function assertLegalGrokRun(
  snapshot: Awaited<ReturnType<typeof loadTask73>>,
  validatorUserId: string,
  requiredState: "AWAITING_VERIFICATION" | "VERIFIED",
) {
  if (
    !snapshot.contract
    || snapshot.contract.productionAuthority
    || snapshot.contract.brainActorId !== AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID
    || !snapshot.run
    || snapshot.run.agentActorId !== AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID
    || snapshot.run.agentActorId === validatorUserId
    || snapshot.run.state !== requiredState
  ) {
    throw new Error(
      `Task 73 requires a persisted Grok execution in ${requiredState} with an independent Clerk validator.`,
    );
  }
  return snapshot.run;
}

aiceoGovPublicRouter.get("/login", (_req, res) => {
  res.type("html").send(aiceoGovLoginPage());
});

aiceoGovPublicRouter.get("/tasks/73", (req, res, next) => {
  if (req.accepts(["html", "json"]) !== "html") {
    next();
    return;
  }
  res.type("html").send(aiceoGovTask73Page());
});

router.get("/me", async (req, res) => {
  const principal = await authorizeValidator(req, res);
  if (!principal) return;
  res.json({ userId: principal.userId, roles: principal.roles });
});

router.get("/tasks/73", async (req, res) => {
  const principal = await authorizeValidator(req, res);
  if (!principal) return;
  res.json(taskView(await loadTask73()));
});

router.post("/tasks/73/verify", async (req, res) => {
  const principal = await authorizeValidator(req, res);
  if (!principal) return;
  const parsed = verificationInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const output = await db.transaction(async (tx) => {
      const snapshot = await loadTask73(tx, true);
      const run = assertLegalGrokRun(snapshot, principal.userId, "AWAITING_VERIFICATION");
      const protocol = new AiceoAgentExecutionProtocol(tx, true);
      const result = await protocol.verify(
        run.id,
        parsed.data,
        principal.userId,
        "aiceo_validator",
      );
      await appendAudit(tx, {
        runId: run.id,
        clerkUserId: principal.userId,
        eventType: result.finalStatus === "VERIFIED"
          ? "GOV_TASK_73_VERIFIED"
          : "GOV_TASK_73_REJECTED",
        fromState: "AWAITING_VERIFICATION",
        toState: result.finalStatus,
      });
      return taskView(await loadTask73(tx));
    });
    res.json(output);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/tasks/73/close", async (req, res) => {
  const principal = await authorizeValidator(req, res);
  if (!principal) return;
  const parsed = closureInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const output = await db.transaction(async (tx) => {
      const snapshot = await loadTask73(tx, true);
      if (hasClosedLifecycle(snapshot.lifecycle)) {
        throw new Error("Task 73 is already CLOSED; closure replay is forbidden.");
      }
      const run = assertLegalGrokRun(snapshot, principal.userId, "VERIFIED");
      if (
        !snapshot.verification?.passed
        || snapshot.verification.validatorActorId !== principal.userId
      ) {
        throw new Error("Task 73 closure requires this Clerk validator's persisted verification.");
      }
      const protocol = new AiceoAgentExecutionProtocol(tx, true);
      await protocol.close(
        run.id,
        principal.userId,
        "aiceo_validator",
        parsed.data.reason,
        parsed.data.evidence ?? [],
      );
      await appendAudit(tx, {
        runId: run.id,
        clerkUserId: principal.userId,
        eventType: "GOV_TASK_73_CLOSED",
        fromState: "VERIFIED",
        toState: "CLOSED",
      });
      return taskView(await loadTask73(tx));
    });
    res.json(output);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;