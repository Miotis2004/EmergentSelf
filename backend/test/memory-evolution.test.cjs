const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture, until } = require('./helpers.cjs');
const { MemoryManager } = require('../dist/agents/MemoryManager');
const { resolveMemoryConfig } = require('../dist/memory/types');
const { retrieveMemory, boundedTranscript } = require('../dist/memory/retrieval');
const { JsonlStorage } = require('../dist/storage/JsonlStorage');
const { validateAgentTurn } = require('../dist/llm/agentTurnSchema');
const response = operations => JSON.stringify({ response: 'Original model dialogue.', memory_operations: operations });
const add = (type, content, extra = {}) => ({ action: 'add', type, content, reason: 'Observed in this conversation', confidence: 0.8, importance: 0.7, ...extra });
const ctx = (turnIndex, config = {}) => ({ source: { runId:'run', turnIndex, eventId:`event-${turnIndex}` }, participants:['bob','sara'], config: resolveMemoryConfig(config) });

test('separate episodic/belief/self-description/relationship state with confidence, source and timestamps', async t => {
  const f = await fixture(t, () => response([]));
  const before = await f.storage.loadWorkingState('bob');
  const manager = new MemoryManager(f.storage);
  const result = manager.prepareOperations(before, [add('episodic','A shared observation'), add('belief','A provisional opinion'), add('self_description','A self-reported description'), add('relationship','A relationship belief',{relationship_agent_id:'sara'})], ctx(0));
  assert.equal(before.entries.length,0);
  assert.deepEqual(result.state.entries.map(e => e.type), ['episodic','belief','self_description','relationship']);
  for (const entry of result.state.entries) {
    assert.equal(entry.confidence,0.8); assert.equal(entry.importance,0.7);
    assert.deepEqual(entry.source,ctx(0).source); assert.ok(entry.created_at); assert.equal(entry.created_at,entry.updated_at);
  }
  await f.storage.saveWorkingState('bob',result.state);
  assert.deepEqual(await f.storage.loadWorkingState('bob'),result.state);
  assert.equal((await f.storage.loadWorkingState('sara')).entries.length,0);
  assert.deepEqual(result.state.identity.stats.curiosity,{ initial:2,current:2 });
});

test('belief revisions, explicit contradictions, consolidation and retirement retain before/after provenance', async t => {
  const f = await fixture(t, () => response([]));
  const manager = new MemoryManager(f.storage);
  let result = manager.prepareOperations(await f.storage.loadWorkingState('bob'), [add('belief','Old claim'),add('belief','Second claim')],ctx(0));
  const [first,second] = result.state.entries;
  result = manager.prepareOperations(result.state,[{ action:'update',type:'belief',target_id:first.id,content:'Revised claim',reason:'New evidence',confidence:0.6 }],ctx(2));
  assert.equal(result.auditTrail[0].before[0].content,'Old claim');
  assert.equal(result.auditTrail[0].after[0].content,'Revised claim');
  assert.deepEqual(result.state.entries[0].source,ctx(0).source);
  assert.deepEqual(result.state.entries[0].updated_source,ctx(2).source);
  result = manager.prepareOperations(result.state,[{action:'contradict',type:'belief',target_id:first.id,content:'A conflicting claim',reason:'Contradictory evidence'}],ctx(4));
  const replacement = result.state.entries.at(-1);
  assert.equal(result.state.entries[0].status,'superseded');
  assert.deepEqual(replacement.contradicts,[first.id]);
  result = manager.prepareOperations(result.state,[{action:'consolidate',type:'belief',target_ids:[replacement.id,second.id],content:'An agent-authored consolidated belief',reason:'Combine supporting observations'}],ctx(6));
  const summary = result.state.entries.at(-1);
  assert.deepEqual(summary.consolidated_from,[replacement.id,second.id]);
  assert.equal(result.state.entries.filter(e => e.status==='active').length,1);
  assert.equal(result.state.entries.find(e => e.id===first.id).content,'Revised claim');
  result = manager.prepareOperations(result.state,[{action:'retire',type:'belief',target_id:summary.id,content:'Retire proposal',reason:'No longer supported'}],ctx(8));
  assert.equal(result.state.entries.at(-1).content,'An agent-authored consolidated belief');
  assert.equal(result.state.entries.at(-1).status,'retired');
  assert.equal(result.state.entries.length,4); // Originals are never deleted.
});

test('invalid targets, subjects, metadata, oversized changes and capacity are rejected without partial mutation', async t => {
  const f = await fixture(t, () => response([]));
  const manager = new MemoryManager(f.storage);
  const before = await f.storage.loadWorkingState('bob');
  const privateId = 'saras-private-belief';
  const result = manager.prepareOperations(before,[
    {action:'update',type:'belief',target_id:privateId,content:'Attempted access',reason:'test'},
    add('relationship','Invalid subject',{relationship_agent_id:'unknown'}),
    add('episodic','x'.repeat(6)),
    add('belief','A'),add('belief','B')
  ],ctx(0,{maxActiveEntries:1,maxEntryChars:5}));
  assert.deepEqual(result.auditTrail.map(e => e.status),['failed','failed','failed','success','failed']);
  assert.equal(result.state.entries.length,1); assert.equal(before.entries.length,0);
  for (const confidence of [-1,2]) assert.throws(() => validateAgentTurn({response:'',memory_operations:[add('belief','x',{confidence})]}),/schema/);
  assert.throws(() => manager.prepareOperations(before,[add('belief','a'),add('belief','b')],ctx(0,{maxOperations:1})),/operation limit/);
  for (const config of [{retrievalEntries:-1},{summaryChars:8001},{mode:'automatic'},{retrievalRule:'random'},{extra:3}]) assert.throws(() => resolveMemoryConfig(config),/Memory|memory|Unknown|Invalid/);
});

test('retrieval and visible extractive summaries are deterministic, bounded and non-destructive', async t => {
  const f = await fixture(t, () => response([]));
  const manager = new MemoryManager(f.storage);
  const state = manager.prepareOperations(await f.storage.loadWorkingState('bob'),Array.from({length:8},(_,i) => add('episodic',`Observation ${i}: `+'x'.repeat(200),{importance:i/10})),ctx(0)).state;
  const original = JSON.stringify(state);
  const config = resolveMemoryConfig({retrievalEntries:2,retrievalChars:400,entryChars:40,summaryChars:180,transcriptTurns:2,transcriptChars:50});
  const retrieved = retrieveMemory(state,config);
  assert.equal(retrieved.metadata.selectedIds.length,2);
  assert.equal(retrieved.metadata.selectedIds[0],state.entries[7].id);
  assert.ok(retrieved.text.length<=400); assert.ok(retrieved.summary.length<=180);
  assert.ok(retrieved.metadata.summaryIds.length>0);
  assert.equal(retrieved.metadata.selectedIds.length+retrieved.metadata.summaryIds.length+retrieved.metadata.omittedEntries,8);
  assert.deepEqual(retrieveMemory(state,config),retrieved);
  assert.equal(JSON.stringify(state),original);
  const history = Array.from({length:5},(_,i) => ({ agentName:'Bob',response:'turn'+i+' '.repeat(30) }));
  assert.ok(boundedTranscript(history,config).length<=50);
  assert.ok(!boundedTranscript(history,config).includes('turn0'));
  state.entries[0].updated_at='2099-01-01';
  assert.equal(retrieveMemory(state,{...config,retrievalRule:'recent'}).metadata.selectedIds[0],state.entries[0].id);
});

test('historical state, exact journaled prompts, retrieval metadata and differences survive a fresh controller', async t => {
  let beliefId;
  const f = await fixture(t,(n) => {
    if(n===0) return response([add('belief','An earlier belief')]);
    if(n===2) return response([{action:'update',type:'belief',target_id:beliefId,content:'A revised belief',reason:'A later source turn',confidence:0.9}]);
    return response([]);
  });
  f.config.maxTurns=3; f.config.memoryConfig={retrievalEntries:3,summaryChars:100};
  f.controller.onEvent((type,data)=>{ if(type==='turn_completed'&&data.turnRecord.turnIndex===0) beliefId=data.auditTrail[0].new_id; });
  await f.controller.start(f.config); await until(()=>f.controller.getStatus()==='completed');
  const initial=await f.logs.memoryHistory('test-run','bob',-1);
  const first=await f.logs.memoryHistory('test-run','bob',0);
  const later=await f.logs.memoryHistory('test-run','bob',2,0);
  assert.equal(initial.state.entries.length,0);
  assert.equal(first.state.entries[0].content,'An earlier belief');
  assert.equal(later.state.entries[0].content,'A revised belief');
  assert.equal(later.diff.changed[0].before.content,'An earlier belief');
  assert.equal(later.diff.changed[0].after.updated_source.turnIndex,2);
  const records=await f.logs.getConversationHistory('test-run');
  assert.equal(later.state.entries[0].updated_source.eventId,records[2].eventId);
  assert.ok(records[2].prompt.system.includes('An earlier belief'));
  assert.equal(records[2].parsedResponse.response,records[2].response);
  assert.equal(records[2].retrieval.config.retrievalEntries,3);
  assert.equal((await f.logs.loadConfig('test-run')).memoryConfig.summaryChars,100);
  assert.equal(records[0].stateBefore.entries.length,0);
  assert.equal(records[0].stateAfter.entries.length,1);
  await f.createController().start(f.config);
  assert.equal((await f.logs.memoryHistory('test-run','bob',0)).state.entries[0].content,'An earlier belief');
  await assert.rejects(f.logs.memoryHistory('test-run','bob',10),/Historical turn/);
  await assert.rejects(f.logs.memoryHistory('test-run','outsider',0),/not a participant/);
});

test('no-memory condition withholds private state, transcript and evolved stats and never applies proposals', async t => {
  const prompts=[];
  const f=await fixture(t,(n,payload)=>{prompts.push(payload);return response([add('self_description','New description'),{action:'update',type:'stat',target_id:'curiosity',content:9,reason:'test'}]);});
  await f.storage.saveAgentMemory('bob',[{id:'secret',content:'PRIVATE-EPISODE'}]);
  await f.storage.saveAgentBeliefs('bob',[{id:'belief',content:'PRIVATE-BELIEF'}]);
  const identity=await f.storage.loadAgentIdentity('bob'); identity.stats.curiosity.current=8;
  await f.storage.saveAgentIdentity('bob',identity);
  const before=JSON.stringify(await f.storage.loadWorkingState('bob'));
  f.config.maxTurns=4;f.config.memoryConfig={mode:'none'};
  await f.controller.start(f.config);await until(()=>f.controller.getStatus()==='completed');
  for(const prompt of prompts){
    assert.ok(!JSON.stringify(prompt).includes('PRIVATE-'));
    assert.ok(!prompt.messages[0].content.includes('Original model dialogue.'));
  }
  assert.ok(prompts[0].messages[0].content.includes('curiosity: 2'));
  assert.equal(JSON.stringify(await f.storage.loadWorkingState('bob')),before);
  const records=await f.logs.getConversationHistory('test-run');
  assert.ok(records.every(r=>r.auditTrail.every(op=>op.status==='ignored')));
  assert.ok(records.every(r=>r.retrieval.selectedIds.length===0&&r.retrieval.summaryIds.length===0));
  await assert.rejects(fs.access(path.join(f.root,'agents/agents/bob/state.json')));
});

test('private states never cross prompts; memory budgets and summaries are journaled without erasing original events', async t=>{
  const prompts=[];
  const f=await fixture(t,(n,p)=>{prompts.push(p);return response([]);});
  await f.storage.saveAgentMemory('bob',Array.from({length:6},(_,i)=>({id:`bob-${i}`,content:`BOB-PRIVATE-${i}`})));
  await f.storage.saveAgentMemory('sara',[{id:'sara-private',content:'SARA-PRIVATE'}]);
  f.config.maxTurns=2;f.config.memoryConfig={retrievalEntries:1,summaryChars:100,retrievalChars:200};
  await f.controller.start(f.config);await until(()=>f.controller.getStatus()==='completed');
  assert.ok(!prompts[0].messages[0].content.includes('SARA-PRIVATE'));
  assert.ok(!prompts[1].messages[0].content.includes('BOB-PRIVATE'));
  const record=(await f.logs.getConversationHistory('test-run'))[0];
  assert.ok(record.retrieval.summaryIds.length>0);
  assert.equal(record.stateBefore.entries.length,6);assert.equal(record.stateAfter.entries.length,6);
  const baseline=await f.logs.memoryHistory('test-run','bob',-1);
  assert.equal(baseline.state.entries.length,6);
});

test('a projection failure after journal commit recovers on Resume with no repeated inference or adds', async t=>{
  const f=await fixture(t,()=>response([add('episodic','Only once')]));
  f.config.maxTurns=2;
  const save=f.storage.saveWorkingState.bind(f.storage);
  let fail=true;
  f.storage.saveWorkingState=async(...args)=>{if(fail){fail=false;throw Error('Injected write failure');}return save(...args);};
  await f.controller.start(f.config);await until(()=>f.controller.getStatus()==='paused');
  assert.equal(f.controller.getTurnIndex(),1);assert.equal(f.stats().requests,1);
  assert.equal((await f.logs.getConversationHistory('test-run')).length,1);
  assert.equal((await f.storage.loadWorkingState('bob')).entries.length,0);
  await f.controller.resume();await until(()=>f.controller.getStatus()==='completed');
  assert.equal(f.stats().requests,2);
  assert.equal((await f.storage.loadWorkingState('bob')).entries.length,1);
  assert.equal((await f.storage.loadWorkingState('sara')).entries.length,1);
  const events=(await f.logs.getEventHistory('test-run')).filter(e=>e.type==='memory_update');
  assert.equal(events.length,2);assert.equal(new Set(events.map(e=>e.id)).size,2);
});

test('fresh-start journal recovery completes a committed state/event without generating the completed turn again', async t=>{
  const f=await fixture(t,()=>response([add('belief','Committed belief')]));
  f.config.maxTurns=2;
  await f.logs.saveConfig('test-run',{...f.config,initialTopic:'',llmConfig:{...f.config.llmConfig,model:'real-loaded-id',maxTokens:2048,outputMode:'json_schema',temperature:0.7},memoryConfig:resolveMemoryConfig()});
  const before=await f.storage.loadWorkingState('bob');
  await f.logs.ensureMemoryBaseline('test-run',-1,{bob:before,sara:await f.storage.loadWorkingState('sara')});
  const result=new MemoryManager(f.storage).prepareOperations(before,[add('belief','Journal-only belief')],ctx(0));
  await f.logs.appendConversationTurn('test-run',{schemaVersion:2,eventId:'event-0',turnIndex:0,agentId:'bob',response:'Already committed',memoryMode:'enabled',stateBefore:before,stateAfter:result.state,auditTrail:result.auditTrail});
  await f.controller.start(f.config);await until(()=>f.controller.getStatus()==='completed');
  assert.equal(f.stats().requests,1);
  assert.equal((await f.storage.loadWorkingState('bob')).entries[0].content,'Journal-only belief');
  assert.equal((await f.logs.getConversationHistory('test-run')).length,2);
});

test('writer ownership prevents another controller/store from mutating an active or paused run', async t=>{
  const f=await fixture(t,()=> 'invalid JSON');
  await f.controller.start({...f.config,maxTurns:1});await until(()=>f.controller.getStatus()==='paused');
  await assert.rejects(f.createController().start({...f.config,runId:'second'}),/Another experiment writer/);
  const otherStore=new JsonlStorage(path.join(f.root,'research'));
  await assert.rejects(otherStore.acquireWriter('another-process'),/Another experiment writer/);
  await f.controller.stop();
  await otherStore.acquireWriter('another-process');await otherStore.releaseWriter('another-process');
});

test('legacy memory is read without mutation and over-limit imports can be reduced without data loss',async t=>{
  const f=await fixture(t,()=>response([]));
  await f.storage.saveAgentMemory('bob',[{id:'one',content:'Legacy one'},{id:'two',content:'Legacy two'},{id:'three',content:'Legacy three'}]);
  const legacyFile=path.join(f.root,'agents/agents/bob/memory.json');
  const original=await fs.readFile(legacyFile,'utf8');
  const state=await f.storage.loadWorkingState('bob');
  assert.equal(state.entries[0].source,null);assert.equal(state.entries[0].created_at,null);
  assert.equal(state.entries[0].confidence,0.5);
  assert.equal(await fs.readFile(legacyFile,'utf8'),original);
  await assert.rejects(fs.access(path.join(f.root,'agents/agents/bob/state.json')));
  const result=new MemoryManager(f.storage).prepareOperations(state,[
    {action:'retire',type:'episodic',target_id:'one',content:'Retire',reason:'Reduce imported memory'},
    {action:'consolidate',type:'episodic',target_ids:['two','three'],content:'A compact recollection',reason:'Consolidate original observations'}
  ],ctx(0,{maxActiveEntries:1}));
  assert.ok(result.auditTrail.every(op=>op.status==='success'));
  assert.equal(result.state.entries.filter(e=>e.status==='active').length,1);
  assert.equal(result.state.entries.length,4);
  await f.storage.saveWorkingState('bob',result.state);
  assert.equal(await fs.readFile(legacyFile,'utf8'),original);
});

test('failed model attempts retain private research evidence while public errors contain only diagnostics',async t=>{
  const f=await fixture(t,()=> 'Malformed private output');
  f.config.maxTurns=1;
  await f.controller.start(f.config);await until(()=>f.controller.getStatus()==='paused');
  const events=await f.logs.getEventHistory('test-run');
  const error=events.find(e=>e.type==='experiment_error');
  assert.equal(error.attempt.rawResponse,'Malformed private output');
  assert.ok(error.attempt.prompt.system.includes('You are an agent'));
  assert.ok(error.attempt.startedAt);
  assert.equal(f.controller.getState().error.attempt,undefined);
  assert.ok(!JSON.stringify(f.controller.getState().error).includes('Malformed private output'));
});
