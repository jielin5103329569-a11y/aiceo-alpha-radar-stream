import { and, asc, eq, sql } from "drizzle-orm";
import {
  aiceoControlStateTable, aiceoPreclassificationMemoryInboxTable, db, type AiceoFutureMemorySpace,
} from "@workspace/db";
import { assertCredentialPersistenceSafe } from "./aiceoCredentialPersistenceFirewall";

export const PRECLASSIFICATION_MIGRATION_REQUIREMENTS = {
  scientificClassificationRequired: true,
  allowSplitIntoMultipleFormalNodes: true,
  preserveOriginInboxId: true,
  preserveOriginHash: true,
  independentValidationRequired: true,
  ownerApprovedMigrationRequired: true,
  noAutomaticPromotion: true,
} as const;

export type PreclassificationInboxInput = {
  projectId: string; seedBatchKey: string; stableKey: string; rawSemantics: string;
  sourceContext: Record<string, unknown>; observedAt: Date;
  futureClassificationHints: AiceoFutureMemorySpace[]; transaction?: any;
};
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]),
  ) : value;

export const aiceoPreclassificationInbox = {
  async append(input: PreclassificationInboxInput) {
    const { transaction: _transaction, ...persistentInput } = input;
    assertCredentialPersistenceSafe(persistentInput, "preclassification-inbox");
    const operation = async (tx: any) => {
      const [control] = await tx.select().from(aiceoControlStateTable).limit(1).for("update");
      if (!control?.queueActive || control.killSwitch || control.circuitState !== "CLOSED") {
        throw new Error("Pre-classification inbox is blocked by Queue, Kill Switch, or Circuit Breaker");
      }
      const [existing] = await tx.select().from(aiceoPreclassificationMemoryInboxTable).where(and(
        eq(aiceoPreclassificationMemoryInboxTable.projectId, input.projectId),
        eq(aiceoPreclassificationMemoryInboxTable.stableKey, input.stableKey),
      )).limit(1);
      if (existing) {
        const same = existing.seedBatchKey === input.seedBatchKey
          && existing.rawSemantics === input.rawSemantics
          && existing.observedAt.getTime() === input.observedAt.getTime()
          && JSON.stringify(canonical(existing.sourceContext)) === JSON.stringify(canonical(input.sourceContext))
          && JSON.stringify(existing.futureClassificationHints) === JSON.stringify(input.futureClassificationHints);
        if (!same) throw new Error("Pre-classification stable key conflicts with immutable original semantics");
        return existing;
      }
      const [inserted] = await tx.insert(aiceoPreclassificationMemoryInboxTable).values({
        projectId: input.projectId, seedBatchKey: input.seedBatchKey, stableKey: input.stableKey,
        rawSemantics: input.rawSemantics, sourceType: "owner_statement",
        sourceContext: input.sourceContext, observedAt: input.observedAt,
        futureClassificationHints: input.futureClassificationHints,
        valueTier: "high", epistemicState: "pre_classification_unverified",
        lifecycle: "awaiting_scientific_classification",
        migrationRequirements: { ...PRECLASSIFICATION_MIGRATION_REQUIREMENTS },
        sourceDigest: "db-owned", appendSequence: 0, recordHash: "db-owned",
        operationalInput: false, retrievalAuthority: false, promotionAuthority: false,
        governanceAuthority: false, productionAuthority: false,
        preserveSourceContextTimeSnapshot: true, migrationContractHash: "db-owned",
      }).onConflictDoNothing({
        target: [aiceoPreclassificationMemoryInboxTable.projectId, aiceoPreclassificationMemoryInboxTable.stableKey],
      }).returning();
      if (inserted) return inserted;
      const [record] = await tx.select().from(aiceoPreclassificationMemoryInboxTable).where(and(
        eq(aiceoPreclassificationMemoryInboxTable.projectId, input.projectId),
        eq(aiceoPreclassificationMemoryInboxTable.stableKey, input.stableKey),
      )).limit(1);
      if (!record) throw new Error("Pre-classification append conflict could not be resolved");
      const same = record.seedBatchKey === input.seedBatchKey
        && record.rawSemantics === input.rawSemantics
        && record.observedAt.getTime() === input.observedAt.getTime()
        && JSON.stringify(canonical(record.sourceContext)) === JSON.stringify(canonical(input.sourceContext))
        && JSON.stringify(record.futureClassificationHints) === JSON.stringify(input.futureClassificationHints);
      if (!same) throw new Error("Pre-classification stable key conflicts with immutable original semantics");
      return record;
    };
    return input.transaction ? operation(input.transaction) : db.transaction(operation);
  },
  async inspect(projectId: string, transaction?: any) {
    const executor = transaction ?? db;
    return executor.select().from(aiceoPreclassificationMemoryInboxTable)
      .where(eq(aiceoPreclassificationMemoryInboxTable.projectId, projectId))
      .orderBy(asc(aiceoPreclassificationMemoryInboxTable.appendSequence));
  },
  async verifyIntegrity(projectId: string, transaction?: any) {
    const executor = transaction ?? db;
    const result = await executor.execute(sql`
      WITH ordered AS (
        SELECT i.*,lag(record_hash) OVER (PARTITION BY project_id ORDER BY append_sequence) expected_previous,
          row_number() OVER (PARTITION BY project_id ORDER BY append_sequence) expected_sequence
        FROM aiceo_preclassification_memory_inbox i WHERE project_id=${projectId}::uuid
      ), verified AS (
        SELECT *,
          encode(digest(raw_semantics||':'||source_type||':'||source_context::text||':'||observed_at::text,'sha256'),'hex') expected_source_digest
        FROM ordered
      ), hashes AS (
        SELECT *,
          encode(digest(
            project_id::text||':'||id::text||':'||seed_batch_key||':'||stable_key||':'||
            raw_semantics||':'||source_type||':'||source_context::text||':'||observed_at::text||':'||
            future_classification_hints::text||':'||value_tier||':'||epistemic_state||':'||
            lifecycle||':'||migration_requirements::text||':'||expected_source_digest||':'||
            append_sequence::text||':'||coalesce(previous_hash,'')||':'||operational_input::text||':'||
            retrieval_authority::text||':'||promotion_authority::text||':'||
            governance_authority::text||':'||production_authority::text,'sha256'),'hex') expected_record_hash
        FROM verified
      )
      SELECT count(*)::int count,
        coalesce(bool_and(
          hashes.append_sequence=hashes.expected_sequence
          AND hashes.previous_hash IS NOT DISTINCT FROM hashes.expected_previous
          AND hashes.source_digest=hashes.expected_source_digest
          AND hashes.record_hash=hashes.expected_record_hash
          AND hashes.migration_contract_hash=encode(digest(
            hashes.record_hash||':'||hashes.source_digest||':'||hashes.migration_requirements::text||':'||
            hashes.preserve_source_context_time_snapshot::text,'sha256'),'hex')
          AND manifest.raw_semantics_digest=encode(digest(hashes.raw_semantics,'sha256'),'hex')
          AND hashes.preserve_source_context_time_snapshot
          AND NOT hashes.operational_input AND NOT hashes.retrieval_authority AND NOT hashes.promotion_authority
          AND NOT hashes.governance_authority AND NOT hashes.production_authority
        ),false)
        AND count(*)=8
        AND (SELECT count(*) FROM aiceo_preclassification_seed_manifest)=8 valid
      FROM hashes
      LEFT JOIN aiceo_preclassification_seed_manifest manifest
        ON manifest.seed_batch_key=hashes.seed_batch_key AND manifest.stable_key=hashes.stable_key
    `);
    return result.rows[0] as { count: number; valid: boolean };
  },
};