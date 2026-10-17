const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const express=require('express');
const {fixture,until}=require('./helpers.cjs');
const {DEMEANORS,validateStartingDemeanor,demeanorContext}=require('../dist/agents/startingDemeanor');
const {createAgentsRouter}=require('../dist/api/agents');
const {ResearchService}=require('../dist/research/ResearchService');
const {BranchService}=require('../dist/branches/BranchService');
const {hash,normalizeProtocol,renderProtocol}=require('../dist/research/protocol');
const {resolveMemoryConfig}=require('../dist/memory/types');
const {MemoryManager}=require('../dist/agents/MemoryManager');
const reply=()=>JSON.stringify({response:'Exact model speech',memory_operations:[]});
async function addAgent(f,startingDemeanor=validateStartingDemeanor({type:'analytical'})){
 const identity={id:'gary',name:'Gary',stats:{curiosity:{initial:5,current:5},sociability:{initial:4,current:4}},memories:[],beliefs:[],...(startingDemeanor?{startingDemeanor}:{})};
 await f.storage.saveAgentIdentity('gary',identity);return identity;
}

test('creation API serves canonical options, validates custom descriptions, and preserves legacy creation',async t=>{
 const f=await fixture(t,reply),app=express();app.use(express.json());app.use('/agents',createAgentsRouter(f.storage));
 const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}/agents`;
 assert.deepEqual(await (await fetch(base+'/demeanors')).json(),DEMEANORS);
 let count=0;
 const create=async startingDemeanor=>fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:`new-${count++}`,name:'New',stats:{curiosity:{initial:3,current:3}},...(startingDemeanor===undefined?{}:{startingDemeanor})})});
 for(const option of DEMEANORS.filter(option=>option.type!=='custom')){
  const response=await create({type:option.type});assert.equal(response.status,201);assert.deepEqual((await response.json()).startingDemeanor,{type:option.type,description:option.description});
 }
 const custom=await create({type:'custom',description:'  Patient and reflective  '});assert.equal(custom.status,201);
 const identity=await custom.json();assert.equal(identity.startingDemeanor.description,'Patient and reflective');assert.deepEqual(await f.storage.loadAgentIdentity(identity.id),identity);
 const legacy=await create();assert.equal(legacy.status,201);assert.ok(!Object.hasOwn(await legacy.json(),'startingDemeanor'));
 for(const input of [null,[],{},'helpful',{type:'unknown'},{type:'custom',description:'  '},{type:'custom',description:'x'.repeat(1001)},{type:'custom',description:9},{type:'helpful',description:'Different stereotype'},{type:'custom',description:'OK',extra:1}])assert.equal((await create(input)).status,400);
 const boundary=await create({type:'custom',description:'x'.repeat(1000)});assert.equal(boundary.status,201);
});

for(const protocol of [false,true])for(const mode of ['none','history','enabled'])test(`${protocol?'research':'standard'} / ${mode}: initial demeanor is distinct from conversation, learned identity and transport`,async t=>{
 const requests=[],f=await fixture(t,(n,payload)=>{requests.push(payload);return reply();});const identity=await addAgent(f);
 await f.storage.saveAgentMemory('gary',[{id:'existing',content:'A prior observation'}]);
 const config={...f.config,agentIds:['gary','sara'],maxTurns:3,initialTopic:'A separate topic',memoryConfig:{mode},...(protocol?{protocol:{systemPrompt:'Research identity: {id}\n{attributes}\n{memory}',turnPrompt:'Turn for {name}'}}:{}),llmConfig:{...f.config.llmConfig,modelVersion:'fixture'}};
 await f.controller.start(config);await until(()=>f.controller.getStatus()==='completed');
 const turns=await f.logs.getConversationHistory('test-run'),prompt=turns[0].prompt.system;
 assert.ok(prompt.includes(identity.startingDemeanor.description));assert.ok(prompt.includes('does not require you to maintain those tendencies permanently'));
 assert.ok(prompt.includes('Do not manufacture changes'));assert.ok(!prompt.includes('A separate topic'));
 assert.equal(turns[0].prompt.messages[0].content,'A separate topic');assert.ok(!turns[2].prompt.messages[0].content.includes('A separate topic'));
 assert.ok(!turns[1].prompt.system.includes('Starting Demeanor')); // Sara remains a legacy agent.
 assert.equal(requests[0].messages[0].content,prompt);assert.ok(!requests[0].messages.at(-1).content.includes(identity.startingDemeanor.description));
 const baseline=await f.logs.loadBaseline('test-run');assert.deepEqual(baseline.states.gary.identity.startingDemeanor,identity.startingDemeanor);
 assert.deepEqual((await f.storage.loadAgentIdentity('gary')).stats,identity.stats);
 const memory=new MemoryManager(f.storage);
 await memory.applyOperations('gary',[{action:'add',type:'self_description',content:'I now prefer spontaneous exploration',reason:'A learned preference'},{action:'update',type:'stat',target_id:'curiosity',content:8,reason:'New experience'}]);
 const state=await f.storage.loadWorkingState('gary');assert.deepEqual(state.identity.startingDemeanor,identity.startingDemeanor);
 assert.equal(state.identity.stats.curiosity.initial,5);assert.equal(state.identity.stats.curiosity.current,8);assert.ok(state.entries.some(entry=>entry.type==='self_description'));
});

test('demeanor is immutable through both legacy and canonical writes, including adding it to an existing legacy agent',async t=>{
 const f=await fixture(t,reply),identity=await addAgent(f),state=await f.storage.loadWorkingState('gary');
 for(const startingDemeanor of [undefined,validateStartingDemeanor({type:'helpful'})]){
  await assert.rejects(f.storage.saveAgentIdentity('gary',{...identity,startingDemeanor}),/immutable/);
  await assert.rejects(f.storage.saveWorkingState('gary',{...state,identity:{...identity,startingDemeanor}}),/immutable/);
 }
 await f.storage.saveWorkingState('gary',state);
 await assert.rejects(f.storage.saveAgentIdentity('gary',{...identity,startingDemeanor:undefined}),/immutable/);
 const bob=await f.storage.loadAgentIdentity('bob');await assert.rejects(f.storage.saveAgentIdentity('bob',{...bob,startingDemeanor:identity.startingDemeanor}),/immutable/);
 assert.deepEqual(await f.storage.loadWorkingState('gary'),state);
});

test('custom descriptions are literal context and researcher-assigned roles take precedence',async t=>{
 const f=await fixture(t,reply);await addAgent(f,{type:'custom',description:'Deliberate {memory} and {attributes} observations'});
 const state=await f.storage.loadWorkingState('gary'),memory=resolveMemoryConfig();
 const protocol=normalizeProtocol({attributeMode:'role',roles:{gary:'A neutral evidence recorder'},systemPrompt:'Assigned role: {attributes}'},'enabled');
 const rendered=renderProtocol(state,memory,protocol,[]);
 assert.ok(rendered.system.startsWith('Assigned role: A neutral evidence recorder'));
 assert.ok(rendered.system.includes('Deliberate {memory} and {attributes} observations'));
 assert.ok(rendered.system.includes('researcher-assigned role and experimental task instructions take precedence'));
 assert.equal(demeanorContext({}), '');
});

test('frozen snapshots, clones, branches, restart and exports preserve demeanor and original experimental artifacts',async t=>{
 const f=await fixture(t,reply),identity=await addAgent(f),research=new ResearchService(f.controller,f.logs,f.storage);
 const template=await research.template('demeanor-source',{...f.config,agentIds:['gary','sara'],maxTurns:2,llmConfig:{...f.config.llmConfig,model:'real-loaded-id',modelVersion:'fixture'}});
 const sourceSnapshot=await f.logs.loadArtifact('snapshots',template.configuration.protocol.snapshotId),original=hash(sourceSnapshot);
 const batch=await research.batch('demeanor-batch','demeanor-source',1,['enabled'],1),runId=batch.trials[0].runId;
 await research.startTrial('demeanor-batch',runId);await until(()=>f.controller.getStatus()==='completed');
 const configBefore=hash(await f.logs.loadConfig(runId)),turnsBefore=hash(await f.logs.getConversationHistory(runId));
 await research.snapshot('demeanor-checkpoint',runId,1,'Researcher','Preserve initial disposition');
 await research.clone('demeanor-checkpoint','gary','gary-clone','Researcher','Identity-preserving clone');
 assert.deepEqual((await f.storage.loadWorkingState('gary-clone')).identity.startingDemeanor,identity.startingDemeanor);
 const branches=new BranchService(f.controller,f.logs,research);
 const branch=await branches.create({branchId:'demeanor-branch',sourceSnapshotId:'demeanor-checkpoint',operations:[{kind:'attributes',agentId:'gary',values:{curiosity:8}}],actor:'Researcher',reason:'Explicit current-stat intervention',maxTurns:2});
 assert.deepEqual(branch.snapshot.states.gary.identity.startingDemeanor,identity.startingDemeanor);
 await branches.start('demeanor-branch');await until(()=>f.controller.getStatus()==='completed');
 const branchState=await f.logs.trialStorage('demeanor-branch').loadWorkingState('gary');
 assert.deepEqual(branchState.identity.startingDemeanor,identity.startingDemeanor);assert.equal(branchState.identity.stats.curiosity.initial,5);
 // Restoring a saved working state leaves initial metadata and learned entries intact.
 await f.logs.trialStorage('demeanor-branch').saveWorkingState('gary',branch.snapshot.states.gary);
 await f.controller.stop();const restarted=f.createController();await restarted.start(branch.configuration);await until(()=>restarted.getStatus()==='completed');
 const exported=await research.exportRun(runId);
 assert.deepEqual(exported.startingSnapshot.states.gary.identity.startingDemeanor,identity.startingDemeanor);
 assert.deepEqual(exported.baseline.states.gary.identity.startingDemeanor,identity.startingDemeanor);
 assert.equal(hash(await f.logs.loadConfig(runId)),configBefore);assert.equal(hash(await f.logs.getConversationHistory(runId)),turnsBefore);
 assert.equal(hash(await f.logs.loadArtifact('snapshots',sourceSnapshot.snapshotId)),original);
});

test('failed-turn Resume preserves initial demeanor, completed turns and original baseline',async t=>{
 const f=await fixture(t,n=>n===1?'Invalid conversational output':reply()),identity=await addAgent(f);
 await f.controller.start({...f.config,agentIds:['gary','sara'],maxTurns:3});await until(()=>f.controller.getStatus()==='paused');
 const initial=hash(await f.logs.loadBaseline('test-run'));
 await f.controller.resume();await until(()=>f.controller.getStatus()==='completed');
 const turns=await f.logs.getConversationHistory('test-run');assert.deepEqual(turns.map(turn=>turn.turnIndex),[0,1,2]);
 assert.deepEqual(turns[2].stateBefore.identity.startingDemeanor,identity.startingDemeanor);
 assert.ok(turns[2].prompt.system.includes(identity.startingDemeanor.description));assert.equal(hash(await f.logs.loadBaseline('test-run')),initial);
 assert.equal(f.stats().maximum,1);
});
