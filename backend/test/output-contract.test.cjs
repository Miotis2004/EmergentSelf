const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture,until}=require('./helpers.cjs');
const {outputContract,TRANSPORT_MARKER}=require('../dist/llm/LlmAdapter');
const {responseSchema,validateAgentTurn}=require('../dist/llm/agentTurnSchema');

for(const outputMode of ['json_schema','json_only']) for(const mode of ['none','history','enabled']) for(const capability of ['conversation','social','task']) {
 test(`${outputMode}/${mode}/${capability}: every turn has the schema contract; plain text fails without corrupting history`,async t=>{
  const social=capability!=='conversation',task=capability==='task',requests=[];
  const text='Actual model words.\n  Exact spacing.';
  const valid={response:text,memory_operations:[],...(social?{social:{action:'speak',recipient_id:null}}:{}),...(task?{task_decision:{amount:1}}:{})};
  const raw=JSON.stringify(valid);
  const f=await fixture(t,(n,payload)=>{requests.push(payload);return n===1?'Ordinary conversational text':raw;});
  const config={...f.config,maxTurns:3,initialTopic:'What makes someone trustworthy?',memoryConfig:{mode},socialConfig:{enabled:social},taskConfig:{kind:task?'public_goods':'none'},llmConfig:{...f.config.llmConfig,outputMode}};
  await f.controller.start(config);await until(()=>f.controller.getStatus()==='paused');
  assert.equal(f.controller.getTurnIndex(),1);assert.equal(f.controller.getState().activeAgentId,null);
  const turns=await f.logs.getConversationHistory('test-run');assert.equal(turns.length,1);
  assert.equal(turns[0].response,text);assert.equal(turns[0].rawResponse,raw);assert.equal(turns[0].llmValidation.status,'passed');
  const error=(await f.logs.getEventHistory('test-run')).find(e=>e.type==='experiment_error');
  assert.equal(error.attempt.rawResponse,'Ordinary conversational text');assert.equal(error.attempt.llmValidation.status,'failed');assert.equal(error.attempt.llmValidation.stage,'response_json');
  assert.deepEqual(error.attempt.request,requests[1]);assert.deepEqual(turns[0].request,requests[0]);
  assert.equal(requests[0].messages[0].content,turns[0].prompt.system);assert.equal(requests[1].messages[0].content,error.attempt.prompt.system);
  assert.ok(!turns[0].prompt.system.includes(TRANSPORT_MARKER));
  for(const request of requests){
   assert.equal(request.messages.at(-1).role,'system');assert.equal(request.messages.at(-1).content,outputContract(responseSchema(social,task)));
   assert.equal(request.messages.filter(m=>m.content.includes(TRANSPORT_MARKER)).length,1);
   assert.equal(request.response_format.type,outputMode==='json_only'?'json_object':'json_schema');
   if(outputMode==='json_schema')assert.deepEqual(request.response_format.json_schema.schema,responseSchema(social,task));
  }
  await f.controller.resume();await until(()=>f.controller.getStatus()==='completed');
  assert.deepEqual((await f.logs.getConversationHistory('test-run')).map(turn=>turn.turnIndex),[0,1,2]);assert.equal(f.stats().maximum,1);
 });
}

test('all capability schemas reject missing required fields without adding defaults',()=>{
 for(const [social,task] of [[false,false],[true,false],[true,true]]){
  const value={response:'verbatim',...(social?{social:{action:'speak',recipient_id:null}}:{})};
  const before=JSON.stringify(value);assert.throws(()=>validateAgentTurn(value,social,task),/schema/);assert.equal(JSON.stringify(value),before);
 }
 assert.ok(!('task_decision' in responseSchema(true,false).properties));
 assert.ok('task_decision' in responseSchema(true,true).properties);
});

test('literal transport metadata cannot be committed as a memory instruction',async t=>{
 const raw=JSON.stringify({response:'Actual speech',memory_operations:[{action:'add',type:'episodic',content:TRANSPORT_MARKER,reason:'copy'}]});
 const f=await fixture(t,()=>raw);const before=await f.storage.loadAgentIdentity('bob');
 await f.controller.start({...f.config,maxTurns:1});await until(()=>f.controller.getStatus()==='paused');
 assert.deepEqual(await f.storage.loadAgentIdentity('bob'),before);assert.deepEqual(await f.logs.getConversationHistory('test-run'),[]);
 const error=(await f.logs.getEventHistory('test-run')).find(e=>e.type==='experiment_error');
 assert.equal(error.attempt.rawResponse,raw);assert.equal(error.attempt.llmValidation.stage,'transport_boundary');
});
