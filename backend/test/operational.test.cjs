const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const express=require('express');
const {fixture,until}=require('./helpers.cjs');
const {currentOperational,resolveOperational,prepareOperational,operationalContext}=require('../dist/operations/state');
const {validateAgentTurn}=require('../dist/llm/agentTurnSchema');
const {ResearchService}=require('../dist/research/ResearchService');
const {BranchService}=require('../dist/branches/BranchService');
const {createAgentsRouter}=require('../dist/api/agents');
const {hash}=require('../dist/research/protocol');
const {JsonStorage}=require('../dist/storage/JsonStorage');
const locations=[{id:'garden',name:'Community Garden',description:'Researcher-defined planting area'},{id:'irrigation',name:'Irrigation beds'}];
const config=extra=>({enabled:true,locations,observationPolicy:'self_only',...extra});
const move=(location_id='garden')=>({action:'set_location',location_id,reason:'Choosing an available destination'});
const activity=(activity_type='working',status='in_progress')=>({action:'set_action',activity_type,description:'Preparing planting beds',status,reason:'Beginning agreed work'});
const response=(operational_operations=[],text='',extra={})=>JSON.stringify({response:text,memory_operations:[],operational_operations,...extra});
const source={runId:'operations',turnIndex:0,eventId:'turn-event'};
async function finish(f){await until(()=>['completed','paused'].includes(f.controller.getStatus()));}

test('new agents persist deterministic defaults; legacy reads expose defaults without rewriting records',async t=>{
 const f=await fixture(t,()=>response());
 const before=await fs.readFile(path.join(f.root,'agents/agents/bob/identity.json'),'utf8');
 assert.equal((await f.storage.loadWorkingState('bob')).operational,undefined);
 assert.deepEqual(currentOperational(await f.storage.loadWorkingState('bob')).action,{type:'idle',description:'Idle',status:'planned'});
 const app=express();app.use(express.json());app.use('/agents',createAgentsRouter(f.storage));const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/agents`;
 const created=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'new',name:'New',stats:{curiosity:{initial:5,current:5}}})});assert.equal(created.status,201);
 const stored=await f.storage.loadWorkingState('new');assert.equal(stored.operational.location.id,'unspecified');assert.equal(stored.operational.outcomeVerified,false);
 const listed=await (await fetch(base)).json();assert.equal(listed.find(agent=>agent.id==='bob').operationalState.location.id,'unspecified');
 assert.equal(await fs.readFile(path.join(f.root,'agents/agents/bob/identity.json'),'utf8'),before);
});

test('registry validation is deterministic, reserved location normalization is idempotent, and unsupported configuration fails',()=>{
 const normalized=resolveOperational(config());assert.deepEqual(resolveOperational(normalized),normalized);assert.equal(normalized.locations[0].id,'unspecified');
 const largest=resolveOperational(config({locations:Array.from({length:30},(_,i)=>({id:`loc-${i}`,name:`Location ${i}`}))}));assert.deepEqual(resolveOperational(largest),largest);
 for(const input of [{enabled:'yes'},{observationPolicy:'omniscient'},{locations:[{id:'bad id',name:'Bad'}]},{locations:[...locations,locations[0]]},{locations:[{id:'unspecified',name:'Invented'}]}])assert.throws(()=>resolveOperational(input),/invalid|duplicate|reserved|location/i);
});

test('atomic batches validate moves, starts, continuations, stops and self-reported statuses without environmental outcomes',async t=>{
 const f=await fixture(t,()=>response()),before=await f.storage.loadWorkingState('bob'),cfg=resolveOperational(config());
 const result=prepareOperational(before,[move(),activity()],cfg,source);assert.equal(result.error,'');assert.equal(result.state.operational.location.id,'garden');assert.equal(result.state.operational.action.type,'working');
 assert.equal(result.audit.length,2);assert.notEqual(result.audit[0].id,result.audit[1].id);assert.equal(result.audit[0].before.location.id,'unspecified');assert.equal(result.audit[1].after.action.status,'in_progress');assert.equal(result.state.operational.source.eventId,result.audit[1].id);
 assert.deepEqual(prepareOperational(result.state,[],cfg,source).state,result.state);
 const stopped=prepareOperational(result.state,[activity('idle')],cfg,source);assert.equal(stopped.state.operational.action.type,'idle');
 for(const status of ['completed','failed'])assert.equal(prepareOperational(result.state,[activity('working',status)],cfg,source).state.operational.outcomeVerified,false);
 for(const operations of [[move('nowhere')],[move(),move('irrigation')],[activity(),activity('idle')],[activity('working','invalid')],[{...move(),agent_id:'sara'}],[{...activity(),description:''}]]){
  if(operations.some(op=>op.agent_id||op.status==='invalid'||op.description===''))assert.throws(()=>prepareOperational(before,operations,cfg,source),/structure/);
  else{const rejected=prepareOperational(before,operations,cfg,source);assert.ok(rejected.error);assert.deepEqual(rejected.state,before);assert.ok(rejected.audit.every(audit=>audit.status==='rejected'&&!audit.after));}
 }
 assert.equal(before.operational,undefined);
});

for(const mode of ['json_schema','json_only'])for(const research of [false,true])test(`${mode}/${research?'research':'standard'}: speech, action-only, combined and intentional continuation preserve single sequential inference`,async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);if(n===0)return response([move(),activity()]);if(n===1)return response([],'I will inspect the beds.');if(n===2)return response();if(n===3)return response([move('irrigation')],'I am starting my inspection.');return response([activity('idle')]);});
 await f.controller.start({...f.config,maxTurns:5,operationalConfig:config(),llmConfig:{...f.config.llmConfig,outputMode:mode,modelVersion:'fixture'},...(research?{protocol:{}}:{})});await finish(f);assert.equal(f.controller.getStatus(),'completed');
 const turns=await f.logs.getConversationHistory('test-run');assert.deepEqual(turns.map(turn=>turn.turnKind),['action_only','speech','intentional_noop','speech_and_action','action_only']);
 assert.equal(turns[0].response,'');assert.equal(turns[2].response,'');assert.deepEqual(turns[2].operationalState,turns[0].operationalState);assert.equal(turns[4].operationalState.action.type,'idle');
 assert.equal(turns[2].operationalContext.own.location.id,'garden');assert.deepEqual(turns[2].operationalContext.observations,[]);
 for(const request of requests){assert.ok(request.messages[0].content.includes('Do not produce filler dialogue'));assert.ok(request.messages[1].content.includes('choose speech'));assert.equal(request.max_tokens,2048);assert.equal(request.response_format.type,mode==='json_schema'?'json_schema':'json_object');}
 assert.equal(f.stats().maximum,1);
 const reloaded=await new JsonStorage(path.join(f.root,'agents')).loadWorkingState('bob');assert.equal(reloaded.operational.action.type,'idle');assert.equal(reloaded.identity.stats.curiosity.initial,2);
 const snapshot=await f.controller.getSnapshot();assert.equal(snapshot.operationalStates.sara.location.id,'irrigation');
 const history=await f.logs.memoryHistory('test-run','bob',4,0);assert.ok(history.diff.operational);assert.ok(history.timeline[0].operationalAudit.length);
});

test('operational validation failure pauses without applying earlier transitions or memory, and Resume retries the failed turn',async t=>{
 const proposed=[move(),move('absent')];const f=await fixture(t,n=>n===0?response(proposed,'An intention',{memory_operations:[{action:'add',type:'belief',content:'Do not commit on failure',reason:'test'}]}):response([move(),activity()]));
 const before=hash(await f.storage.loadWorkingState('bob'));await f.controller.start({...f.config,maxTurns:1,operationalConfig:config()});await finish(f);
 assert.equal(f.controller.getStatus(),'paused');assert.equal(f.controller.getTurnIndex(),0);assert.equal(f.controller.getState().activeAgentId,null);assert.equal(hash(await f.storage.loadWorkingState('bob')),before);assert.equal((await f.logs.getConversationHistory('test-run')).length,0);
 const error=(await f.logs.getEventHistory('test-run')).find(event=>event.type==='experiment_error');assert.equal(error.attempt.operationalAudit.length,2);assert.deepEqual(error.attempt.parsedResponse.operational_operations,proposed);assert.ok(error.attempt.operationalAudit.every(op=>op.status==='rejected'));
 await Promise.all([f.controller.resume(),f.controller.resume()]);await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal((await f.storage.loadWorkingState('bob')).entries.length,0);assert.equal(f.stats().maximum,1);
});

test('malformed or unauthorized operations fail strict schema validation, not silently repaired',()=>{
 for(const operation of [{...move(),agent_id:'sara'},{...activity(),activity_type:'invented'},{...activity(),status:'verified'},{...activity(),description:''},{action:'change_world',reason:'claimed success'}])assert.throws(()=>validateAgentTurn(JSON.parse(response([operation])),false,false,true),/schema/);
 assert.throws(()=>validateAgentTurn({response:'',memory_operations:[]},false,false,true),/schema/);
 assert.doesNotThrow(()=>validateAgentTurn({response:'',memory_operations:[],operational_operations:[]},false,false,true));
});

test('only explicitly configured co-location exposes another recorded state; unspecified location conveys no observations',async t=>{
 const f=await fixture(t,()=>response()),cfg=resolveOperational(config({observationPolicy:'co_located'}));
 const bob=prepareOperational(await f.storage.loadWorkingState('bob'),[move()],cfg,source).state;
 const sara=prepareOperational(await f.storage.loadWorkingState('sara'),[move(),{...activity(),description:'PRIVATE activity'}],cfg,source).state;
 assert.equal(operationalContext(bob,resolveOperational(config()),[sara]).observations.length,0);
 const shared=operationalContext(bob,cfg,[sara]);assert.equal(shared.observations[0].operational.action.description,'PRIVATE activity');assert.equal(shared.outcomesVerified,false);
 assert.equal(operationalContext(await f.storage.loadWorkingState('bob'),cfg,[await f.storage.loadWorkingState('sara')]).observations.length,0);
});

test('operational persistence is independent of withheld structured memory; legacy contracts stay unchanged',async t=>{
 const f=await fixture(t,()=>response([move(),activity()]));await f.controller.start({...f.config,maxTurns:1,memoryConfig:{mode:'none'},operationalConfig:config()});await finish(f);
 assert.equal((await f.storage.loadWorkingState('bob')).operational.action.type,'working');assert.equal((await f.storage.loadWorkingState('bob')).entries.length,0);
 assert.throws(()=>validateAgentTurn(JSON.parse(response()),false,false,false),/schema/);
});

test('social task runs allow silent action with explicit abstention and preserve task settlement',async t=>{
 const f=await fixture(t,n=>response(n===0?[move(),activity()]:[],'',{social:{action:'decline',recipient_id:null}}));
 await f.controller.start({...f.config,maxTurns:2,operationalConfig:config(),socialConfig:{enabled:true},taskConfig:{kind:'public_goods'}});await finish(f);assert.equal(f.controller.getStatus(),'completed');
 const history=await f.logs.getConversationHistory('test-run');assert.equal(history[0].turnKind,'action_only');assert.ok(history[1].environmentEvents.find(event=>event.type==='task_outcome').awards.every(award=>award.abstained&&award.score===0));
});

test('journal recovery reuses accepted operational event IDs and performs no duplicate inference',async t=>{
 const f=await fixture(t,()=>response([move(),activity()]));const original=f.logs.projectTurn.bind(f.logs);let fail=true;
 f.logs.projectTurn=async(...args)=>{if(fail){fail=false;throw Error('Simulated projection failure');}return original(...args);};
 await f.controller.start({...f.config,maxTurns:1,operationalConfig:config()});await finish(f);assert.equal(f.controller.getStatus(),'paused');
 const committed=(await f.logs.getConversationHistory('test-run'))[0];await f.controller.resume();await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,1);
 assert.equal((await f.storage.loadWorkingState('bob')).operational.source.eventId,committed.operationalAudit[1].id);assert.equal((await f.logs.getConversationHistory('test-run')).length,1);
});

test('trial isolation, frozen snapshots, clones, operational branch interventions and exports retain the original baseline',async t=>{
 const f=await fixture(t,n=>response(n===0?[move(),activity()]:[])),research=new ResearchService(f.controller,f.logs,f.storage);
 const sharedBefore=hash(await f.storage.loadWorkingState('bob'));
 await research.template('operational-source',{...f.config,maxTurns:2,operationalConfig:config(),llmConfig:{...f.config.llmConfig,model:'real-loaded-id',modelVersion:'fixture'}});
 const batch=await research.batch('operational-batch','operational-source',1,['enabled'],1);const runId=batch.trials[0].runId;
 await research.startTrial('operational-batch',runId);await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(hash(await f.storage.loadWorkingState('bob')),sharedBefore);
 const sourceHistory=hash(await f.logs.getConversationHistory(runId));await research.snapshot('work-point',runId,1,'Researcher','Freeze working state');
 const sourceSnapshot=await f.logs.loadArtifact('snapshots','work-point'),snapshotHash=hash(sourceSnapshot);
 await research.clone('work-point','bob','bob-copy','Researcher','Preserve operational state');assert.equal((await f.storage.loadWorkingState('bob-copy')).operational.action.type,'working');
 const branches=new BranchService(f.controller,f.logs,research);const branch=await branches.create({branchId:'work-branch',sourceSnapshotId:'work-point',operations:[{kind:'operational',agentId:'bob',operations:[activity('idle')]}],actor:'Researcher',reason:'Explicit recorded activity intervention',maxTurns:1});
 assert.equal(branch.snapshot.states.bob.operational.action.type,'idle');assert.equal(branch.preSnapshot.states.bob.operational.action.type,'working');
 await branches.start('work-branch');await finish(f);assert.equal(f.controller.getStatus(),'completed');
 const bundle=await research.exportRun('work-branch');assert.equal(bundle.baseline.states.bob.operational.action.type,'idle');assert.equal(bundle.branch.interventions[0].details.operationalAudit[0].status,'accepted');
 assert.equal(hash(await f.logs.loadArtifact('snapshots','work-point')),snapshotHash);assert.equal(hash(await f.logs.getConversationHistory(runId)),sourceHistory);
 await f.controller.stop();const restarted=f.createController();await restarted.start(branch.configuration);await until(()=>restarted.getStatus()==='completed');assert.equal((await f.logs.trialStorage('work-branch').loadWorkingState('bob')).operational.action.type,'idle');
});

test('inference failure preserves a completed action and Resume never duplicates its event',async t=>{
 const f=await fixture(t,n=>n===0?response([move(),activity()]):n===1?'invalid plain text':response());
 await f.controller.start({...f.config,maxTurns:2,operationalConfig:config()});await finish(f);assert.equal(f.controller.getStatus(),'paused');assert.equal(f.controller.getTurnIndex(),1);
 const before=hash((await f.logs.getConversationHistory('test-run'))[0]);await Promise.all([f.controller.resume(),f.controller.resume()]);await finish(f);
 assert.equal(f.controller.getStatus(),'completed');const turns=await f.logs.getConversationHistory('test-run');assert.equal(turns.length,2);assert.equal(hash(turns[0]),before);assert.equal((await f.storage.loadWorkingState('bob')).operational.action.type,'working');assert.equal(f.stats().maximum,1);
});

test('historical operational probes record proposals and authorized context without changing working state',async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);return response(n>=2?[move('irrigation')]:[move()]);});const research=new ResearchService(f.controller,f.logs,f.storage);
 await research.template('probe-work',{...f.config,maxTurns:2,operationalConfig:config({observationPolicy:'co_located'}),llmConfig:{...f.config.llmConfig,model:'real-loaded-id',modelVersion:'fixture'}});
 const batch=await research.batch('probe-work-batch','probe-work',1,['enabled'],1);const run=batch.trials[0].runId;await research.startTrial('probe-work-batch',run);await finish(f);
 const storage=f.logs.trialStorage(run),before=hash(await storage.loadWorkingState('bob'));await research.defineProbe('operation-probe',['What activity would you choose?']);
 const probe=await research.probe(run,'bob',1,'operation-probe','Researcher','Check read-only operations');assert.equal(probe.results[0].status,'success');assert.equal(probe.results[0].operationalPolicy,'read-only');assert.equal(probe.results[0].operationalContext.observations[0].agentId,'sara');assert.equal(hash(await storage.loadWorkingState('bob')),before);assert.ok(requests.at(-1).messages[0].content.includes('never applied'));
});

test('100 silent operational turns serialize inference, freeze configuration and never complete work merely as turns pass',async t=>{
 const f=await fixture(t,n=>response(n<2?[move(),activity()]:[]));
 const input={...f.config,maxTurns:100,operationalConfig:config()};const started=f.controller.start(input);
 input.operationalConfig.locations=[];input.operationalConfig.enabled=false;
 await started;await finish(f);assert.equal(f.controller.getStatus(),'completed');
 const turns=await f.logs.getConversationHistory('test-run');assert.equal(turns.length,100);assert.equal(f.stats().maximum,1);
 assert.ok(turns.every(turn=>turn.response===''&&turn.operationalState.action.status==='in_progress'&&turn.operationalState.outcomeVerified===false));
 assert.equal(turns[98].operationalState.source.eventId,turns[0].operationalAudit[1].id);assert.equal(turns[99].turnKind,'intentional_noop');
 assert.equal((await f.logs.loadConfig('test-run')).operationalConfig.enabled,true);
});
