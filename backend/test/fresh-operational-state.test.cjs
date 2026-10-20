const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {fixture,until}=require('./helpers.cjs');
const {resolveOperational,currentOperational,freshOperationalState}=require('../dist/operations/state');
const {validateStartingDemeanor}=require('../dist/agents/startingDemeanor');
const {ResearchService}=require('../dist/research/ResearchService');
const {BranchService}=require('../dist/branches/BranchService');
const {hash}=require('../dist/research/protocol');
const ids=['agent-06','agent-07','agent-08'];
const descriptions=['Waiting for oatmeal to finish cooking','Standing down from assembly; my blue kit is complete and verified','Standing down from kit assembly, bench clear'];
const op=resolveOperational({enabled:true,locations:[{id:'workshop',name:'Workshop'},{id:'bench',name:'Assembly bench'}],observationPolicy:'co_located'});
const action=(description='Inspecting current workshop materials')=>({action:'set_action',activity_type:'observing',description,status:'in_progress',reason:'Current-run activity'});
const response=(operations=[])=>JSON.stringify({response:'',memory_operations:[],operational_operations:operations,world_operations:[]});
function cfg(f,extra={}){return {...f.config,agentIds:ids,maxTurns:3,operationalConfig:op,worldConfig:{enabled:true,initialPositions:{'agent-06':'workshop','agent-07':'bench','agent-08':'workshop'},items:[{id:'red',name:'Red component',unit:'component',stackable:true,consumable:false},{id:'blue',name:'Blue component',unit:'component',stackable:true,consumable:false}],inventories:[{id:'stock',ownerType:'location',ownerId:'workshop',visibility:'local',authorizedAgentIds:[],quantities:{red:2,blue:2}}]},...extra};}
async function seed(f){
 for(const [index,id]of ids.entries()){
  await f.storage.saveAgentIdentity(id,{id,name:['Diane','Miriam','Owen'][index],stats:{curiosity:{initial:4,current:6}},startingDemeanor:validateStartingDemeanor({type:'helpful'}),memories:[],beliefs:[]});
  const state=await f.storage.loadWorkingState(id);state.operational={location:{id:'kitchen',name:'Old kitchen'},action:{type:index?'working':'idle',description:descriptions[index],status:index?'completed':'planned'},source:{runId:'previous-work',turnIndex:index,eventId:'old-action-'+index},outcomeVerified:false};
  state.entries=['episodic','belief','self_description','relationship'].map((type,i)=>({id:id+'-entry-'+i,type,content:['I cooked with Charles in a previous experiment.','My prior assembly opinion.','A learned self description.','I worked with Miriam and Owen before.'][i],confidence:.7,status:'active',source:{runId:'previous-work',turnIndex:0,eventId:'old-memory'},updated_source:null,created_at:null,updated_at:null,...(type==='relationship'?{relationship_agent_id:ids[(index+1)%3]}:{})}));
  await f.storage.saveWorkingState(id,state);await f.storage.setArchived(id,false);
 }
 const oldConfig={runId:'previous-work',agentIds:ids,worldConfig:{enabled:true,transformations:{recipes:[{id:'old-assembly',name:'Earlier verified assembly',inputs:[],outputs:[{itemId:'old-kit',quantity:1}]}]}}};
 await f.logs.saveConfig('previous-work',oldConfig);
 const task={id:'old-task',recipeId:'old-assembly',workspaceId:'old-bench',creatorId:ids[1],participants:[ids[1],ids[2]],status:'completed',contributions:[],createdMinute:0,startedMinute:0,completionMinute:10,finishedMinute:10};
 const record={schemaVersion:2,eventId:'previous-work:turn:0',agentId:ids[1],turnIndex:0,response:'Earlier report',timestamp:'2026-01-01T00:00:00Z',memoryMode:'history',stateAfter:await f.storage.loadWorkingState(ids[1]),auditTrail:[],environmentEvents:[{id:'old-verified-completion',type:'transformation_completed',taskId:task.id,recipeId:task.recipeId,simulationMinute:10,before:{...task,status:'in_progress'},after:task,outputs:oldConfig.worldConfig.transformations.recipes[0].outputs}]};
 await f.logs.appendConversationTurn('previous-work',record);await f.logs.projectTurn('previous-work',record,f.storage);
}
async function finished(f){await until(()=>['completed','paused'].includes(f.controller.getStatus()));await f.controller.activePromise;}
async function states(f){return Object.fromEntries(await Promise.all(ids.map(async id=>[id,await f.storage.loadWorkingState(id)])));}
const initialization=async(f,runId=f.config.runId)=>(await f.logs.getEventHistory(runId)).filter(e=>e.type==='operational_initialization');

test('Diane, Miriam and Owen enter a new workshop with neutral activity, independent stock and intact identity/history',async t=>{
 let release;const gate=new Promise(r=>release=r),requests=[];const f=await fixture(t,async(n,request)=>{requests.push(request);if(n===0)await gate;return response();},[]);await seed(f);const before=await states(f),past=await f.logs.taskHistory(ids[1]),oldTurns=hash(await f.logs.getConversationHistory('previous-work'));
 await f.controller.start(cfg(f));await until(()=>requests.length===1);const snapshot=await f.controller.getSnapshot();for(const id of ids){assert.equal(snapshot.operationalStates[id].location.id,id===ids[1]?'bench':'workshop');assert.deepEqual(snapshot.operationalStates[id].action,{type:'idle',description:'No current activity.',status:'completed'});assert.equal(snapshot.operationalStates[id].outcomeVerified,false);}
 assert.deepEqual(await states(f),before); // Initialization is run-local before any committed turn.
 const baseline=await f.logs.loadBaseline(f.config.runId);for(const id of ids){assert.deepEqual(baseline.states[id].entries,before[id].entries);assert.deepEqual(baseline.states[id].identity,before[id].identity);assert.equal(baseline.states[id].operational.source,undefined);}
 assert.equal((await initialization(f)).length,1);const audit=(await initialization(f))[0];assert.deepEqual(audit.agentIds,ids);assert.equal(audit.source,'backend_initialization');assert.equal(audit.before[ids[0]].action.description,descriptions[0]);assert.equal(audit.outcomeVerified,false);
 release();await finished(f);assert.equal(f.controller.getStatus(),'completed');const turns=await f.logs.getConversationHistory(f.config.runId);for(const turn of turns){assert.equal(turn.operationalContext.own.action.description,'No current activity.');assert.ok(turn.operationalContext.observations.every(o=>o.operational.action.description==='No current activity.'));assert.equal(turn.stateBefore.operational.location.id,turn.agentId===ids[1]?'bench':'workshop');}
 assert.ok(!requests[0].messages[0].content.includes(descriptions[0]));assert.ok(requests[0].messages[0].content.includes('I cooked with Charles'));assert.ok(requests[1].messages[0].content.includes('Earlier verified assembly'));assert.deepEqual(await f.logs.taskHistory(ids[1]),past);assert.equal(hash(await f.logs.getConversationHistory('previous-work')),oldTurns);
 for(const id of ids){const now=await f.storage.loadWorkingState(id);assert.deepEqual(now.entries,before[id].entries);assert.deepEqual(now.identity,before[id].identity);assert.equal((await f.storage.loadAgentIdentity(id)).archived,false);}
 assert.deepEqual(f.controller.getState().worldState.inventories[0].quantities,{red:2,blue:2});assert.equal((await initialization(f)).length,1);
});

test('pause/resume and backend recovery preserve committed in-progress action without reinitializing',async t=>{
 const f=await fixture(t,n=>response(n===0?[action()]:[]),[]);await seed(f);const config=cfg(f,{recoveryConfig:{enabled:true,persistentConnectivityRecovery:false}});let pause;const off=f.controller.onEvent((type)=>{if(type==='turn_completed'&&!pause)pause=f.controller.pause();});await f.controller.start(config);await until(()=>!!pause);await pause;off();assert.equal(f.controller.getStatus(),'paused');assert.equal((await f.controller.getSnapshot()).operationalStates[ids[0]].action.status,'in_progress');const baselineBytes=await fs.readFile(path.join(f.root,'research/experiments/test-run/memory-baseline.json'),'utf8');await f.controller.stop();
 const restored=f.createController();await restored.restore();assert.equal(restored.getStatus(),'stopped');assert.equal((await restored.getSnapshot()).operationalStates[ids[0]].action.description,'Inspecting current workshop materials');// Restoring itself must not infer or reset.
 const saved=await f.logs.loadConfig(config.runId);await restored.start(saved);await until(()=>restored.getStatus()==='completed');await restored.activePromise;const turns=await f.logs.getConversationHistory(config.runId);assert.equal(turns[1].stateBefore.operational.action.description,'No current activity.');assert.equal((await restored.getSnapshot()).operationalStates[ids[0]].action.status,'in_progress');assert.equal((await initialization(f)).length,1);assert.equal(await fs.readFile(path.join(f.root,'research/experiments/test-run/memory-baseline.json'),'utf8'),baselineBytes);assert.equal(f.stats().requests,3);
});

test('same-controller Resume preserves activity on the next round and initializes only once',async t=>{
 const f=await fixture(t,n=>response(n===0?[action('Current assembly underway')]:[]),[]);await seed(f);let pause;const off=f.controller.onEvent(type=>{if(type==='turn_completed'&&!pause)pause=f.controller.pause();});const config=cfg(f,{maxTurns:4});await f.controller.start(config);await until(()=>!!pause);await pause;off();await f.controller.resume();await finished(f);const turns=await f.logs.getConversationHistory(config.runId);assert.equal(turns[3].operationalContext.own.action.description,'Current assembly underway');assert.equal(turns[3].operationalContext.own.action.status,'in_progress');assert.equal((await initialization(f)).length,1);
});

test('snapshot/branch continuation retains active state; a separate independent run gets a fresh baseline',async t=>{
 const f=await fixture(t,n=>response(n===0?[action('Working on the current red kit')]:[]),[]);await seed(f);const config=cfg(f,{maxTurns:1,protocol:{},llmConfig:{...f.config.llmConfig,modelVersion:'mock'}});await f.controller.start(config);await finished(f);const research=new ResearchService(f.controller,f.logs,f.storage),branches=new BranchService(f.controller,f.logs,research);const snapshot=await research.snapshot('activity-point',config.runId,0,'Researcher','Continue active work');assert.equal(snapshot.states[ids[0]].operational.action.description,'Working on the current red kit');const sourceHash=hash(snapshot);await f.controller.stop();const branch=await branches.create({branchId:'activity-branch',sourceSnapshotId:'activity-point',actor:'Researcher',reason:'Continuation',maxTurns:1});assert.equal(branch.configuration.operationalInitializationVersion,undefined);await branches.start('activity-branch');await finished(f);assert.equal((await f.logs.getConversationHistory('activity-branch'))[0].operationalContext.own.action.description,'Working on the current red kit');assert.equal((await initialization(f,'activity-branch')).length,0);assert.equal(hash(await f.logs.loadArtifact('snapshots','activity-point')),sourceHash);
 await f.controller.stop();await f.controller.start(cfg(f,{runId:'independent-workshop',maxTurns:1}));await finished(f);assert.equal((await f.logs.getConversationHistory('independent-workshop'))[0].operationalContext.own.action.description,'No current activity.');assert.equal((await f.logs.memoryHistory(config.runId,ids[0],0)).state.operational.action.description,'Working on the current red kit');
});

test('failed initialization and retry never partially mutate canonical agents or duplicate initialization evidence',async t=>{
 const f=await fixture(t,()=>response(),[]);await seed(f);const before=await states(f),past=await f.logs.taskHistory(ids[1]),ensure=f.logs.ensureMemoryBaseline.bind(f.logs);let fail=true;f.logs.ensureMemoryBaseline=async(...args)=>{if(fail){fail=false;throw Object.assign(new Error('Injected initialization write failure'),{code:'EIO'});}return ensure(...args);};const config=cfg(f,{protocol:{},llmConfig:{...f.config.llmConfig,modelVersion:'mock'}});await assert.rejects(f.controller.start(config),/initialization write failure/);assert.deepEqual(await states(f),before);assert.deepEqual(await f.logs.taskHistory(ids[1]),past);assert.equal((await initialization(f)).length,0);await f.controller.start(config);await finished(f);assert.equal(f.controller.getStatus(),'completed');assert.equal((await initialization(f)).length,1);assert.equal((await f.logs.getConversationHistory(config.runId))[0].operationalContext.own.action.description,'No current activity.');
});

test('failure before configuration commit leaves persistent agent state and historical evidence unchanged',async t=>{
 const f=await fixture(t,()=>response(),[]);await seed(f);const before=await states(f),save=f.logs.saveConfig.bind(f.logs);let fail=true;f.logs.saveConfig=async(...args)=>{if(fail){fail=false;throw new Error('Configuration write rejected');}return save(...args);};await assert.rejects(f.controller.start(cfg(f)),/Configuration write rejected/);assert.deepEqual(await states(f),before);assert.equal(await f.logs.loadConfig(f.config.runId),null);assert.equal((await initialization(f)).length,0);await f.controller.start(cfg(f));await finished(f);assert.equal((await initialization(f)).length,1);
});

test('legacy saved runs keep their historical activity and baseline bytes',async t=>{
 const f=await fixture(t,()=>response(),[]);await seed(f);const config=cfg(f,{maxTurns:1});await f.logs.saveConfig(config.runId,{...config,worldConfig:require('../dist/world/simulation').resolveWorld(config.worldConfig,ids,op),llmConfig:require('../dist/llm/LlmAdapter').resolveLlmConfig({...config.llmConfig,model:'real-loaded-id'})});const statesBefore=await states(f);for(const state of Object.values(statesBefore))state.operational.location={id:'workshop',name:'Workshop'};await f.logs.ensureMemoryBaseline(config.runId,-1,statesBefore);const original=await fs.readFile(path.join(f.root,'research/experiments/test-run/memory-baseline.json'),'utf8');await f.controller.start(config);await finished(f);assert.equal((await f.logs.getConversationHistory(config.runId))[0].operationalContext.own.action.description,descriptions[0]);assert.equal((await initialization(f)).length,0);assert.equal(await fs.readFile(path.join(f.root,'research/experiments/test-run/memory-baseline.json'),'utf8'),original);
});

test('neutral projection is pure and non-world operational runs use the configured unspecified location',async t=>{
 const f=await fixture(t,()=>JSON.stringify({response:'',memory_operations:[],operational_operations:[]}),[]);await seed(f);const before=await f.storage.loadWorkingState(ids[0]),projected=freshOperationalState(before);assert.deepEqual(await f.storage.loadWorkingState(ids[0]),before);assert.equal(projected.operational.location.id,'unspecified');assert.deepEqual(projected.identity,before.identity);const config=cfg(f,{worldConfig:undefined,maxTurns:1});await f.controller.start(config);await finished(f);assert.equal((await f.logs.getConversationHistory(config.runId))[0].operationalContext.own.location.id,'unspecified');assert.equal((await f.logs.getConversationHistory(config.runId))[0].operationalContext.own.action.description,'No current activity.');
});

test('initialization audit acknowledgment failure reuses its baseline and durable event exactly once',async t=>{
 const f=await fixture(t,()=>response(),[]);await seed(f);const before=await states(f),append=f.logs.appendEvent.bind(f.logs);let fail=true;
 f.logs.appendEvent=async(run,event)=>{await append(run,event);if(fail&&event.type==='operational_initialization'){fail=false;throw new Error('Initialization acknowledgment lost');}};
 await assert.rejects(f.controller.start(cfg(f)),/acknowledgment lost/);assert.deepEqual(await states(f),before);const saved=await fs.readFile(path.join(f.root,'research/experiments/test-run/memory-baseline.json'),'utf8');assert.equal((await initialization(f)).length,1);
 await f.controller.start(cfg(f));await finished(f);assert.equal((await initialization(f)).length,1);assert.equal(await fs.readFile(path.join(f.root,'research/experiments/test-run/memory-baseline.json'),'utf8'),saved);assert.equal((await f.logs.getConversationHistory(f.config.runId))[0].operationalContext.own.action.description,'No current activity.');
});
