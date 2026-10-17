const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {fixture,until}=require('./helpers.cjs');
const {ResearchService}=require('../dist/research/ResearchService');
const {hash,normalizeProtocol,renderProtocol,shuffled,DEFAULT_SYSTEM_PROMPT}=require('../dist/research/protocol');
const {resolveMemoryConfig}=require('../dist/memory/types');
const {resolveLlmConfig,LlmAdapter}=require('../dist/llm/LlmAdapter');
const reply=(n)=>JSON.stringify({response:`Unchanged model text ${n}\n  Exact spacing.`,memory_operations:[{action:'add',type:'episodic',content:'A new observation',reason:'Observed during the trial'}]});
const service=f=>new ResearchService(f.controller,f.logs,f.storage);
function config(f,extra={}){return {...f.config,maxTurns:2,llmConfig:{...f.config.llmConfig,model:'real-loaded-id',modelVersion:'fixture-weight-hash',temperature:0.4,topP:0.9,seed:123,seedSupported:true,contextWindowTokens:8192},...extra};}
async function start(f,research,batch,runId){await research.startTrial(batch,runId);await until(()=>f.controller.getStatus()==='completed'||f.controller.getStatus()==='paused');}

test('templates and seeded balanced batches freeze prompts, model, budgets and starting state',async t=>{
 const f=await fixture(t,reply);const research=service(f);
 await f.storage.saveAgentMemory('bob',[{id:'start',content:'BOB-PRIVATE'}]);
 const template=await research.template('template',config(f));
 const a=await research.batch('batch-a','template',2,['none','history','enabled'],17,true);
 const b=await research.batch('batch-b','template',2,['none','history','enabled'],17,true);
 assert.equal(a.trials.length,6);
 assert.deepEqual(a.trials.map(r=>[r.memoryConfig.mode,r.protocol.repeatIndex,r.agentIds]),b.trials.map(r=>[r.memoryConfig.mode,r.protocol.repeatIndex,r.agentIds]));
 assert.equal(a.trials.filter(r=>r.memoryConfig.mode==='enabled').length,2);
 for(const r of a.trials){assert.equal(r.protocol.initialStateHash,template.configuration.protocol.initialStateHash);assert.deepEqual(r.llmConfig,template.configuration.llmConfig);assert.equal(r.protocol.systemPrompt,DEFAULT_SYSTEM_PROMPT);}
 await assert.rejects(research.template('template',config(f)),/EEXIST/);
 await assert.rejects(research.batch('batch-a','template',1,['none'],0),/EEXIST/);
 await assert.rejects(research.batch('invalid','template',0,['none'],0),/total trials/);
 await assert.rejects(research.batch('invalid','template',1,['none','none'],0),/distinct/);
 assert.deepEqual(shuffled([1,2,3,4],7),shuffled([1,2,3,4],7));
 assert.notDeepEqual(shuffled([1,2,3,4,5,6],7),shuffled([1,2,3,4,5,6],8));
});

test('all three trial conditions use isolated starting state and only intended context/state policy differs',async t=>{
 const requests=[];const f=await fixture(t,(n,p)=>{requests.push(p);return reply(n);});const research=service(f);
 await f.storage.saveAgentMemory('bob',[{id:'private',content:'BOB-PRIVATE'}]);
 await f.storage.saveAgentBeliefs('sara',[{id:'private-belief',content:'SARA-PRIVATE'}]);
 await research.template('conditions',config(f));
 const manifest=await research.batch('conditions-batch','conditions',1,['none','history','enabled'],9);
 const globalBefore=hash([await f.storage.loadWorkingState('bob'),await f.storage.loadWorkingState('sara')]);
 for(const run of manifest.trials){
  await start(f,research,manifest.batchId,run.runId);assert.equal(f.controller.getStatus(),'completed');
  const turns=await f.logs.getConversationHistory(run.runId);
  assert.equal(turns.length,2);assert.equal(turns[0].stateBefore.entries.length,1);
  if(run.memoryConfig.mode==='enabled'){
   assert.ok(turns[0].prompt.system.includes('BOB-PRIVATE'));assert.equal(turns[0].stateAfter.entries.length,2);
   assert.ok(!turns[0].prompt.system.includes('SARA-PRIVATE'));
  }else{assert.ok(!turns[0].prompt.system.includes('BOB-PRIVATE'));assert.equal(turns[0].stateAfter.entries.length,1);assert.equal(turns[0].auditTrail[0].status,'ignored');}
  if(run.memoryConfig.mode==='none')assert.ok(!turns[1].prompt.system.includes(turns[0].response));
  else assert.ok(turns[1].prompt.system.includes(turns[0].response));
  assert.equal(turns[0].request.seed,123);assert.equal(turns[0].request.top_p,0.9);
  assert.equal(turns[0].configHash,hash(await f.logs.loadConfig(run.runId)));
  assert.equal(turns[0].stateScope,'trial');
 }
 assert.equal(hash([await f.storage.loadWorkingState('bob'),await f.storage.loadWorkingState('sara')]),globalBefore);
 assert.equal(f.stats().maximum,1);
 const comparison=await research.compare(manifest.trials[0].runId,manifest.trials[1].runId);
 assert.ok(comparison.differences.some(d=>d.path==='memoryConfig.mode'));
 assert.ok(!comparison.differences.some(d=>d.path.startsWith('llmConfig')||d.path==='protocol.systemPrompt'||d.path.includes('Chars')));
 assert.equal(comparison.promptingRecorded,true);
});

test('attribute modes are explicit and fixed; arbitrary labels hide named numeric semantics',async t=>{
 const f=await fixture(t,reply);const state=await f.storage.loadWorkingState('bob');const memory=resolveMemoryConfig();
 const arbitrary=normalizeProtocol({attributeMode:'arbitrary'},'enabled');
 const prompt=renderProtocol(state,memory,arbitrary,[]);
 assert.ok(prompt.system.includes('q1: 2'));assert.ok(!prompt.system.includes('curiosity'));
 assert.deepEqual(prompt.retrieval.attributeLabels,{curiosity:'q1'});
 const role=normalizeProtocol({attributeMode:'role',roles:{bob:'Researcher-specified role text'}},'enabled');
 assert.ok(renderProtocol(state,memory,role,[]).system.includes('Researcher-specified role text'));
 assert.ok(!renderProtocol(state,memory,role,[]).system.includes('curiosity:'));
 assert.throws(()=>normalizeProtocol({attributeMode:'numeric',roles:{bob:'Hidden priming'}},'enabled'),/require.*role/);
 await assert.rejects(service(f).template('bad-role',config(f,{protocol:{attributeMode:'role',roles:{bob:'Only one role'}}})),/Each participant/);
 assert.throws(()=>normalizeProtocol({systemPrompt:'Unknown {unsupported}'},'enabled'),/Unknown prompt/);
 const literal=normalizeProtocol({systemPrompt:'{attributes}',attributeMode:'role',roles:{bob:'Literal {memory} text'}},'enabled');
 assert.equal(renderProtocol(state,memory,literal,[]).system,'Literal {memory} text'+require('../dist/memory/operationGuide').memoryOperationGuide(memory));
});

test('seed support, version and prompt budgets are validated without silent fallback',async t=>{
 const f=await fixture(t,reply);const research=service(f);
 assert.throws(()=>resolveLlmConfig({seed:1,seedSupported:false}),/seed support/);
 assert.throws(()=>resolveLlmConfig({topP:2}),/topP/);
 assert.throws(()=>resolveLlmConfig({maxTokens:2048,contextWindowTokens:1024}),/context/);
 await assert.rejects(research.template('no-version',{...f.config,llmConfig:{...f.config.llmConfig,model:'real-loaded-id'}}),/version/);
 await research.template('too-small',config(f,{protocol:{inputCharLimit:10}}));
 const manifest=await research.batch('small','too-small',1,['enabled'],1);
 await start(f,research,'small',manifest.trials[0].runId);
 assert.equal(f.controller.getStatus(),'paused');assert.match(f.controller.getState().error.message,/input character limit/);assert.equal(f.stats().requests,0);
 await f.controller.stop();
 const adapter=new LlmAdapter({...config(f).llmConfig,outputMode:'json_only'});
 await assert.rejects(adapter.generateTurn('S',[{role:'user',content:'U'}],20),/input character limit/);
 assert.equal(f.stats().requests,0);
});

test('snapshots and clones preserve source history, capture lineage and create independent agent state',async t=>{
 const f=await fixture(t,reply);const research=service(f);
 await research.template('source',config(f));const batch=await research.batch('source-batch','source',1,['enabled'],1);
 const runId=batch.trials[0].runId;await start(f,research,'source-batch',runId);
 const historyBefore=hash(await f.logs.getConversationHistory(runId));
 const snapshot=await research.snapshot('after-turn',runId,0,'Researcher','Capture a comparison point');
 assert.equal(snapshot.sourceTurnIndex,0);assert.equal(snapshot.states.bob.entries.length,1);
 await research.clone('after-turn','bob','bob-clone','Researcher','Independent copy');
 const clone=await f.storage.loadWorkingState('bob-clone');assert.equal(clone.identity.id,'bob-clone');
 assert.equal(clone.provenance.snapshotId,'after-turn');assert.equal(clone.provenance.sourceAgentId,'bob');
 clone.entries[0].content='Clone-only revision';await f.storage.saveWorkingState('bob-clone',clone);
 assert.equal((await f.logs.memoryHistory(runId,'bob',0)).state.entries[0].content,'A new observation');
 assert.equal(hash(await f.logs.getConversationHistory(runId)),historyBefore);
 await assert.rejects(research.clone('after-turn','bob','bob-clone','Researcher','No overwrites'),/EEXIST/);
 await research.template('from-snapshot',config(f,{protocol:{snapshotId:'after-turn'}}));
 const template=await f.logs.loadArtifact('templates','from-snapshot');
 assert.equal(template.configuration.protocol.initialStateHash,snapshot.stateHash);
 const notes=await f.logs.readResearch(runId,'interventions');
 assert.ok(notes.some(n=>n.action==='clone'&&n.actor==='Researcher'));
 await assert.rejects(research.snapshot('invalid-turn',runId,undefined,'Researcher','Missing turn'),/integer source turn/);
});

test('standardized multi-turn probes are isolated, logged with exact requests and never alter main history/state',async t=>{
 const requests=[];const f=await fixture(t,(n,p)=>{requests.push(p);return reply(n);});const research=service(f);
 await research.template('probe-template',config(f));const batch=await research.batch('probe-batch','probe-template',1,['enabled'],3);
 const runId=batch.trials[0].runId;await start(f,research,'probe-batch',runId);
 await research.defineProbe('standard-probe',['What do you remember?','What evidence supports that?']);
 const historyBefore=hash(await f.logs.getConversationHistory(runId));
 const stateBefore=hash(await f.logs.trialStorage(runId).loadWorkingState('bob'));
 const beforeCalls=f.stats().requests;
 const result=await research.probe(runId,'bob',0,'standard-probe','Researcher','Standard comparison');
 assert.equal(result.results.length,2);assert.ok(result.results.every(r=>r.status==='success'&&r.memoryPolicy==='read-only'));
 assert.equal(f.stats().requests,beforeCalls+2);
 assert.equal(result.results[0].request.messages[1].content,'What do you remember?');
 assert.equal(result.results[1].request.messages.at(-2).content,'What evidence supports that?');
 assert.equal(result.results[0].turnIndex,0);assert.equal(result.results[0].runId,runId);
 assert.ok(!result.results[0].prompt.system.includes('Unchanged model text'));
 assert.equal(hash(await f.logs.getConversationHistory(runId)),historyBefore);
 assert.equal(hash(await f.logs.trialStorage(runId).loadWorkingState('bob')),stateBefore);
 await research.intervene(runId,'Researcher','A separate researcher observation');
 const bundle=await research.exportRun(runId);
 assert.equal(bundle.probes.length,2);assert.ok(bundle.probeDefinitions.length===1);
 assert.equal(bundle.template.templateId,'probe-template');assert.equal(bundle.startingSnapshot.stateHash,bundle.config.protocol.initialStateHash);
 const {integrityHash,...rest}=bundle;assert.equal(integrityHash,hash(rest));
 assert.ok(bundle.interventions.every(n=>n.runId===runId&&Number.isInteger(n.turnIndex)));
 assert.ok(bundle.turns.every(turn=>turn.request&&turn.rawResponse&&turn.configHash));
});

test('research inference is blocked during active runs and serialized with resume/start requests',async t=>{
 let release;const gate=new Promise(r=>release=r);
 const f=await fixture(t,async(n)=>{if(n===0)await gate;return reply(n);});const research=service(f);
 await research.template('locking',config(f));const batch=await research.batch('locking-batch','locking',1,['enabled'],5);
 await research.defineProbe('probe',['A fixed probe question']);
 await research.startTrial('locking-batch',batch.trials[0].runId);
 await assert.rejects(research.probe(batch.trials[0].runId,'bob',-1,'probe','Researcher','Blocked while running'),/Pause or stop/);
 await assert.rejects(research.exportRun(batch.trials[0].runId),/Pause or stop/);
 const pause=f.controller.pause();release();await pause;
 const probing=research.probe(batch.trials[0].runId,'bob',0,'probe','Researcher','Probe while paused');
 const resume=f.controller.resume();await probing;await resume;
 await until(()=>f.controller.getStatus()==='completed');assert.equal(f.stats().maximum,1);
 const controls=await f.logs.readResearch(batch.trials[0].runId,'interventions');
 assert.ok(controls.some(n=>n.action==='pause'));assert.ok(controls.some(n=>n.action==='resume'));
});

test('failed probes retain evidence and cannot change conversations or memories',async t=>{
 let invalid=false;const f=await fixture(t,n=>invalid?'Malformed probe':reply(n));const research=service(f);
 await research.template('failure',config(f));const batch=await research.batch('failure-batch','failure',1,['enabled'],1);
 const runId=batch.trials[0].runId;await start(f,research,'failure-batch',runId);
 await research.defineProbe('failed-probe',['Probe A','Probe B']);invalid=true;
 const before=hash(await f.logs.getConversationHistory(runId));
 const result=await research.probe(runId,'bob',0,'failed-probe','Researcher','Test failed output');
 assert.equal(result.results.length,1);assert.equal(result.results[0].status,'error');assert.equal(result.results[0].rawResponse,'Malformed probe');
 assert.equal(hash(await f.logs.getConversationHistory(runId)),before);
});

test('starting snapshot integrity and immutable configuration are enforced across restarts',async t=>{
 const f=await fixture(t,reply);const research=service(f);
 await research.template('integrity',config(f));const batch=await research.batch('integrity-batch','integrity',1,['enabled'],2);
 const run=batch.trials[0];await start(f,research,'integrity-batch',run.runId);
 const configFile=path.join(f.root,'research/experiments',run.runId,'config.json');const before=await fs.readFile(configFile,'utf8');
 await f.createController().start(run);
 assert.equal(await fs.readFile(configFile,'utf8'),before);
 const snapshotFile=path.join(f.root,'research/snapshots/integrity-start.json');const snapshot=JSON.parse(await fs.readFile(snapshotFile,'utf8'));snapshot.states.bob.identity.name='Tampered';await fs.writeFile(snapshotFile,JSON.stringify(snapshot));
 await assert.rejects(research.startTrial('integrity-batch',run.runId),/hash mismatch/);
 assert.equal(await fs.readFile(configFile,'utf8'),before);
});

test('probe budget failures do not misattribute the previous request or model response',async t=>{
 const f=await fixture(t,reply);const research=service(f);
 await research.template('budget-probe',config(f,{protocol:{systemPrompt:'{id}',turnPrompt:'{name}',inputCharLimit:20+require('../dist/memory/operationGuide').memoryOperationGuide({mode:'enabled'}).length+require('../dist/llm/LlmAdapter').outputContract(require('../dist/llm/agentTurnSchema').responseSchema()).length}}));
 const batch=await research.batch('budget-probe-batch','budget-probe',1,['enabled'],2);const runId=batch.trials[0].runId;
 await start(f,research,'budget-probe-batch',runId);await research.defineProbe('budget-probe-definition',['A','B']);
 const before=f.stats().requests;const result=await research.probe(runId,'bob',0,'budget-probe-definition','Researcher','Check a fixed budget');
 assert.equal(result.results[0].status,'success');assert.equal(result.results[1].status,'error');
 assert.equal(result.results[1].request.messages.at(-2).content,'B');assert.equal(result.results[1].llmValidation.stage,'request');assert.equal(result.results[1].rawResponse,undefined);
 assert.equal(f.stats().requests,before+1);
});

test('isolated trial journal recovery repairs only trial state and does not replay inference',async t=>{
 const f=await fixture(t,reply);const research=service(f);
 await research.template('recovery-template',config(f));const batch=await research.batch('recovery-batch','recovery-template',1,['enabled'],3);const runId=batch.trials[0].runId;
 const original=f.logs.trialStorage.bind(f.logs);let shouldFail=true;
 f.logs.trialStorage=(id)=>{
  const store=original(id),save=store.saveWorkingState.bind(store);
  store.saveWorkingState=async(agentId,state)=>{
   if(shouldFail&&state.entries.some(entry=>entry.source?.runId===runId)){shouldFail=false;throw Error('Injected trial projection failure');}
   return save(agentId,state);
  };return store;
 };
 await start(f,research,'recovery-batch',runId);assert.equal(f.controller.getStatus(),'paused');
 assert.equal(f.stats().requests,1);assert.equal(f.controller.getTurnIndex(),1);
 await f.controller.resume();await until(()=>f.controller.getStatus()==='completed');
 assert.equal(f.stats().requests,2);assert.equal((await original(runId).loadWorkingState('bob')).entries.length,1);
 assert.equal((await f.storage.loadWorkingState('bob')).entries.length,0);
 const exported=await research.exportRun(runId);assert.equal(exported.turns.length,2);
 assert.equal(exported.events.filter(event=>event.type==='memory_update').length,2);
 assert.equal(exported.integrityHash,(await research.exportRun(runId)).integrityHash);
});

test('pause during the final protocol turn preserves completed status while recording the request',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,async n=>{if(n===0)await gate;return reply(n);});const research=service(f);
 await research.template('last-turn',config(f,{maxTurns:1}));const batch=await research.batch('last-turn-batch','last-turn',1,['enabled'],0);
 await research.startTrial('last-turn-batch',batch.trials[0].runId);
 const pause=f.controller.pause();release();await pause;
 assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,1);
 const controls=await f.logs.readResearch(batch.trials[0].runId,'interventions');assert.ok(controls.some(n=>n.action==='pause'));
});

test('direct shared-state protocols expose differing starting memory as a configuration difference',async t=>{
 const f=await fixture(t,reply);const research=service(f);
 await f.controller.start(config(f,{runId:'shared-a',protocol:{}}));await until(()=>f.controller.getStatus()==='completed');
 await f.controller.start(config(f,{runId:'shared-b',protocol:{}}));await until(()=>f.controller.getStatus()==='completed');
 const comparison=await research.compare('shared-a','shared-b');
 assert.ok(comparison.differences.some(d=>d.path==='protocol.initialStateHash'));
 const before=await f.logs.loadConfig('shared-a');
 await f.controller.start({...config(f,{runId:'shared-a',protocol:{}})});
 assert.equal(f.controller.getStatus(),'completed');assert.deepEqual(await f.logs.loadConfig('shared-a'),before);
});
