const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture,until}=require('./helpers.cjs');
const {MemoryManager}=require('../dist/agents/MemoryManager');
const {resolveMemoryConfig}=require('../dist/memory/types');
const {retrieveMemory}=require('../dist/memory/retrieval');
const {validateAgentTurn,responseSchema}=require('../dist/llm/agentTurnSchema');
const {memoryContentWarnings}=require('../dist/memory/contentDiagnostics');
const {participantDirectory}=require('../dist/memory/operationGuide');
const {ResearchService}=require('../dist/research/ResearchService');
const {hash}=require('../dist/research/protocol');
const op=(action='add',extra={})=>({action,type:'relationship',content:'Walter is a challenging debate partner whom I respect.',reason:'Our discussion changed my approach to disagreement.',...extra});
const context={source:{runId:'relationships',turnIndex:0,eventId:'source-event'},participants:['bob','sara','third'],config:resolveMemoryConfig()};
const output=operations=>JSON.stringify({response:'Exact model dialogue.',memory_operations:operations});
const records=prompt=>prompt.split('\n').filter(line=>line.startsWith('{"metadata":')).map(line=>JSON.parse(line));
const contaminated='[c9d4f211-3b7a-4e8c-9f12-6a0e8b5c2d47]\nbelief (confidence=0.6):\nThe honest cannot be funded by surrender.';

test('relationship additions require an explicit subject, with no inference from names or content',()=>{
 for(const [social,task] of [[false,false],[true,false],[true,true]]){
  const turn=operation=>({response:'Exact words',memory_operations:[operation],...(social?{social:{action:'speak',recipient_id:null}}:{}),...(task?{task_decision:{amount:1}}:{})});
  for(const value of [undefined,'',null,9])assert.throws(()=>validateAgentTurn(turn(op('add',value===undefined?{}:{relationship_agent_id:value})),social,task),/relationship_agent_id/);
  assert.doesNotThrow(()=>validateAgentTurn(turn(op('add',{relationship_agent_id:'sara'})),social,task));
  assert.doesNotThrow(()=>validateAgentTurn(turn(op('update',{target_id:'existing'})),social,task));
  const variant=responseSchema(social,task).properties.memory_operations.items.anyOf.find(schema=>schema.required.includes('relationship_agent_id'));
  assert.deepEqual(variant.properties.type.enum,['relationship']);assert.ok(!JSON.stringify(variant).includes('"if":'));
 }
});

test('relationships reject unknown, self, invalid IDs and incompatible targets; revisions retain their original subject',async t=>{
 const f=await fixture(t,()=>output([])),manager=new MemoryManager(f.storage),before=await f.storage.loadWorkingState('bob');
 const invalid=manager.prepareOperations(before,['unknown','Walter','bob','   '].map(relationship_agent_id=>op('add',{relationship_agent_id})),context);
 assert.deepEqual(invalid.auditTrail.map(record=>record.status),['failed','failed','failed','failed']);assert.equal(invalid.state.entries.length,0);
 assert.match(invalid.auditTrail[0].error,/Unknown relationship participant/);assert.match(invalid.auditTrail[2].error,/Self-referential/);assert.match(invalid.auditTrail[3].error,/Missing relationship_agent_id/);
 let result=manager.prepareOperations(before,[op('add',{relationship_agent_id:'sara'}),op('add',{type:'belief',content:'An initial belief'})],context);
 const id=result.state.entries[0].id,belief=result.state.entries[1].id;
 const update=op('update',{target_id:id,content:'Our relationship changed after new evidence.'});
 result=manager.prepareOperations(result.state,[update],{...context,source:{...context.source,turnIndex:2}});
 assert.equal(result.auditTrail[0].status,'success');assert.equal(result.state.entries[0].relationship_agent_id,'sara');assert.equal(result.state.entries[0].id,id);assert.equal(result.state.entries[0].updated_source.turnIndex,2);
 const frozen=hash(result.state),bad=[op('update',{target_id:id,relationship_agent_id:'third'}),op('update',{target_id:belief})];
 const rejected=manager.prepareOperations(result.state,bad,context);assert.equal(hash(rejected.state),frozen);
 assert.match(rejected.auditTrail[0].error,/subjects cannot change/);assert.match(rejected.auditTrail[1].error,/Category mismatch/);
 assert.deepEqual(rejected.auditTrail.map(record=>record.operation),bad);
 const explicit=manager.prepareOperations(result.state,[op('update',{target_id:id,relationship_agent_id:'sara'})],context);assert.equal(explicit.auditTrail[0].status,'success');
 const contradiction=manager.prepareOperations(explicit.state,[op('contradict',{target_id:id})],context);assert.equal(contradiction.state.entries.at(-1).relationship_agent_id,'sara');
});

for(const protocol of [false,true])for(const outputMode of ['json_schema','json_only'])test(`${protocol?'research':'standard'} ${outputMode}: dynamic participant directory enables relationship creation/revision and Walter's belief update`,async t=>{
 const requests=[],proposals=[],f=await fixture(t,(n,request)=>{
  requests.push(request);const prompt=request.messages[0].content;let operation;
  if(n===0){const subject=prompt.match(/- ([A-Za-z0-9_-]+): "Walter"/);assert.ok(subject);operation=op('add',{relationship_agent_id:subject[1]});}
  if(n===1)operation=op('add',{type:'belief',content:'An initial view of tradition.',confidence:0.6});
  if(n===2){const record=records(prompt).find(record=>record.metadata.type==='relationship');assert.ok(record);assert.equal(record.metadata.relationship_agent_id,'agent-k');operation=op('update',{target_id:record.metadata.id,content:'Walter challenges my assumptions; I respect our disagreement.'});}
  if(n===3){const record=records(prompt).find(record=>record.metadata.type==='belief');assert.ok(record);operation=op('update',{type:'belief',target_id:record.metadata.id,content:'A nuanced revised view of tradition.',confidence:0.8});}
  proposals.push(operation);return output(operation?[operation]:[]);
 },['agent-j','agent-k','unchecked']);
 for(const [id,name] of [['agent-j','McKee'],['agent-k','Walter'],['unchecked','Excluded']]){const identity=await f.storage.loadAgentIdentity(id);identity.name=name;await f.storage.saveAgentIdentity(id,identity);}
 const excluded=hash(await f.storage.loadWorkingState('unchecked'));
 await f.controller.start({...f.config,agentIds:['agent-j','agent-k'],maxTurns:4,llmConfig:{...f.config.llmConfig,outputMode,modelVersion:'fixture'},...(protocol?{protocol:{}}:{})});
 await until(()=>['completed','paused'].includes(f.controller.getStatus()));assert.equal(f.controller.getStatus(),'completed');
 const turns=await f.logs.getConversationHistory('test-run');assert.equal(turns.length,4);
 for(const [index,request] of requests.entries()){
  assert.ok(request.messages[0].content.includes('- agent-j: "McKee"'+(index%2?'':' (you)')));assert.ok(request.messages[0].content.includes('- agent-k: "Walter"'+(index%2?' (you)':'')));
  assert.ok(!request.messages[0].content.includes('unchecked'));assert.ok(!request.messages[0].content.includes('Excluded'));
  assert.equal(request.max_tokens,2048);assert.equal(request.temperature,0.7);assert.equal(request.response_format.type,outputMode==='json_schema'?'json_schema':'json_object');
  assert.deepEqual(turns[index].auditTrail[0].operation,proposals[index]);assert.equal(turns[index].auditTrail[0].status,'success');
 }
 assert.equal(turns[0].stateAfter.entries[0].id,turns[2].stateAfter.entries[0].id);assert.equal(turns[2].stateAfter.entries[0].relationship_agent_id,'agent-k');
 assert.equal(turns[1].stateAfter.entries[0].id,turns[3].stateAfter.entries[0].id);assert.equal(turns[3].stateAfter.entries[0].confidence,0.8);
 assert.equal(hash(await f.storage.loadWorkingState('unchecked')),excluded);assert.equal(f.stats().maximum,1);
 if(protocol){
  const research=new ResearchService(f.controller,f.logs,f.storage);await research.defineProbe('directory-probe',['Review your memory']);
  // Probe directories must use historical run identities, not today's shared agent names.
  const identity=await f.storage.loadAgentIdentity('agent-k');identity.name='Changed outside run';await f.storage.saveAgentIdentity('agent-k',identity);
  const probe=await research.probe('test-run','agent-j',2,'directory-probe','Researcher','Verify historical directory');
  assert.equal(probe.results[0].status,'success');
  assert.ok(requests.at(-1).messages[0].content.includes('"Walter"'));assert.ok(!requests.at(-1).messages[0].content.includes('Changed outside run'));
 }
});

test('metadata contamination warnings are narrow, preserve generated content and never rewrite or reject it',async t=>{
 const natural=op('add',{type:'belief',content:'I value evidence and confidence grows with experience.'});assert.deepEqual(memoryContentWarnings([natural]),[]);
 assert.deepEqual(memoryContentWarnings([op('add',{type:'belief',content:'[2026] belief (confidence=0.6): a quotation'})]),[]);
 assert.deepEqual(memoryContentWarnings([op('add',{type:'belief',content:'We discussed '+contaminated})]),[]);
 const f=await fixture(t,()=>output([])),manager=new MemoryManager(f.storage);
 const operation=op('add',{type:'belief',content:contaminated});
 const result=manager.prepareOperations(await f.storage.loadWorkingState('bob'),[operation],context),record=result.auditTrail[0];
 assert.equal(record.status,'success');assert.deepEqual(record.operation,operation);assert.equal(record.warnings[0].operationIndex,0);assert.equal(record.warnings[0].content,contaminated);assert.equal(record.warnings[0].format,'legacy_header');
 assert.equal(result.state.entries[0].content,contaminated);assert.notEqual(result.state.entries[0].id,'c9d4f211-3b7a-4e8c-9f12-6a0e8b5c2d47');
 const retrieval=retrieveMemory(result.state,resolveMemoryConfig()),rendered=records(retrieval.text)[0];assert.equal(rendered.content,contaminated);assert.equal(rendered.metadata.id,result.state.entries[0].id);
 const copy=JSON.stringify(rendered);assert.equal(memoryContentWarnings([op('add',{type:'belief',content:copy})])[0].format,'structured_record');
 const revision=manager.prepareOperations(result.state,[op('update',{type:'belief',target_id:rendered.metadata.id,content:'A later plain-language belief.'})],context);
 assert.equal(revision.state.entries[0].id,rendered.metadata.id);assert.equal(revision.auditTrail[0].status,'success');assert.equal(revision.state.entries[0].content,'A later plain-language belief.');
});

for(const valid of [true,false])test(`contamination diagnostics and raw proposals survive ${valid?'accepted':'schema-rejected'} inference auditing`,async t=>{
 const operation=op('add',{type:valid?'belief':'relationship',content:contaminated});const raw=output([operation]);
 const f=await fixture(t,()=>raw);await f.controller.start({...f.config,maxTurns:1});await until(()=>['completed','paused'].includes(f.controller.getStatus()));
 if(valid){const turn=(await f.logs.getConversationHistory('test-run'))[0];assert.equal(turn.rawResponse,raw);assert.equal(turn.auditTrail[0].warnings[0].content,contaminated);assert.equal(turn.llmValidation.memoryContentWarnings[0].content,contaminated);assert.equal(turn.stateAfter.entries[0].content,contaminated);}
 else {const event=(await f.logs.getEventHistory('test-run')).find(event=>event.type==='experiment_error');assert.match(event.message,/relationship_agent_id/);assert.deepEqual(event.attempt.parsedResponse.memory_operations,[operation]);assert.equal(event.attempt.rawResponse,raw);assert.equal(event.attempt.llmValidation.memoryContentWarnings[0].content,contaminated);assert.equal((await f.storage.loadWorkingState('bob')).entries.length,0);}
});

test('structured retrieval keeps escaped content and reference IDs complete within display budgets; directories are withheld outside enabled memory',async t=>{
 const f=await fixture(t,()=>output([])),manager=new MemoryManager(f.storage),state=manager.prepareOperations(await f.storage.loadWorkingState('bob'),[op('add',{relationship_agent_id:'sara',content:'A quoted "relationship"\nwith a new line and \\ path.'})],context).state;
 const frozen=hash(state);
 for(const size of [0,1,80,200,300,1000]){
  const result=retrieveMemory(state,resolveMemoryConfig({retrievalChars:size,summaryChars:size}));assert.ok(result.text.length<=size);assert.ok(result.summary.length<=size);
  for(const record of [...records(result.text),...records(result.summary)]){assert.equal(record.metadata.id,state.entries[0].id);assert.equal(record.metadata.relationship_agent_id,'sara');assert.ok(state.entries[0].content.startsWith(record.content));}
 }
 assert.equal(hash(state),frozen);for(const mode of ['none','history'])assert.equal(participantDirectory({mode},[{id:'bob',name:'Bob'}],'bob'),'');
});
