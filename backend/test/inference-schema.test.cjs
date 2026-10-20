const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createHash}=require('node:crypto');
const Ajv=require('ajv');
const {responseSchema,inferenceResponseSchema,validateAgentTurn,INFERENCE_SCHEMA_VERSION}=require('../dist/llm/agentTurnSchema');
const {LlmAdapter,outputContract}=require('../dist/llm/LlmAdapter');
const {MemoryManager}=require('../dist/agents/MemoryManager');
const {resolveMemoryConfig}=require('../dist/memory/types');
const {prepareOperational,resolveOperational}=require('../dist/operations/state');
const {fixture}=require('./helpers.cjs');
const modes=[[false,false,false],[true,false,false],[true,true,false],[false,false,true],[true,false,true],[true,true,true]];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const operation=(action,extra={})=>({action,type:'belief',content:'Exact model content',reason:'New evidence',...extra});
function turn(social,task,operational,extra={}){return {response:'Exact reply',memory_operations:[],...(social?{social:{action:'speak',recipient_id:null}}:{}),...(task?{task_decision:{amount:1}}:{}),...(operational?{operational_operations:[]}:{}),...extra};}
function projection(value){if(Array.isArray(value))return value.map(projection);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['maxItems','maxLength'].includes(key)).map(([key,item])=>[key,projection(item)]));return value;}

for(const [social,task,operational] of modes)test(`schema combination social=${social} task=${task} operational=${operational}: only upper repetitions are projected, strict validation remains authoritative`,()=>{
 const strict=responseSchema(social,task,operational),before=JSON.stringify(strict),decoder=inferenceResponseSchema(social,task,operational);
 assert.deepEqual(decoder,projection(strict));assert.equal(JSON.stringify(strict),before);assert.ok(!JSON.stringify(decoder).includes('"maxLength":'));assert.ok(!JSON.stringify(decoder).includes('"maxItems":'));
 assert.equal(strict.properties.memory_operations.maxItems,50);assert.equal(strict.properties.memory_operations.items.anyOf[0].properties.content.maxLength,8000);
 const validator=new Ajv({strict:false}).compile(decoder);
 const operations=[operation('add'),operation('update',{target_id:'belief-id'}),operation('retire',{target_id:'belief-id'}),operation('contradict',{target_id:'belief-id'}),operation('consolidate',{target_ids:['first','second']}),operation('add',{type:'relationship',relationship_agent_id:'sara'})];
 for(const op of operations){const value=turn(social,task,operational,{memory_operations:[op]});assert.equal(validator(value),true);assert.doesNotThrow(()=>validateAgentTurn(value,social,task,operational));}
 for(const op of [operation('update'),operation('retire'),operation('contradict'),operation('consolidate',{target_ids:['one']}),operation('add',{type:'relationship'}),operation('invented')]){const value=turn(social,task,operational,{memory_operations:[op]});assert.equal(validator(value),false);assert.throws(()=>validateAgentTurn(value,social,task,operational),/schema/);}
 const tooLong=turn(social,task,operational,{memory_operations:[operation('add',{content:'x'.repeat(8001)})]});assert.equal(validator(tooLong),true);assert.throws(()=>validateAgentTurn(tooLong,social,task,operational),/schema/);
 const tooMany=turn(social,task,operational,{memory_operations:Array.from({length:51},()=>operation('add'))});assert.equal(validator(tooMany),true);assert.throws(()=>validateAgentTurn(tooMany,social,task,operational),/schema/);
 if(operational){const silent=extra=>{const value=turn(social,task,true,{response:'',...extra});if(social){value.social={action:'decline',recipient_id:null};delete value.task_decision;}return value;};for(const value of [silent({operational_operations:[]}),silent({operational_operations:[{action:'set_location',location_id:'garden',reason:'Choose available area'}]}),turn(social,task,true,{operational_operations:[{action:'set_action',activity_type:'working',status:'in_progress',description:'Preparing planting beds',reason:'Start agreed work'}]})]){assert.equal(validator(value),true);assert.doesNotThrow(()=>validateAgentTurn(value,social,task,true));}
  const longAction=turn(social,task,true,{operational_operations:[{action:'set_action',activity_type:'working',status:'in_progress',description:'x'.repeat(1001),reason:'r'.repeat(2001)}]});assert.equal(validator(longAction),true);assert.throws(()=>validateAgentTurn(longAction,social,task,true),/schema/);
  const tooManyActions=turn(social,task,true,{operational_operations:Array.from({length:9},()=>({action:'set_location',location_id:'garden',reason:'A choice'}))});assert.equal(validator(tooManyActions),true);assert.throws(()=>validateAgentTurn(tooManyActions,social,task,true),/schema/);
  const tooManyTargets=turn(social,task,true,{memory_operations:[operation('consolidate',{target_ids:Array.from({length:21},(_,i)=>`id-${i}`)})]});assert.equal(validator(tooManyTargets),true);assert.throws(()=>validateAgentTurn(tooManyTargets,social,task,true),/schema/);

 }
});

test('actual adapter requests use projected JSON Schema but retain strict instructions, raw output and both schema hashes',async t=>{
 let requested,content;const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;requested=JSON.parse(body);res.end(JSON.stringify({model:'fixture',choices:[{finish_reason:'stop',message:{content}}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const adapter=new LlmAdapter({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',outputMode:'json_schema'});
 for(const [social,task,operational] of modes){
  content=JSON.stringify(turn(social,task,operational));await adapter.generateTurn('Original agent prompt',[{role:'user',content:'Original stimulus'}],undefined,social,task,operational);
  assert.equal(requested.response_format.type,'json_schema');assert.deepEqual(requested.response_format.json_schema.schema,inferenceResponseSchema(social,task,operational));assert.equal(requested.messages.at(-1).content,outputContract(responseSchema(social,task,operational)));assert.equal(requested.max_tokens,2048);
  assert.equal(adapter.lastValidation.schemaHash,digest(responseSchema(social,task,operational)));assert.equal(adapter.lastValidation.validationSchemaHash,adapter.lastValidation.schemaHash);assert.equal(adapter.lastValidation.inferenceSchemaHash,digest(requested.response_format.json_schema.schema));assert.equal(adapter.lastValidation.inferenceSchemaVersion,INFERENCE_SCHEMA_VERSION);
 }
 content=JSON.stringify(turn(false,false,true,{memory_operations:[operation('add',{content:'original content '+ 'x'.repeat(8001)})]}));await assert.rejects(adapter.generateTurn('Agent',[],undefined,false,false,true),/schema/);assert.equal(adapter.lastRawContent,content);assert.equal(adapter.lastParsedResponse.memory_operations[0].content,JSON.parse(content).memory_operations[0].content);assert.equal(adapter.lastValidation.status,'failed');
});

test('configured memory limits and operational runtime checks remain independent of decoder projection',async t=>{
 const f=await fixture(t,()=>JSON.stringify(turn(false,false,false))),before=await f.storage.loadWorkingState('bob'),manager=new MemoryManager(f.storage);
 const context={source:{runId:'test',turnIndex:0,eventId:'event'},participants:['bob','sara'],config:resolveMemoryConfig({maxOperations:3,maxEntryChars:10})};
 assert.throws(()=>manager.prepareOperations(before,Array.from({length:4},()=>operation('add')),context),/operation limit/);
 const result=manager.prepareOperations(before,[operation('add',{content:'x'.repeat(11)}),operation('add',{type:'relationship',relationship_agent_id:'outsider',content:'Short'})],context);assert.ok(result.auditTrail.every(record=>record.status==='failed'));assert.deepEqual(result.state,before);
 const operational=prepareOperational(before,[{action:'set_location',location_id:'not-registered',reason:'test'}],resolveOperational({enabled:true}),context.source);assert.match(operational.error,/Unknown location/);assert.deepEqual(operational.state,before);
});

test('live-check utility treats mocked HTTP acceptance separately from valid model output and reports grammar errors',async t=>{
 const {promisify}=require('node:util'),{execFile}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path');
 const requests=[],artifacts=[];let reject=false;
 const server=http.createServer(async(req,res)=>{
  if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'fixture'}]}));
  let body='';for await(const part of req)body+=part;requests.push(JSON.parse(body));
  if(reject){res.statusCode=400;return res.end(JSON.stringify({error:'error parsing grammar: number of rules that are going to be repeated multiplied by the new repetition exceeds sane defaults'}));}
  res.end(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{'}}]})); // Deliberately invalid/incomplete JSON content.
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));for(const root of artifacts)await fs.rm(root,{recursive:true,force:true});});
 const options={env:{...process.env,LLM_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,LLM_TEST_MODEL:'fixture'},timeout:15000};
 const run=await promisify(execFile)(process.execPath,[path.join(__dirname,'../scripts/local-schema-check.cjs')],options);
 const root=run.stdout.match(/Schema\/HTTP artifacts: (.+)/)[1];artifacts.push(root);const report=JSON.parse(await fs.readFile(path.join(root,'report.json'),'utf8'));
 assert.equal(report.results.length,18);assert.ok(requests.slice(9).every(r=>r.response_format.json_schema.schema.required.includes('decision')&&r.response_format.json_schema.schema.required.includes('communication')));assert.equal(report.compatibility,'accepted-all-combinations');assert.ok(report.purpose.includes('not tested'));
 for(const [i,[social,task,operational]] of modes.entries()){assert.equal(requests[i].response_format.type,'json_schema');assert.equal(requests[i].max_tokens,1);assert.deepEqual(requests[i].response_format.json_schema.schema,inferenceResponseSchema(social,task,operational));}
 reject=true;
 await assert.rejects(promisify(execFile)(process.execPath,[path.join(__dirname,'../scripts/local-schema-check.cjs')],options),asyncError=>{
  assert.equal(asyncError.code,1);assert.match(asyncError.stderr,/server did not accept schema/);artifacts.push(asyncError.stdout.match(/Schema\/HTTP artifacts: (.+)/)[1]);return true;
 });
 const failed=JSON.parse(await fs.readFile(path.join(artifacts[1],'report.json'),'utf8'));assert.equal(failed.results[0].accepted,false);assert.equal(failed.results[0].grammarError,true);assert.equal(failed.compatibility,'unverified');
});
