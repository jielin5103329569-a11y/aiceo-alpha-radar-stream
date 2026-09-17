import assert from "node:assert/strict";
import { count, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { aiceoAgentRunsTable, aiceoAgentVerificationsTable, aiceoCollaborationIssuesTable, aiceoContinuityStateTable, aiceoControlStateTable, aiceoExecutionContractsTable } from "@workspace/db/schema";
import { AiceoAgentExecutionProtocol } from "../artifacts/api-server/src/lib/aiceoAgentExecutionProtocol";
const ROLLBACK=Symbol("rollback");
const tableCounts=async()=>Object.fromEntries(await Promise.all([
 ["contracts",aiceoExecutionContractsTable],["runs",aiceoAgentRunsTable],["verifications",aiceoAgentVerificationsTable],["issues",aiceoCollaborationIssuesTable],
].map(async([k,t]:any)=>[k,Number((await db.select({n:count()}).from(t))[0].n)])));
async function main(){
 const before=await tableCounts();
 try{await db.transaction(async tx=>{
  const protocol=new AiceoAgentExecutionProtocol(tx,true),revision=(await tx.select().from(aiceoContinuityStateTable).limit(1))[0].revision;
  const input={idempotencyKey:"isolated-contract",ownerIntent:"Complete a safe development check",continuityRevision:revision,scope:{allowedOperations:["code.inspect"]},objective:"Produce evidence",allowedCapabilities:["code.inspect"],deniedCapabilities:[],frozenRules:[{id:"001-013",frozen:true}],completionDefinition:{result:true},evidenceRequirements:[{type:"fact"}],executionPolicy:{timeoutMs:10000,maxRetries:1,maxCalls:2,maxCostMicrousd:1000,checkpointRequired:true},resumeNode:{node:"test"},escalationConditions:[{target:"brain",condition:"question"},{target:"owner",condition:"true_owner_gate"}],ownerAttentionBudget:{maxOwnerInterruptions:1,mergeHumanActions:true,noScreenshotWhenAutoVerifiable:true},maxDelegationDepth:1};
  const contract=await protocol.issue(input,"brain");
  assert.equal((await protocol.issue(input,"brain")).id,contract.id);
  await assert.rejects(()=>protocol.issue({...input,idempotencyKey:"stale",continuityRevision:revision-1},"brain"),/stale/);
  const run=await protocol.start(contract.id,{idempotencyKey:"run-1",agentType:"coding",agentActorId:"agent-1",parentRunId:null,delegationDepth:0,inheritedAuthority:"delegated_technical_authority",contextHash:contract.contextHash});
  assert.equal((await protocol.start(contract.id,{idempotencyKey:"run-1",agentType:"coding",agentActorId:"agent-1",parentRunId:null,delegationDepth:0,inheritedAuthority:"delegated_technical_authority",contextHash:contract.contextHash})).id,run.id);
  await assert.rejects(()=>protocol.submit(run.id,{observedScope:["trading"],result:{ok:true},evidence:[{x:1}]}),/scope drift/);
  const submitted=await protocol.submit(run.id,{observedScope:["code.inspect"],result:{ok:true},evidence:[{fact:"checked"}],checkpoint:{node:"done",partialSuccess:false}});
  assert.equal(submitted.verified,false);
  await assert.rejects(()=>protocol.verify(run.id,{passed:true,compliance:{scope:true},evidence:[{fact:true}]},"agent-1"),/independent/);
  const verified=await protocol.verify(run.id,{passed:true,compliance:{authority:true,scope:true,understanding:true,noDuplicate:true,noOwnerInterruption:true,evidence:true},evidence:[{validator:"independent"}]},"validator-1");
  assert.equal(verified.finalStatus,"VERIFIED");
  await assert.rejects(()=>protocol.start(contract.id,{idempotencyKey:"run-replay",agentType:"coding",agentActorId:"agent-2",parentRunId:null,delegationDepth:0,inheritedAuthority:"delegated_technical_authority",contextHash:contract.contextHash}),/contract replay/);

  await assert.rejects(()=>protocol.issue({...input,idempotencyKey:"secret-contract",ownerIntent:"use api_key value"},"brain"),/秘密或凭据/);
  await assert.rejects(()=>protocol.issue({...input,idempotencyKey:"owner-attention-violation",ownerAttentionBudget:{maxOwnerInterruptions:2,mergeHumanActions:false,noScreenshotWhenAutoVerifiable:false}},"brain"),/Owner Attention Budget/);

  const bounded=await protocol.issue({...input,idempotencyKey:"bounded-contract"},"brain");
  await assert.rejects(()=>protocol.start(bounded.id,{idempotencyKey:"bad-context",agentType:"coding",agentActorId:"agent-2",parentRunId:null,delegationDepth:0,inheritedAuthority:"delegated_technical_authority",contextHash:"stale"}),/stale contract/);
  await assert.rejects(()=>protocol.start(bounded.id,{idempotencyKey:"bad-depth",agentType:"coding",agentActorId:"agent-2",parentRunId:null,delegationDepth:2,inheritedAuthority:"delegated_technical_authority",contextHash:bounded.contextHash}),/delegation authority/);
  await assert.rejects(()=>protocol.start(bounded.id,{idempotencyKey:"bad-authority",agentType:"coding",agentActorId:"agent-2",parentRunId:null,delegationDepth:1,inheritedAuthority:"production_authority",contextHash:bounded.contextHash}),/delegation authority/);
  await tx.update(aiceoControlStateTable).set({killSwitch:true});
  await assert.rejects(()=>protocol.start(bounded.id,{idempotencyKey:"control-blocked",agentType:"coding",agentActorId:"agent-2",parentRunId:null,delegationDepth:1,inheritedAuthority:"delegated_technical_authority",contextHash:bounded.contextHash}),/control gate/);
  await tx.update(aiceoControlStateTable).set({killSwitch:false,circuitState:"OPEN"});
  await assert.rejects(()=>protocol.start(bounded.id,{idempotencyKey:"circuit-blocked",agentType:"coding",agentActorId:"agent-2",parentRunId:null,delegationDepth:1,inheritedAuthority:"delegated_technical_authority",contextHash:bounded.contextHash}),/control gate/);
  await tx.update(aiceoControlStateTable).set({circuitState:"CLOSED"});
  const boundedRun=await protocol.start(bounded.id,{idempotencyKey:"bounded-run",agentType:"coding",agentActorId:"agent-2",parentRunId:null,delegationDepth:1,inheritedAuthority:"delegated_technical_authority",contextHash:bounded.contextHash});
  await assert.rejects(()=>protocol.submit(boundedRun.id,{observedScope:["code.inspect"],result:{apiKey:"secret"},evidence:[{fact:true}],usedCalls:1,usedCostMicrousd:1}),/scope drift, secret/);
  await assert.rejects(()=>protocol.submit(boundedRun.id,{observedScope:["code.inspect"],result:{ok:true},evidence:[{fact:true}],usedCalls:3,usedCostMicrousd:1}),/call, or cost budget/);
  await assert.rejects(()=>protocol.checkpoint(boundedRun.id,{state:"PAUSED",checkpoint:{node:"x"},retryCount:2,usedCalls:1,usedCostMicrousd:1}),/retry, call, or cost budget/);
  await assert.rejects(()=>protocol.checkpoint(boundedRun.id,{state:"FAILED",checkpoint:{node:"x"},retryCount:0,usedCalls:1,usedCostMicrousd:1}),/capability blocker/);
  const paused=await protocol.checkpoint(boundedRun.id,{state:"PAUSED",checkpoint:{node:"safe-resume",partialSuccess:true},retryCount:0,usedCalls:1,usedCostMicrousd:10,blocker:null});
  assert.equal(paused.escalateTo,"brain");
  await assert.rejects(()=>protocol.resume(boundedRun.id,"stale"),/stale or non-resumable/);
  const resumed=await protocol.resume(boundedRun.id,bounded.contextHash);
  assert.equal(resumed.checkpoint.node,"safe-resume");
  const failed=await protocol.checkpoint(boundedRun.id,{state:"FAILED",checkpoint:{node:"fallback",partialSuccess:true},retryCount:1,usedCalls:2,usedCostMicrousd:100,blocker:"External Agent unavailable; retain checkpoint and use Brain-approved fallback."});
  assert.equal(failed.escalateTo,"brain");

  const behavior=await protocol.issue({...input,idempotencyKey:"behavior-contract"},"brain");
  await tx.update(aiceoControlStateTable).set({circuitState:"OPEN"});
  await assert.rejects(()=>protocol.start(behavior.id,{idempotencyKey:"behavior-run",agentType:"research",agentActorId:"agent-3",parentRunId:null,delegationDepth:0,inheritedAuthority:"delegated_technical_authority",contextHash:behavior.contextHash}),/control gate/);
  await tx.update(aiceoControlStateTable).set({circuitState:"CLOSED"});
  const behaviorRun=await protocol.start(behavior.id,{idempotencyKey:"behavior-run",agentType:"research",agentActorId:"agent-3",parentRunId:null,delegationDepth:0,inheritedAuthority:"delegated_technical_authority",contextHash:behavior.contextHash});
  await tx.update(aiceoAgentRunsTable).set({deadlineAt:new Date(0)}).where(eq(aiceoAgentRunsTable.id,behaviorRun.id));
  await assert.rejects(()=>protocol.submit(behaviorRun.id,{observedScope:["code.inspect"],result:{ok:true},evidence:[{fact:true}],usedCalls:1,usedCostMicrousd:1}),/timeout/);
  await tx.update(aiceoAgentRunsTable).set({deadlineAt:new Date(Date.now()+10_000)}).where(eq(aiceoAgentRunsTable.id,behaviorRun.id));
  await protocol.submit(behaviorRun.id,{observedScope:["code.inspect"],result:{ok:true},evidence:[{fact:true}],usedCalls:1,usedCostMicrousd:1,checkpoint:{node:"done"}});
  const issuesBefore=Number((await tx.select({n:count()}).from(aiceoCollaborationIssuesTable))[0].n);
  const rejected=await protocol.verify(behaviorRun.id,{passed:true,compliance:{authority:true,scope:true,understanding:true,noDuplicate:true,noOwnerInterruption:false,evidence:true},evidence:[{violation:"unnecessary_owner_interruption"}]},"validator-2");
  assert.equal(rejected.finalStatus,"REJECTED");
  assert.equal(Number((await tx.select({n:count()}).from(aiceoCollaborationIssuesTable))[0].n),issuesBefore+1);
  throw ROLLBACK;
 })}catch(e){if(e!==ROLLBACK)throw e}
 assert.deepEqual(await tableCounts(),before);
 console.log(JSON.stringify({contractIdempotency:true,staleRejected:true,contextBound:true,scopeDriftRejected:true,delegationBounded:true,secretsRejected:true,budgetsEnforced:true,controlGatesEnforced:true,checkpointRecovery:true,capabilityBlockerRequired:true,ownerAttentionBudget:true,behaviorFailureCaptured:true,independentVerification:true,selfCompletedNotVerified:true,transactionRolledBack:true,productionAuthority:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1});