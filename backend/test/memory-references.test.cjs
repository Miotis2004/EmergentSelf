const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture,until}=require('./helpers.cjs');
const {MemoryManager}=require('../dist/agents/MemoryManager');
const {resolveMemoryConfig}=require('../dist/memory/types');
const {retrieveMemory}=require('../dist/memory/retrieval');
const {memoryOperationGuide}=require('../dist/memory/operationGuide');
const {validateAgentTurn,responseSchema}=require('../dist/llm/agentTurnSchema');
const {hash}=require('../dist/research/protocol');
const op=(action,extra={})=>({action,type:'belief',content:'An exact model-authored position.\n  Nuanced revision.',reason:'New information',...extra});
const context={source:{runId:'reference-test',turnIndex:0,eventId:'test-event'},participants:['bob','sara'],config:resolveMemoryConfig()};
const output=operations=>JSON.stringify({response:'Exact conversational words.',memory_operations:operations});

test('schema requires action-specific references in base, social and task output without repairing operations',()=>{
 for(const [social,task] of [[false,false],[true,false],[true,true]]){
  const turn=operation=>({response:'Exact speech',memory_operations:[operation],...(social?{social:{action:'speak',recipient_id:null}}:{}),...(task?{task_decision:{amount:1}}:{})});
  for(const action of ['update','retire','contradict'])for(const target of [undefined,'']){
   const operation=op(action,target===undefined?{}:{target_id:target}),before=JSON.stringify(operation);
   assert.throws(()=>validateAgentTurn(turn(operation),social,task),/missing target_id/);assert.equal(JSON.stringify(operation),before);
  }
  for(const target_ids of [undefined,[],['one'],['one','one']]){
   assert.throws(()=>validateAgentTurn(turn(op('consolidate',target_ids===undefined?{}:{target_ids})),social,task),/at least two distinct/);
  }
  for(const operation of [op('add'),op('update',{target_id:'exact-id'}),op('retire',{target_id:'exact-id'}),op('contradict',{target_id:'exact-id'}),op('consolidate',{target_ids:['one','two']})])assert.doesNotThrow(()=>validateAgentTurn(turn(operation),social,task));
  const schema=responseSchema(social,task);assert.equal(schema.properties.memory_operations.items.anyOf.length,4);
  assert.ok(!JSON.stringify(schema).includes('"if":')); // Decoder-friendly complete object alternatives.
 }
});

for(const protocol of [false,true])for(const outputMode of ['json_schema','json_only'])test(`${protocol?'research':'standard'} ${outputMode}: create a belief then revise the exact retrieved ID on a later turn`,async t=>{
 const requests=[],proposed=[],f=await fixture(t,(n,request)=>{
  requests.push(request);let operations=[];
  if(n===0)operations=[op('add',{content:'A newly formulated belief, not previously stored.'})];
  if(n===2){
   const prompt=request.messages[0].content;
   assert.ok(prompt.includes('Active Beliefs and opinions (belief):'));
   const record=prompt.split('\n').filter(line=>line.startsWith('{"metadata":')).map(line=>JSON.parse(line)).find(record=>record.metadata.type==='belief');
   assert.ok(record,'Exact stored ID is visible to the model');
   operations=[op('update',{target_id:record.metadata.id})];
  }
  proposed.push(operations);return output(operations);
 });
 const config={...f.config,maxTurns:3,llmConfig:{...f.config.llmConfig,outputMode,modelVersion:'fixture'},...(protocol?{protocol:{}}:{})};
 await f.controller.start(config);await until(()=>['completed','paused'].includes(f.controller.getStatus()));assert.equal(f.controller.getStatus(),'completed');
 const turns=await f.logs.getConversationHistory('test-run');
 assert.equal(turns[0].stateBefore.entries.length,0);assert.equal(turns[0].auditTrail[0].status,'success');
 const id=turns[0].auditTrail[0].new_id;
 assert.equal(proposed[2][0].target_id,id);assert.equal(turns[2].stateAfter.entries.length,1);
 assert.equal(turns[2].stateAfter.entries[0].content,proposed[2][0].content);
 assert.deepEqual(turns[2].auditTrail[0].operation,proposed[2][0]);assert.equal(turns[2].auditTrail[0].status,'success');
 assert.equal(turns[2].auditTrail[0].before[0].content,proposed[0][0].content);
 assert.equal(turns[0].response,'Exact conversational words.');
 for(const request of requests){assert.ok(request.messages[0].content.includes(memoryOperationGuide({mode:'enabled'})));assert.ok(request.messages[0].content.includes('Never invent target IDs'));}
 assert.equal(f.stats().maximum,1);
 const baseline=hash(await f.logs.loadBaseline('test-run')),history=hash(turns);
 await f.controller.stop();await f.createController().start(config);
 assert.equal(hash(await f.logs.loadBaseline('test-run')),baseline);assert.equal(hash(await f.logs.getConversationHistory('test-run')),history);
});

test('runtime rejection distinguishes nonexistent, inactive and incorrect-category targets and preserves each proposal',async t=>{
 const f=await fixture(t,()=>output([])),manager=new MemoryManager(f.storage),before=await f.storage.loadWorkingState('bob');
 const seeded=manager.prepareOperations(before,[op('add'),op('add',{type:'self_description',content:'A learned self-description'})],context).state;
 const belief=seeded.entries[0],self=seeded.entries[1];
 seeded.entries.push({...belief,id:'retired-id',status:'retired'},{...belief,id:'superseded-id',status:'superseded'});
 const frozen=hash(seeded);
 const operations=[op('update',{target_id:'does-not-exist'}),op('update',{target_id:self.id}),op('update',{target_id:'retired-id'}),op('update',{target_id:'superseded-id'}),op('update',{target_id:belief.id})];
 const result=manager.prepareOperations(seeded,operations,context);
 assert.deepEqual(result.auditTrail.map(record=>record.status),['failed','failed','failed','failed','success']);
 for(const [index,pattern] of [/Nonexistent target/,/Category mismatch/,/Inactive target/,/Inactive target/].entries()){
  assert.match(result.auditTrail[index].error,pattern);assert.deepEqual(result.auditTrail[index].operation,operations[index]);
 }
 assert.equal(hash(seeded),frozen);assert.equal(result.state.entries.length,4);assert.equal(result.state.entries[0].content,operations[4].content);
 assert.equal(result.state.entries[1].content,self.content);
});

test('schema-rejected UPDATE is journaled with its unmodified proposal and missing-reference reason; never becomes ADD',async t=>{
 const operation=op('update'),raw=output([operation]);
 const f=await fixture(t,n=>n===0?raw:output([])),before=hash(await f.storage.loadWorkingState('bob'));
 await f.controller.start({...f.config,maxTurns:1});await until(()=>f.controller.getStatus()==='paused');
 assert.equal(hash(await f.storage.loadWorkingState('bob')),before);assert.equal((await f.logs.getConversationHistory('test-run')).length,0);
 const error=(await f.logs.getEventHistory('test-run')).find(event=>event.type==='experiment_error');
 assert.match(error.message,/missing target_id/);assert.equal(error.attempt.rawResponse,raw);
 assert.deepEqual(error.attempt.parsedResponse.memory_operations,[operation]);assert.equal(error.attempt.llmValidation.stage,'schema');
 assert.match(error.attempt.llmValidation.error,/missing target_id/);assert.ok(!error.message.includes(operation.content));
 await f.controller.resume();await until(()=>f.controller.getStatus()==='completed');
 assert.equal((await f.storage.loadWorkingState('bob')).entries.length,0);
});

test('semantic target rejections reject the complete turn while retaining every proposed memory operation',async t=>{
 const operations=[op('update',{target_id:'absent'}),op('update',{target_id:'wrong-category'}),op('update',{target_id:'inactive'})];
 const f=await fixture(t,()=>output(operations));await f.storage.saveAgentMemory('bob',[{id:'wrong-category',content:'An episodic observation'}]);
 const state=await f.storage.loadWorkingState('bob');state.entries.push({...state.entries[0],type:'belief',id:'inactive',status:'retired'});await f.storage.saveWorkingState('bob',state);
 const frozen=hash(state);await f.controller.start({...f.config,maxTurns:1});await until(()=>f.controller.getStatus()==='paused');
 assert.equal((await f.logs.getConversationHistory('test-run')).length,0);assert.equal(hash(await f.storage.loadWorkingState('bob')),frozen);
 const audit=(await f.logs.getEventHistory('test-run')).find(event=>event.type==='experiment_error').attempt.memoryAudit;assert.deepEqual(audit.map(record=>record.operation),operations);
 assert.match(audit[0].error,/Nonexistent target/);assert.match(audit[1].error,/Category mismatch/);assert.match(audit[2].error,/Inactive target/);
});

test('active retrieval groups exact IDs by category without changing ranking, contents, originals or budgets',async t=>{
 const f=await fixture(t,()=>output([])),manager=new MemoryManager(f.storage);
 const state=manager.prepareOperations(await f.storage.loadWorkingState('bob'),['episodic','belief','self_description','relationship'].map(type=>op('add',{type,...(type==='relationship'?{relationship_agent_id:'sara'}:{})})),context).state;
 state.entries.push({...state.entries[0],id:'inactive-hidden',status:'retired'});const before=hash(state);
 const config=resolveMemoryConfig({retrievalEntries:4,retrievalChars:2000,summaryChars:300});
 const result=retrieveMemory(state,config);
 for(const entry of state.entries.filter(entry=>entry.status==='active')){assert.ok(result.text.includes(`"id":"${entry.id}"`));assert.ok(result.text.includes(`(${entry.type}):`));}
 assert.ok(!result.text.includes('inactive-hidden'));assert.equal(result.metadata.memoryChars,result.text.length);assert.equal(hash(state),before);
 const summary=retrieveMemory(state,{...config,retrievalEntries:0});assert.ok(summary.summary.includes('Active '));assert.ok(summary.summary.length<=300);
 for(const size of [0,1,40,80,200]){const bounded=retrieveMemory(state,{...config,retrievalChars:size,summaryChars:size});assert.ok(bounded.text.length<=size);assert.ok(bounded.summary.length<=size);}
 for(const mode of ['none','history']){const withheld=retrieveMemory(state,{...config,mode});assert.equal(withheld.text,'');assert.equal(withheld.summary,'');assert.equal(memoryOperationGuide({mode}),'');}
});
