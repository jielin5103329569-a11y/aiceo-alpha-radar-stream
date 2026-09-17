import { createHash, createHmac, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoContinuityEventsTable,
  aiceoContinuityProjectsTable,
  aiceoContinuityStateTable,
  aiceoControlStateTable,
  type AiceoContinuityState,
} from "@workspace/db/schema";
import type { AiceoRole } from "./aiceoAuthorization";

const VERSION = "CONTINUITY-001";
const AUTHORITY = "grok_restricted_development";
const RESUME_ALIASES = new Set(["ai ceo继续", "aiceo继续", "ai ceo continue", "aiceo continue"]);
const TRANSITIONS: Record<AiceoContinuityState, AiceoContinuityState[]> = {
  RUNNING: ["PAUSED", "FAILED", "COMPLETED", "OWNER_GATE"],
  PAUSED: ["RUNNING", "FAILED", "COMPLETED", "OWNER_GATE"],
  FAILED: ["RUNNING", "PAUSED", "OWNER_GATE"],
  COMPLETED: [],
  OWNER_GATE: ["RUNNING", "PAUSED", "FAILED", "COMPLETED"],
};

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
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const signingSecret = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("CONTINUITY-001 signing authority is unavailable");
  return secret;
};
const eventHash = (value: unknown) => createHmac("sha256", signingSecret()).update(JSON.stringify(canonical(value))).digest("hex");

export type ContinuityUpdate = {
  state: AiceoContinuityState;
  currentState: Record<string, unknown>;
  decisionRuleRegistry: Record<string, unknown>[];
  entityRegistry: Record<string, unknown>[];
  aliasDictionary: Record<string, unknown>;
  evidencePointers: Record<string, unknown>[];
  resumeNode: Record<string, unknown>;
  failureReason?: string | null;
  recoveryStrategy?: string | null;
  ownerGateReason?: string | null;
};

export class AiceoContinuityLayer {
  private async project(tx: any) {
    const project = (await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).limit(1))[0];
    if (!project || project.environment !== "development" || project.authority !== AUTHORITY || project.productionAuthority) {
      throw new Error("CONTINUITY-001 persistent project authority is invalid; fail closed");
    }
    return project;
  }

  async snapshot(role: AiceoRole) {
    const project = await this.project(db);
    const state = (await db.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).limit(1))[0];
    if (!state) throw new Error("CONTINUITY-001 persistent state is missing; cannot resume from memory");
    const events = await db.select().from(aiceoContinuityEventsTable)
      .where(eq(aiceoContinuityEventsTable.projectId, project.id))
      .orderBy(desc(aiceoContinuityEventsTable.serverTimestamp), desc(aiceoContinuityEventsTable.id)).limit(100);
    return {
      version: VERSION,
      truthSource: "persistent_state",
      memoryPolicy: "Memory is context, Persistent State is truth",
      role,
      project,
      state,
      events,
      productionAuthority: false,
    };
  }

  async resume(alias: string, role: AiceoRole) {
    const normalized = alias.trim().toLowerCase().replace(/\s+/g, " ");
    if (!RESUME_ALIASES.has(normalized)) throw new Error("不能：未识别恢复别名");
    const snapshot = await this.snapshot(role);
    const state = snapshot.state;
    let directive = "continue";
    let blocker: string | null = null;
    if (state.state === "OWNER_GATE") {
      directive = "owner_action_required";
      blocker = state.ownerGateReason;
    } else if (state.state === "FAILED") {
      directive = state.recoveryStrategy ? "recover" : "blocked";
      blocker = state.failureReason;
    } else if (state.state === "COMPLETED") {
      directive = "completed";
    } else if (state.state === "PAUSED") {
      directive = "resume";
    }
    return { ...snapshot, resume: { directive, blocker, node: state.resumeNode }, productionAuthority: false };
  }

  async update(input: ContinuityUpdate, actorId: string) {
    return db.transaction(async (tx) => {
      const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
      if (!control || control.killSwitch || !control.queueActive || control.circuitState === "OPEN") {
        throw new Error("不能：Kill Switch、Queue 或 Circuit gate 阻止 Continuity 状态推进");
      }
      const project = await this.project(tx);
      const current = (await tx.select().from(aiceoContinuityStateTable)
        .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update"))[0];
      if (!current) throw new Error("不能：持久 Continuity 状态不存在");
      if (input.state !== current.state && !TRANSITIONS[current.state as AiceoContinuityState].includes(input.state)) {
        throw new Error(`不能：非法 Continuity 状态转换 ${current.state}->${input.state}`);
      }
      if (input.state === "FAILED" && !input.failureReason) throw new Error("不能：FAILED 必须记录真实失败原因");
      if (input.state === "OWNER_GATE" && !input.ownerGateReason) throw new Error("不能：OWNER_GATE 必须记录不可代理的 Owner 原因");
      const now = new Date();
      const revision = current.revision + 1;
      const intent = {
        state: input.state,
        currentState: input.currentState,
        decisionRuleRegistry: input.decisionRuleRegistry,
        entityRegistry: input.entityRegistry,
        aliasDictionary: input.aliasDictionary,
        evidencePointers: input.evidencePointers,
        resumeNode: input.resumeNode,
        failureReason: input.failureReason ?? null,
        recoveryStrategy: input.recoveryStrategy ?? null,
        ownerGateReason: input.ownerGateReason ?? null,
        revision,
        productionAuthority: false,
      };
      await tx.update(aiceoContinuityStateTable).set({
        ...intent,
        heartbeatAt: now,
        supervisorVersion: VERSION,
        updatedAt: now,
      }).where(and(eq(aiceoContinuityStateTable.id, current.id), eq(aiceoContinuityStateTable.revision, current.revision)));
      const prior = (await tx.select({ hash: aiceoContinuityEventsTable.eventHash })
        .from(aiceoContinuityEventsTable).orderBy(desc(aiceoContinuityEventsTable.serverTimestamp), desc(aiceoContinuityEventsTable.id)).limit(1))[0];
      const values = {
        id: randomUUID(),
        projectId: project.id,
        state: input.state,
        actorId: actorId.slice(0, 180),
        eventType: "STATE_RECORDED",
        payload: { intentHash: hash(intent), resumeNode: input.resumeNode, revision, supervisorVersion: VERSION, productionAuthority: false },
        previousHash: prior?.hash ?? null,
        serverTimestamp: now,
      };
      const signed = eventHash(values);
      await tx.insert(aiceoContinuityEventsTable).values({ ...values, eventHash: signed });
      return { projectId: project.id, state: input.state, revision, heartbeatAt: now, eventHash: signed, productionAuthority: false };
    });
  }
}

export const aiceoContinuityLayer = new AiceoContinuityLayer();