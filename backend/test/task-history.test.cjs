const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const express=require('express');
const http=require('node:http');
const {fixture,until}=require('./helpers.cjs');
const {JsonlStorage}=require('../dist/storage/JsonlStorage');
const {JsonStorage}=require('../dist/storage/JsonStorage');
const {createAgentsRouter}=require('../dist/api/agents');
const {resolveOperational}=require('../dist/operations/state');
const {projectHistory,retrieveTaskHistory,resolveHistoryConfig,validateHistory}=require('../dist/taskHistory/history');
const {hash}=require('../dist/research/protocol');
const {ResearchService}=require('../dist/research/ResearchService');
const {BranchService}=require('../dist/branches/BranchService');
const worldExample=require('../../examples/transformations-residence.json');
const clone=structuredClone;
const operation=(action,fields={})=>({action,...fields,reason:'Test proposal'});
const propose=(task='light',recipe='light-stove')=>operation('propose_transformation',{transformation_id:recipe,task_id:task,workspace_id:'kitchen-work'});
const contribute=(item,role='input',task='light',inventory='pantry')=>operation('contribute_transformation',{task_id:task,inventory_id:inventory,item_id:item,quantity:1,role});
const taskOp=(action,task='light')=>operation(action,{task_id:task});
const light=()=>[propose(),contribute('match'),contribute('stove','tool'),taskOp('start_transformation')];
const reply=(world=[],speech='',operational=[])=>JSON.stringify({response:speech,memory_operations:[],operational_operations:operational,world_operations:world});
function config(f,extra={}){const world=clone(worldExample);world.initialPositions={bob:'kitchen',sara:'kitchen'};world.inventories=world.inventories.map(i=>({...i,id:i.id.replace('helena','bob').replace('clara','sara'),ownerId:i.ownerId.replace('helena','bob').replace('clara','sara')}));world.transformations.workspaces[0].authorizedAgentIds=['bob','sara'];return {...f.config,maxTurns:1,worldConfig:world,operationalConfig:resolveOperational({enabled:true,locations:[{id:'kitchen',name:'Kitchen'},{id:'outside',name:'Outside'}]}),...extra};}
async function finish(f){await until(()=>['completed','paused'].includes(f.controller.getStatus()));}
const physical=r=>r.records.filter(r=>r.taskType==='transformation');
async function api(t,f){const app=express();app.use(express.json());app.use('/agents',createAgentsRouter(f.storage,f.controller,f.logs));const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}/agents`;}

test('successful lighting projects authoritative completion, match consumption and source effects idempotently',async t=>{
 const f=await fixture(t,()=>reply(light()));await f.controller.start(config(f));await finish(f);assert.equal(f.controller.getStatus(),'completed');
 const records=physical(await f.logs.taskHistory('bob'));assert.equal(records.length,1);const r=records[0];assert.equal(r.status,'completed');assert.equal(r.outcome,'success');assert.equal(r.verification,'authoritative');assert.equal(r.startedAtMinute,0);assert.equal(r.finishedAtMinute,0);assert.deepEqual(r.roles,['proposer','participant','contributor','initiator']);assert.ok(r.evidence.some(e=>e.type==='transformation_input_consumed'&&e.itemId==='match'));assert.ok(r.sourceEventIds.some(id=>id.includes('finish')));
 const state=await f.logs.worldAt(f.config.runId);assert.equal(state.environment['stove-lit'],'true');assert.equal(state.inventories[0].quantities.match,1);
 const before=await fs.readFile(path.join(f.root,'research/task-history/test-run.jsonl'),'utf8');await f.logs.reconcileTaskHistory(f.config.runId);await f.logs.reconcileTaskHistory(f.config.runId);assert.equal(await fs.readFile(path.join(f.root,'research/task-history/test-run.jsonl'),'utf8'),before);validateHistory(records);
});

test('invalid operational transitions reject the complete cooking proposal, preserving original attempt and physical state',async t=>{
 const f=await fixture(t,()=>reply([propose('oatmeal','prepare-oatmeal')],'I intend to cook.',[operation('set_action',{activity_type:'working',description:'Cooking',status:'in_progress'}),operation('set_action',{activity_type:'idle',description:'Resting',status:'planned'})]));await f.controller.start(config(f));await finish(f);assert.equal(f.controller.getStatus(),'paused');
 const history=await f.logs.taskHistory('bob');assert.equal(physical(history).length,0);const attempts=history.records.filter(r=>r.taskType==='proposal');assert.equal(attempts.length,1);assert.equal(attempts[0].outcome,'rejected');assert.equal(attempts[0].verification,'absent');assert.ok(attempts[0].attemptEventIds.length);const state=await f.logs.worldAt(f.config.runId);assert.equal(state.inventories[0].quantities.oats,1);assert.equal(state.inventories.find(i=>i.id==='counter').quantities.oatmeal,undefined);assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,0);
});

test('claimed cooking remains an unverified report, never a completed task or a physical effect',async t=>{
 const claim='I cooked four servings and collected oats.',f=await fixture(t,()=>reply([],claim));const before=clone(await f.storage.loadWorkingState('bob'));await f.controller.start(config(f));await finish(f);const records=(await f.logs.taskHistory('bob')).records;assert.equal(records.length,1);assert.equal(records[0].verification,'agent_reported');assert.equal(records[0].outcome,'reported');assert.equal(physical({records}).length,0);assert.equal((await f.logs.getConversationHistory(f.config.runId))[0].response,claim);assert.deepEqual((await f.storage.loadWorkingState('bob')).entries,before.entries);assert.equal((await f.logs.worldAt(f.config.runId)).environment['stove-lit'],'false');
});

test('cross-experiment continuity retains prior lighting without lighting the new stove; every prompt has bounded separate evidence',async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);return n===0?reply(light()):reply();});const a=config(f,{runId:'experiment-a'});await f.controller.start(a);await finish(f);await f.controller.stop();const b=config(f,{runId:'experiment-b',maxTurns:2,memoryConfig:{mode:'none'}});await f.controller.start(b);await finish(f);assert.equal(f.controller.getStatus(),'completed');
 const state=await f.logs.worldAt('experiment-b');assert.equal(state.environment['stove-lit'],'false');assert.equal(state.inventories[0].quantities.match,2);assert.equal(physical(await f.logs.taskHistory('bob')).filter(r=>r.status==='completed').length,1);assert.equal(physical(await f.logs.taskHistory('bob'))[0].runId,'experiment-a');
 for(const request of requests.slice(1)){const text=request.messages.map(m=>m.content).join('\n');if(text.includes('experiment-a'))assert.match(text,/does not establish present inventory/);}
 const turn=(await f.logs.getConversationHistory('experiment-b'))[0];assert.ok(turn.retrieval.taskHistory.selectedIds.length);assert.ok(turn.retrieval.taskHistory.chars<=6000);assert.equal((await f.storage.loadWorkingState('bob')).entries.length,0);
 assert.equal(b.worldConfig.transformations.recipes[1].requiredEnvironment['stove-lit'],'true');
});

test('stop marks running work interrupted and unresolved, pause does not, restart retains resource policy',async t=>{
 let unblock;const gate=new Promise(r=>unblock=r);const f=await fixture(t,async n=>n===0?reply(light()):(await gate,reply()));const cfg=config(f,{maxTurns:3,recoveryConfig:{enabled:true,persistentConnectivityRecovery:false}});cfg.worldConfig.transformations.recipes[0].durationMinutes=100;
 await f.controller.start(cfg);await until(()=>f.controller.getTurnIndex()===1);const paused=f.controller.pause();unblock();await paused;assert.equal(physical(await f.logs.taskHistory('bob'))[0].status,'in_progress');await f.controller.stop();const r=physical(await f.logs.taskHistory('bob'))[0];assert.equal(r.status,'interrupted');assert.equal(r.outcome,'unresolved');assert.equal(r.finishedAtMinute,null);assert.match(r.reason,/stopped/);assert.ok(r.sourceEventIds.some(id=>!id.includes('turn:')));const state=await f.logs.worldAt(cfg.runId);assert.equal(state.transformations.tasks[0].status,'in_progress');assert.equal(state.inventories[0].quantities.match,2);
 const restarted=f.createController();await restarted.start(await f.logs.loadConfig(cfg.runId));await until(()=>restarted.getStatus()==='completed');assert.equal(physical(await f.logs.taskHistory('bob'))[0].status,'in_progress');assert.equal((await f.logs.worldAt(cfg.runId)).transformations.tasks[0].status,'in_progress');
});

test('cooperative histories credit only explicit participants and each agent’s own contribution',async t=>{
 const f=await fixture(t,n=>n===0?reply(light()):n===1?reply([propose('cook','prepare-oatmeal'),contribute('oats','input','cook'),contribute('pot','tool','cook'),contribute('stove','catalyst','cook')]):n===2?reply([taskOp('join_transformation','cook'),contribute('water','input','cook'),taskOp('start_transformation','cook')]):reply());
 const cfg=config(f,{maxTurns:3});await f.controller.start(cfg);await finish(f);await f.controller.advanceTime(30,'Researcher','Finish task');
 const bob=physical(await f.logs.taskHistory('bob')).find(r=>r.taskId==='cook'),sara=physical(await f.logs.taskHistory('sara')).find(r=>r.taskId==='cook');assert.equal(bob.status,'completed');assert.equal(sara.status,'completed');assert.equal(sara.contributions.every(c=>c.agentId==='sara'),true);assert.deepEqual(bob.contributions.map(c=>c.itemId),['water']);assert.deepEqual(sara.contributions.map(c=>c.itemId),['oats','pot','stove']);assert.ok(!bob.roles.includes('proposer'));assert.equal(physical(await f.logs.taskHistory('sara')).some(r=>r.taskId==='light'),false);
});

test('repeated rejected proposals link to one eventual task without duplicate completions or effects',async t=>{
 const f=await fixture(t,n=>n<2?reply([propose(),contribute('stove','tool'),taskOp('start_transformation')]):reply(light()));const cfg=config(f,{recoveryConfig:{enabled:true,correctiveRetries:3,persistentConnectivityRecovery:false,initialBackoffMs:1,maxBackoffMs:2}});await f.controller.start(cfg);await finish(f);assert.equal(f.controller.getStatus(),'completed');const records=(await f.logs.taskHistory('bob')).records;const task=records.find(r=>r.taskType==='transformation'),attempt=records.find(r=>r.taskType==='proposal');assert.equal(task.status,'completed');assert.equal(attempt.attemptEventIds.length,2);assert.deepEqual(task.attemptEventIds,attempt.attemptEventIds);assert.equal(records.filter(r=>r.taskType==='transformation').length,1);assert.equal(f.stats().requests,3);assert.equal(f.stats().maximum,1);assert.equal((await f.logs.worldAt(cfg.runId)).inventories[0].quantities.match,1);
});

test('technical and malformed inference failures do not invent physical task failure',async t=>{
 const f=await fixture(t,()=>({status:503}));await f.controller.start(config(f));await finish(f);assert.equal((await f.logs.taskHistory('bob')).records.length,0);await f.controller.stop();const g=await fixture(t,()=>'plain text');await g.controller.start(config(g));await finish(g);assert.equal((await g.logs.taskHistory('bob')).records.length,0);
});

test('projection failure after canonical commit is repaired without repeating model inference or consuming twice',async t=>{
 const f=await fixture(t,()=>reply(light()));const original=f.logs.reconcileTaskHistory.bind(f.logs);let failed=false;f.logs.reconcileTaskHistory=async run=>{if(!failed&&(await f.logs.getConversationHistory(run)).length){failed=true;throw Object.assign(new Error('Injected projection error'),{code:'EIO'});}return original(run);};await f.controller.start(config(f,{maxTurns:2}));await finish(f);assert.equal(f.controller.getStatus(),'paused');assert.equal(f.controller.getTurnIndex(),1);assert.equal(f.stats().requests,1);await f.controller.resume();await finish(f); // second reply reuses task ID and should reject, first turn remains committed
 assert.equal(physical(await f.logs.taskHistory('bob')).filter(r=>r.status==='completed').length,1);assert.equal((await f.logs.worldAt(f.config.runId)).inventories[0].quantities.match,1);
});

test('legacy agents and missing history remain readable; trustworthy legacy world events backfill idempotently',async t=>{
 const f=await fixture(t,()=>reply());const before=hash(await f.storage.loadWorkingState('bob'));assert.deepEqual((await f.logs.taskHistory('bob')).records,[]);assert.equal(hash(await f.storage.loadWorkingState('bob')),before);
 const cfg=config(f);await f.logs.saveConfig(cfg.runId,cfg);await f.logs.appendConversationTurn(cfg.runId,{schemaVersion:2,eventId:'legacy-turn',agentId:'bob',turnIndex:0,response:'A claim',environmentEvents:[{id:'legacy-inspect',type:'world_operation',status:'committed',agentId:'bob',simulationMinute:0,requestedOperation:operation('inspect_inventory',{inventory_id:'pantry'}),changes:[]}]});const records=(await f.logs.taskHistory('bob')).records;assert.equal(records.filter(r=>r.verification==='authoritative').length,1);assert.equal(records.find(r=>r.taskType==='world_action').createdAt,null);assert.deepEqual((await f.logs.taskHistory('bob')).records,records);
});

test('queries filter agent/run/task/status and pagination; API resolves archived identities',async t=>{
 const f=await fixture(t,()=>reply(light()));await f.controller.start(config(f));await finish(f);const base=await api(t,f);assert.equal((await fetch(base+'/bob/task-history?status=completed&taskId=light&limit=1')).status,200);const result=await (await fetch(base+'/bob/task-history?status=completed&taskId=light&limit=1')).json();assert.equal(result.total,1);assert.equal(result.records[0].agentId,'bob');assert.equal((await fetch(base+'/bob/task-history?limit=0')).status,400);assert.equal((await fetch(base+'/missing/task-history')).status,404);await f.controller.stop();await f.controller.archiveAgent('bob');assert.equal((await fetch(base+'/bob/task-history')).status,200);
});

test('context settings strictly validate and bound output without copying all history or unverified reports',()=>{
 const cfg={agentIds:['bob'],worldConfig:{enabled:true,transformations:{recipes:[]}}},turn={schemaVersion:2,eventId:'turn',agentId:'bob',turnIndex:0,response:'Claim',environmentEvents:[{id:'take',type:'world_operation',status:'committed',agentId:'bob',simulationMinute:0,requestedOperation:operation('take_item',{source_inventory_id:'pantry',destination_inventory_id:'bag',item_id:'oats',quantity:1}),changes:[]}]};const records=projectHistory('a',cfg,[turn],[]);
 for(const input of [{maxChars:-1},{recentCompleted:101},{enabled:'yes'},{unknown:1}])assert.throws(()=>resolveHistoryConfig(input));
 for(const maxChars of [0,100,1000,6000]){const r=retrieveTaskHistory(records,'bob','new',{},resolveHistoryConfig({maxChars}));assert.ok(r.text.length<=maxChars);assert.ok(!r.text.includes('Claim'));}assert.equal(retrieveTaskHistory(records,'bob','new',{},resolveHistoryConfig({enabled:false})).text,'');
});

test('failed and cancelled transformations have authoritative distinct outcomes and do not consume completion-phase inputs',async t=>{
 const f=await fixture(t,n=>n===0?reply(light()):reply([operation('set_location',{location_id:'outside'})]));const cfg=config(f,{maxTurns:1});cfg.worldConfig.transformations.recipes[0].durationMinutes=30;await f.controller.start(cfg);await finish(f);await f.controller.advanceTime(40,'Researcher','Clock check'); // completes normally, establishes comparison case
 assert.equal(physical(await f.logs.taskHistory('bob'))[0].status,'completed');
 const g=await fixture(t,n=>n===0?reply(light()):reply([taskOp('cancel_transformation')]));const cancelled=config(g,{maxTurns:3});cancelled.worldConfig.transformations.recipes[0].durationMinutes=30;await g.controller.start(cancelled);await finish(g); // sara cannot cancel Bob's task; rejected proposal, no cancellation
 assert.equal(g.controller.getStatus(),'paused');assert.equal(physical(await g.logs.taskHistory('bob'))[0].status,'in_progress');
 await g.controller.stop();const h=await fixture(t,n=>n===0?reply(light()):n===1?reply():reply([taskOp('cancel_transformation')]));const hc=config(h,{maxTurns:3});hc.worldConfig.transformations.recipes[0].durationMinutes=30;await h.controller.start(hc);await finish(h);assert.equal(physical(await h.logs.taskHistory('bob'))[0].status,'cancelled');assert.equal(physical(await h.logs.taskHistory('bob'))[0].outcome,'cancelled');assert.equal((await h.logs.worldAt(hc.runId)).inventories[0].quantities.match,2);
 const j=await fixture(t,n=>n===0?reply(light()):n===1?reply():reply([], '',[operation('set_location',{location_id:'outside'})]));const jc=config(j,{maxTurns:3});jc.worldConfig.transformations.recipes[0].durationMinutes=30;await j.controller.start(jc);await finish(j);assert.equal(physical(await j.logs.taskHistory('bob'))[0].status,'failed');assert.equal(physical(await j.logs.taskHistory('bob'))[0].outcome,'failure');assert.equal((await j.logs.worldAt(jc.runId)).inventories[0].quantities.match,2);
});

test('snapshot/branch histories exclude future source outcomes and retain their source run IDs',async t=>{
 const f=await fixture(t,n=>n===0?reply(light()):reply());const cfg=config(f,{maxTurns:1,protocol:{},llmConfig:{...f.config.llmConfig,modelVersion:'mock'}});cfg.worldConfig.transformations.recipes[0].durationMinutes=10;
 await f.controller.start(cfg);await finish(f);const research=new ResearchService(f.controller,f.logs,f.storage),branches=new BranchService(f.controller,f.logs,research),snapshot=await research.snapshot('history-cutoff',cfg.runId,0,'Researcher','No future knowledge');assert.equal(snapshot.taskHistory.find(r=>r.taskType==='transformation').status,'in_progress');await f.controller.advanceTime(20,'Researcher','Future completion');assert.equal(physical(await f.logs.taskHistory('bob'))[0].status,'completed');
 const frozen=await f.logs.snapshotTaskHistory(snapshot,'bob');assert.equal(frozen.find(r=>r.taskType==='transformation').status,'in_progress');assert.equal(frozen.find(r=>r.taskType==='transformation').runId,cfg.runId);
 const branch=await branches.create({branchId:'history-branch',sourceSnapshotId:'history-cutoff',actor:'Researcher',reason:'Isolated past',maxTurns:1});assert.equal(branch.snapshot.taskHistory.find(r=>r.taskType==='transformation').status,'in_progress');await f.controller.stop();await branches.start('history-branch');await finish(f);const inherited=(await f.logs.inferenceTaskHistory('history-branch','bob')).find(r=>r.runId===cfg.runId&&r.taskType==='transformation');assert.equal(inherited.status,'in_progress');
 assert.equal((await f.logs.worldAt(cfg.runId)).transformations.tasks[0].status,'completed');assert.equal((await f.logs.worldAt('history-branch')).transformations.tasks[0].status,'in_progress');
});

test('malformed rejected operation references remain diagnostics instead of breaking projection or granting credit',()=>{
 const cfg={agentIds:['bob'],worldConfig:{enabled:true,transformations:{recipes:[]}}};const events=[{id:'reject',type:'recovery_attempt',category:'schema_validation',stateCommitted:false,agentId:'bob',turnIndex:0,proposedOperations:{world:[{action:'start_transformation',task_id:123},{action:'contribute_transformation',task_id:{invented:true}}]},timestamp:null}];const result=projectHistory('run',cfg,[],events);assert.ok(result.every(r=>r.taskType==='proposal'&&r.outcome==='rejected'));validateHistory(result);
});

test('derived-index corruption is observable and a leased rebuild preserves canonical records and quarantines the cache',async t=>{
 const f=await fixture(t,()=>reply(light()));await f.controller.start(config(f));await finish(f);const before=hash(await f.logs.getConversationHistory(f.config.runId));const index=path.join(f.root,'research/task-history/test-run.jsonl');await fs.appendFile(index,'invalid-index-line\n');await assert.rejects(f.logs.taskHistory('bob'),/projection needs repair/);await assert.rejects(f.logs.rebuildTaskHistory(f.config.runId,'no-lease'),/writer lease/);
 const owner='test-rebuild';await f.logs.acquireWriter(owner);const rebuilt=await f.logs.rebuildTaskHistory(f.config.runId,owner);await f.logs.releaseWriter(owner);assert.ok(rebuilt.quarantined);assert.ok((await fs.readFile(rebuilt.quarantined,'utf8')).endsWith('invalid-index-line\n'));assert.equal(physical(await f.logs.taskHistory('bob'))[0].status,'completed');assert.equal(hash(await f.logs.getConversationHistory(f.config.runId)),before);assert.equal(f.stats().requests,1);
});

test('scheduler checkpoint projection failure reconciles the committed world before any later advancement',async t=>{
 const f=await fixture(t,()=>reply(light()));const cfg=config(f);cfg.worldConfig.transformations.recipes[0].durationMinutes=10;await f.controller.start(cfg);await finish(f);const original=f.logs.reconcileTaskHistory.bind(f.logs);let fail=true;
 f.logs.reconcileTaskHistory=async run=>{if(fail&&(await f.logs.getEventHistory(run)).some(e=>e.type==='world_checkpoint')){fail=false;throw Object.assign(new Error('Index disk failure'),{code:'EIO'});}return original(run);};
 await assert.rejects(f.controller.advanceTime(20,'Researcher','Complete work'),/Index disk/);assert.equal(f.controller.getState().worldState.minute,20);assert.equal(f.controller.getState().worldState.transformations.tasks[0].status,'completed');await f.controller.advanceTime(20,'Researcher','Repair projection');assert.equal(physical(await f.logs.taskHistory('bob')).filter(r=>r.status==='completed').length,1);const world=await f.logs.worldAt(cfg.runId);assert.equal(world.inventories[0].quantities.match,1);assert.equal(world.transformations.ledger.filter(e=>e.type==='transformation_completed').length,1);assert.equal(f.stats().requests,1);
});

test('ordinary transfers, inspection and consumption project discrete authoritative actions only for their actor',async t=>{
 const f=await fixture(t,n=>n===0?reply([operation('take_item',{source_inventory_id:'counter',destination_inventory_id:'bob-bag',item_id:'oatmeal',quantity:1})]):n===1?reply([operation('inspect_inventory',{inventory_id:'pantry'})]):reply([operation('consume_item',{inventory_id:'bob-bag',item_id:'oatmeal',quantity:1})]));const cfg=config(f,{maxTurns:3});cfg.worldConfig.inventories.find(i=>i.id==='counter').quantities.oatmeal=1;await f.controller.start(cfg);await finish(f);const bob=(await f.logs.taskHistory('bob')).records,sara=(await f.logs.taskHistory('sara')).records;assert.deepEqual(bob.map(r=>r.description).sort(),['consume_item','take_item']);assert.equal(sara[0].description,'inspect_inventory');assert.ok([...bob,...sara].every(r=>r.status==='completed'&&r.verification==='authoritative'));assert.equal((await f.logs.worldAt(cfg.runId)).inventories.find(i=>i.id==='bob-bag').quantities.oatmeal,0);
});

test('structured operational intentions and claimed completion stay agent-reported without manufacturing verified work',async t=>{
 const f=await fixture(t,()=>reply([],'I say the meal is finished.',[operation('set_action',{activity_type:'working',description:'Cooking a meal',status:'completed'})]));await f.controller.start(config(f));await finish(f);const result=(await f.logs.taskHistory('bob')).records;const intention=result.find(r=>r.taskType==='intention');assert.equal(intention.description,'Cooking a meal');assert.equal(intention.verification,'agent_reported');assert.equal(intention.outcome,'reported');assert.notEqual(intention.status,'completed');assert.equal(result.some(r=>r.verification==='authoritative'&&r.status==='completed'),false);assert.equal((await f.logs.worldAt(f.config.runId)).environment['stove-lit'],'false');
});

test('restoring a stopped run does not invent a resume or erase interruption evidence',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,async n=>n===0?reply(light()):(await gate,reply()));const cfg=config(f,{maxTurns:3,recoveryConfig:{enabled:true,persistentConnectivityRecovery:false}});cfg.worldConfig.transformations.recipes[0].durationMinutes=100;await f.controller.start(cfg);await until(()=>f.controller.getTurnIndex()===1);const stopping=f.controller.stop();release();await stopping;assert.equal(physical(await f.logs.taskHistory('bob'))[0].status,'interrupted');const before=(await f.logs.getEventHistory(cfg.runId)).filter(e=>e.type==='task_history_control'&&e.action==='resumed').length;const restored=f.createController();await restored.restore();assert.equal(restored.getStatus(),'stopped');assert.equal(physical(await f.logs.taskHistory('bob'))[0].status,'interrupted');assert.equal((await f.logs.getEventHistory(cfg.runId)).filter(e=>e.type==='task_history_control'&&e.action==='resumed').length,before);
});
