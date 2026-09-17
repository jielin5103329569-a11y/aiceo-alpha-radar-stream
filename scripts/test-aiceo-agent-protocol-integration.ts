import assert from "node:assert/strict";
import { count } from "drizzle-orm";
import { db } from "@workspace/db";
import { aiceoAgentRunsTable, aiceoAgentVerificationsTable, aiceoCollaborationIssuesTable, aiceoContinuityStateTable, aiceoExecutionContractsTable } from "@workspace/db/schema";
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
  throw ROLLBACK;
 })}catch(e){if(e!==ROLLBACK)throw e}
 assert.deepEqual(await tableCounts(),before);
 console.log(JSON.stringify({contractIdempotency:true,staleRejected:true,scopeDriftRejected:true,independentVerification:true,selfCompletedNotVerified:true,transactionRolledBack:true,productionAuthority:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1});