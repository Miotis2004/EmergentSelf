const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {promisify}=require('node:util');
const {execFile}=require('node:child_process');
const {fixture,until,sleep}=require('./helpers.cjs');
const {resolveRecovery,DEFAULT_RECOVERY,classifyFailure}=require('../dist/recovery/recovery');
const {hash}=require('../dist/research/protocol');
const {LlmError}=require('../dist/llm/LlmAdapter');
const recovery={enabled:true,initialBackoffMs:10,maxBackoffMs:20,persistentRetryIntervalMs:1000};
const op={enabled:true,locations:[{id:'room',name:'Room'},{id:'store',name:'Store'}],observationPolicy:'co_located'};
const world={enabled:true,initialPositions:{bob:'room',sara:'store'},items:[{id:'food',name:'Food',unit:'portion',stackable:true,consumable:true}],inventories:[{id:'store-food',ownerType:'location',ownerId:'store',visibility:'local',authorizedAgentIds:[],quantities:{food:3}},{id:'bob-bag',ownerType:'agent',ownerId:'bob',visibility:'private',authorizedAgentIds:[],quantities:{}}],events:[{id:'morning',atMinute:0,occurrences:1,affectedAgentIds:['bob','sara'],observation:'Morning bell',wake:true}]};
const action=(description='First activity')=>({action:'set_action',activity_type:'working',description,status:'in_progress',reason:'Chosen activity'});
const memory={action:'add',type:'belief',content:'An agent-generated position',reason:'Reflection'};
const take={action:'take_item',source_inventory_id:'store-food',destination_inventory_id:'bob-bag',item_id:'food',quantity:1,reason:'Taking food'};
const move={action:'set_location',location_id:'store',reason:'Move to store'};
const output=(extra={})=>JSON.stringify({response:'Exact agent dialogue',memory_operations:[],operational_operations:[],world_operations:[],...extra});
const cfg=(f,extra={})=>({...f.config,maxTurns:1,llmConfig:{...f.config.llmConfig,model:'real-loaded-id'},operationalConfig:op,worldConfig:world,recoveryConfig:recovery,...extra});
const finish=async f=>{await until(()=>['completed','paused','stopped'].includes(f.controller.getStatus()));await f.controller.activePromise;};
const attempts=async f=>(await f.logs.getEventHistory(f.controller.getConfig().runId)).filter(e=>e.type==='recovery_attempt');

test('recovery defaults and limits are explicit, and technical categories are independent from invalid actions',()=>{
 assert.deepEqual(resolveRecovery(),DEFAULT_RECOVERY);assert.equal(resolveRecovery(undefined,true).enabled,false);
 for(const config of [{correctiveRetries:-1},{technicalRetries:2.5},{initialBackoffMs:0},{maxBackoffMs:100},{persistentRetryIntervalMs:0},{enabled:'true'},{invented:1}])assert.throws(()=>resolveRecovery(config));
 const diag={httpStatus:null};for(const [kind,category] of [['timeout','inference_timeout'],['connection','inference_connection'],['server','inference_server'],['configuration','configuration_error'],['output','schema_validation']])assert.equal(classifyFailure(new LlmError('Diagnostic',diag,kind)).category,category);
});

for(const [name,invalid,code] of [
 ['local communication',{social:{action:'speak',recipient_id:'sara'}},'AGENT_NOT_COLOCATED'],
 ['private inventory',{world_operations:[{action:'inspect_inventory',inventory_id:'sara-private',reason:'Inspect'}]},'INVENTORY_NOT_ACCESSIBLE'],
 ['insufficient quantity',{operational_operations:[move],world_operations:[{...take,quantity:100}]},'INSUFFICIENT_INVENTORY'],
 ['conflicting activity',{operational_operations:[action(),action('Second activity')]},'CONFLICTING_OPERATIONAL_TRANSITIONS'],
 ['nonexistent item',{operational_operations:[move],world_operations:[{...take,item_id:'unknown'}]},'INVALID_ITEM_REFERENCE'],
])test(`invalid ${name} is rejected atomically and corrected automatically`,async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);return output({...(!n?invalid:{}),memory_operations:[memory],...(name==='local communication'&&n?{social:{action:'speak',recipient_id:null}}:{})});});
 const beforeSara=hash(await f.storage.loadWorkingState('sara'));const wc=structuredClone(world);wc.inventories.push({id:'sara-private',ownerType:'agent',ownerId:'sara',visibility:'private',authorizedAgentIds:[],quantities:{}});
 await f.controller.start(cfg(f,{worldConfig:wc,...(name==='local communication'?{socialConfig:{enabled:true}}:{})}));await finish(f);
 assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,2);assert.equal(f.stats().maximum,1);
 const records=await attempts(f);assert.equal(records.length,1);assert.equal(records[0].code,code);assert.equal(records[0].stateCommitted,false);assert.equal(records[0].recoveryAction,'corrective_retry');assert.ok(records[0].correctionMessage.includes('uncommitted_proposal'));
 const turns=await f.logs.getConversationHistory(f.config.runId);assert.equal(turns.length,1);assert.equal(turns[0].response,'Exact agent dialogue');assert.equal(turns[0].recoverySummary.correctiveAttempts,1);assert.equal(turns[0].worldAfter.minute,15);assert.equal(turns[0].worldAfter.inventories[0].quantities.food,3);assert.equal((await f.storage.loadWorkingState('bob')).entries.length,1);assert.equal(hash(await f.storage.loadWorkingState('sara')),beforeSara);
 assert.equal(requests[1].messages[0].content,requests[0].messages[0].content);assert.equal(requests[1].messages[1].content,requests[0].messages[1].content);assert.ok(requests[1].messages.some(m=>m.content.includes(code)));assert.equal((await f.logs.worldAt(f.config.runId)).executed.length,1);
});

test('an invalid memory operation rejects otherwise-valid memory, movement and inventory operations',async t=>{
 const f=await fixture(t,n=>output(n===0?{memory_operations:[memory,{action:'update',type:'belief',target_id:'absent',content:'Revision',reason:'Change'}],operational_operations:[move],world_operations:[take]}:{}));
 const statuses=[];f.controller.onEvent((type,data)=>{if(type==='recovery_attempt')statuses.push(data);});
 await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(statuses[0].code,'INVALID_MEMORY_OPERATION');assert.equal((await f.storage.loadWorkingState('bob')).entries.length,0);assert.equal(f.controller.getState().worldState.positions.bob,'room');assert.equal(f.controller.getState().worldState.inventories[0].quantities.food,3);
});

test('malformed JSON gets a private formatting correction and never appears in the conversation',async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);return n===0?'ordinary plain text':output();});
 await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal((await attempts(f))[0].code,'INVALID_STRUCTURED_OUTPUT');assert.ok(requests[1].messages.some(m=>m.content.includes('ordinary plain text')&&m.content.includes('UNCOMMITTED ATTEMPT')));assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,1);
});

test('corrective budget exhaustion suspends with all rejected proposals and no turn effects',async t=>{
 const f=await fixture(t,()=>output({operational_operations:[action(),action()]}));await f.controller.start(cfg(f));await finish(f);
 assert.equal(f.controller.getStatus(),'paused');assert.equal(f.controller.getState().recovery.phase,'suspended');assert.equal(f.stats().requests,4);assert.equal(f.controller.getTurnIndex(),0);assert.equal(f.controller.getState().worldState.minute,0);assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,0);const rejected=await attempts(f);assert.equal(rejected.length,4);assert.equal(rejected.at(-1).recoveryAction,'suspend');assert.equal(rejected[1].repeatedViolation,true);assert.equal(f.controller.getState().activeAgentId,null);
});

test('temporary HTTP server failures use identical requests and bounded technical backoff',async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);return n<2?{status:503}:output();});await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,3);assert.deepEqual(requests[0],requests[1]);assert.deepEqual(requests[1],requests[2]);assert.ok((await attempts(f)).every(e=>e.category==='inference_server'&&e.recoveryAction==='technical_retry'));assert.equal(f.controller.getState().worldState.minute,15);
});

test('an actual request timeout is classified and retried without clock or turn advancement',async t=>{
 const f=await fixture(t,async n=>{if(n===0)await sleep(500);return output();});await f.controller.start(cfg(f,{llmConfig:{...f.config.llmConfig,model:'real-loaded-id',requestTimeoutMs:200},recoveryConfig:{...recovery,initialBackoffMs:600,maxBackoffMs:600}}));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal((await attempts(f))[0].category,'inference_timeout');assert.equal(f.stats().maximum,1);assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,1);
});

test('refused connections enter persistent waiting and recover when the same server returns',async t=>{
 const f=await fixture(t,()=>output());const port=f.modelServer.address().port;await new Promise(r=>f.modelServer.close(r));
 await f.controller.start(cfg(f,{recoveryConfig:{...recovery,technicalRetries:1}}));await until(()=>f.controller.getState().recovery.phase==='waiting');assert.equal(f.controller.getStatus(),'running');assert.equal(f.controller.getTurnIndex(),0);assert.equal(f.controller.getState().worldState.minute,0);
 await new Promise(r=>f.modelServer.listen(port,'127.0.0.1',r));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,1);assert.ok((await attempts(f)).some(e=>e.recoveryAction==='wait_for_reconnection'));
});

for(const control of ['stop','pause'])test(`${control} cancels pending backoff and cannot auto-resume`,async t=>{
 const f=await fixture(t,n=>n===0?{status:503}:output());await f.controller.start(cfg(f,{recoveryConfig:{...recovery,initialBackoffMs:300,maxBackoffMs:300}}));await until(()=>f.controller.getState().recovery.phase==='retrying');await f.controller[control]();const count=f.stats().requests;await sleep(350);assert.equal(f.stats().requests,count);assert.equal(f.controller.getStatus(),control==='stop'?'stopped':'paused');assert.equal(f.controller.getTurnIndex(),0);
 if(control==='pause'){await Promise.all([f.controller.resume(),f.controller.resume()]);await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().maximum,1);}
});

test('projection failure automatically reconciles the committed turn without another inference or duplicate transfer',async t=>{
 const f=await fixture(t,()=>output({operational_operations:[move],world_operations:[take],memory_operations:[memory]}));const original=f.logs.projectTurn.bind(f.logs);let fail=true;f.logs.projectTurn=async(...args)=>{if(fail){fail=false;throw Error('Injected projection failure');}return original(...args);};
 await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,1);assert.equal(f.controller.getTurnIndex(),1);assert.equal(f.controller.getState().worldState.inventories[1].quantities.food,1);assert.equal((await f.storage.loadWorkingState('bob')).entries.length,1);
});

test('persistently unavailable commit writes suspend without repeating inference or applying candidate state',async t=>{
 const f=await fixture(t,()=>output({operational_operations:[move],world_operations:[take]}));f.logs.appendConversationTurn=async()=>{throw Object.assign(Error('No space'),{code:'ENOSPC'});};await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'paused');assert.equal(f.controller.getState().recovery.code,'COMMIT_SAFETY_UNVERIFIED');assert.equal(f.stats().requests,1);assert.equal(f.controller.getState().worldState.minute,0);
});

async function childRun(f,config,mode){
 const code=`const {ExperimentController}=require(${JSON.stringify(path.resolve(__dirname,'../dist/experiments/ExperimentController'))});const {JsonStorage}=require(${JSON.stringify(path.resolve(__dirname,'../dist/storage/JsonStorage'))});const {JsonlStorage}=require(${JSON.stringify(path.resolve(__dirname,'../dist/storage/JsonlStorage'))});const {LlmAdapter}=require(${JSON.stringify(path.resolve(__dirname,'../dist/llm/LlmAdapter'))});const logs=new JsonlStorage(process.env.TEST_ROOT+'/research');const c=new ExperimentController(new JsonStorage(process.env.TEST_ROOT+'/agents'),logs,new LlmAdapter());if(process.env.TEST_MODE==='commit')logs.projectTurn=async()=>process.exit(0);c.onEvent((type)=>{if(process.env.TEST_MODE==='inference'&&type==='turn_started')process.exit(0);if(type==='recovery_attempt'){if(process.env.TEST_MODE==='pause')c.pause().then(()=>process.exit(0));else if(process.env.TEST_MODE==='stop')c.stop().then(()=>process.exit(0));else process.exit(0);}});c.start(JSON.parse(process.env.TEST_CONFIG)).catch(e=>{console.error(e);process.exit(1)});`;
 await promisify(execFile)(process.execPath,['-e',code],{env:{...process.env,TEST_ROOT:f.root,TEST_MODE:mode,TEST_CONFIG:JSON.stringify(config)},timeout:15000});
}

for(const mode of ['reject','inference','commit','pause','stop'])test(`restart from ${mode} restores durable state and honors explicit controls`,async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);return n===0&&['reject','pause','stop'].includes(mode)?output({operational_operations:[action(),action()]}):output({operational_operations:[move],world_operations:[take],memory_operations:[memory]});});
 await childRun(f,cfg(f),mode);await f.controller.restore();
 if(mode==='pause'||mode==='stop'){assert.equal(f.controller.getStatus(),mode==='pause'?'paused':'stopped');await sleep(50);assert.equal(f.stats().requests,1);if(mode==='pause'){await f.controller.resume();await finish(f);}else return;}
 else await finish(f);
 assert.equal(f.controller.getStatus(),'completed');assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,1);assert.equal((await f.storage.loadWorkingState('bob')).entries.length,1);assert.equal(f.controller.getState().worldState.inventories[1].quantities.food,1);assert.equal(f.controller.getState().worldState.executed.length,1);
 if(mode==='reject'||mode==='pause')assert.ok(requests.at(-1).messages.some(m=>m.content.includes('CONFLICTING_OPERATIONAL_TRANSITIONS')));
 if(mode==='commit')assert.equal(f.stats().requests,1);
 if(mode==='inference')assert.ok((await attempts(f)).some(e=>e.code==='ATTEMPT_INTERRUPTED'));
});

for(const schedulingMode of ['round_robin','event_driven'])test(`${schedulingMode} uses the same logical participant until correction succeeds`,async t=>{
 const f=await fixture(t,n=>n===0?'invalid':output());await f.controller.start(cfg(f,{maxTurns:3,worldConfig:{...world,schedulingMode}}));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.deepEqual((await f.logs.getConversationHistory(f.config.runId)).map(t=>t.agentId),['bob','sara','bob']);assert.equal(f.stats().maximum,1);
});

test('automatic correction works without World Simulation or operational turns',async t=>{
 const f=await fixture(t,n=>n===0?'plain text':JSON.stringify({response:'Original words',memory_operations:[]}));await f.controller.start({...f.config,maxTurns:1,recoveryConfig:recovery});await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal((await f.logs.getConversationHistory(f.config.runId))[0].response,'Original words');
});

test('Helena Turn 56 residence-social-07 regression corrects multiple set_action operations privately',async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);return output({response:`Original dialogue ${n}`,social:{action:'speak',recipient_id:null},operational_operations:n===56?[action('Uncommitted one'),action('Uncommitted two')]:[],memory_operations:n===56?[memory]:[]});},['helena','other']);
 await f.controller.start({...f.config,runId:'residence-social-07',agentIds:['helena','other'],maxTurns:57,llmConfig:{...f.config.llmConfig,model:'real-loaded-id'},operationalConfig:op,socialConfig:{enabled:true},worldConfig:{enabled:true,initialPositions:{helena:'room',other:'room'}},recoveryConfig:recovery});await finish(f);
 assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,58);const turns=await f.logs.getConversationHistory('residence-social-07');assert.equal(turns.length,57);assert.equal(turns[56].agentId,'helena');assert.equal(turns[56].response,'Original dialogue 57');assert.equal(turns[56].simulationMinute,840);assert.equal(turns[56].worldAfter.minute,855);assert.equal((await f.storage.loadWorkingState('helena')).entries.length,0);
 const rejected=(await attempts(f))[0];assert.equal(rejected.turnIndex,56);assert.equal(rejected.code,'CONFLICTING_OPERATIONAL_TRANSITIONS');assert.ok(requests[57].messages.some(m=>m.content.includes('Retry 1 of 3')&&m.content.includes('Uncommitted two')));assert.equal(requests[57].messages[0].content,requests[56].messages[0].content);assert.ok(turns.every(turn=>!turn.response.includes('REJECTION')));assert.equal(f.stats().maximum,1);
});

test('a commit append that succeeds before reporting an error is detected and never repeated',async t=>{
 const f=await fixture(t,()=>output({operational_operations:[move],world_operations:[take],memory_operations:[memory]}));const append=f.logs.appendConversationTurn.bind(f.logs);f.logs.appendConversationTurn=async(...args)=>{await append(...args);throw Error('Lost append acknowledgment');};
 await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,1);assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,1);assert.equal(f.controller.getState().worldState.inventories[1].quantities.food,1);assert.equal((await f.storage.loadWorkingState('bob')).entries.length,1);
});

test('known committed projection retries safely until transient storage recovers',async t=>{
 const f=await fixture(t,()=>output({operational_operations:[move],world_operations:[take]}));const project=f.logs.projectTurn.bind(f.logs);let remaining=3;f.logs.projectTurn=async(...args)=>{if(remaining-->0)throw Object.assign(Error('Transient disk error'),{code:'EIO'});return project(...args);};
 await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,1);assert.ok((await attempts(f)).some(e=>e.code==='COMMITTED_PROJECTION_RETRY'&&e.stateCommitted));assert.equal(f.controller.getState().worldState.inventories[1].quantities.food,1);
});

test('configuration failures suspend for the researcher rather than asking the agent to fix them',async t=>{
 const f=await fixture(t,()=>({status:400,body:{error:'unsupported schema'}}));await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'paused');const audit=(await attempts(f))[0];assert.equal(audit.category,'configuration_error');assert.equal(audit.recoveryAction,'suspend');assert.equal(audit.correctionMessage,undefined);assert.equal(f.stats().requests,1);
});

test('rejected-attempt audit cannot fail silently and permit a later commit',async t=>{
 const f=await fixture(t,()=>output({operational_operations:[action(),action()]}));const append=f.logs.appendEvent.bind(f.logs);f.logs.appendEvent=async(run,event)=>{if(event.type==='recovery_attempt')throw Object.assign(Error('Disk full'),{code:'ENOSPC'});return append(run,event);};await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'paused');assert.equal(f.controller.getState().recovery.code,'RECOVERY_AUDIT_UNAVAILABLE');assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,0);assert.equal(f.stats().requests,1);
});

test('malformed operation structure uses the existing strict schema before corrective retry',async t=>{
 const f=await fixture(t,n=>output(n===0?{world_operations:[{...take,quantity:0}]}:{}));await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal((await attempts(f))[0].category,'schema_validation');assert.equal(f.controller.getState().worldState.inventories[0].quantities.food,3);
});

test('a real backend process killed during HTTP inference restores the exact request and commits once',async t=>{
 let release;const gate=new Promise(r=>release=r);const requests=[];
 const f=await fixture(t,async(n,request)=>{requests.push(request);if(n===0)await gate;return output({operational_operations:[move],world_operations:[take],memory_operations:[memory]});});
 const root=path.resolve(__dirname,'../dist');
 const script=`const {ExperimentController}=require(${JSON.stringify(root+'/experiments/ExperimentController')});const {JsonStorage}=require(${JSON.stringify(root+'/storage/JsonStorage')});const {JsonlStorage}=require(${JSON.stringify(root+'/storage/JsonlStorage')});const {LlmAdapter}=require(${JSON.stringify(root+'/llm/LlmAdapter')});const c=new ExperimentController(new JsonStorage(process.env.TEST_ROOT+'/agents'),new JsonlStorage(process.env.TEST_ROOT+'/research'),new LlmAdapter());c.start(JSON.parse(process.env.TEST_CONFIG)).catch(()=>process.exit(1));`;
 const child=require('node:child_process').spawn(process.execPath,['-e',script],{env:{...process.env,TEST_ROOT:f.root,TEST_CONFIG:JSON.stringify(cfg(f))},stdio:'ignore'});t.after(()=>{child.kill('SIGKILL');release();});const exited=new Promise(r=>child.once('exit',r));
 await until(()=>f.stats().requests===1);child.kill('SIGKILL');await exited;release();await sleep(10);
 const saved=await f.logs.latestExecution(f.config.runId);assert.deepEqual(saved.pending.preparedRequest,requests[0]);assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,0);
 await f.controller.restore();await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,2);assert.deepEqual(requests[0],requests[1]);assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,1);assert.equal((await f.storage.loadWorkingState('bob')).entries.length,1);assert.equal(f.controller.getState().worldState.inventories[1].quantities.food,1);
});

test('essential rejection evidence survives disabling the expanded audit payload',async t=>{
 const f=await fixture(t,()=> 'plain rejected output');await f.controller.start(cfg(f,{recoveryConfig:{...recovery,correctiveRetries:0,auditRejectedAttempts:false}}));await finish(f);const audit=(await attempts(f))[0];assert.equal(audit.proposal.raw,'plain rejected output');assert.equal(audit.attempt,undefined);assert.equal(audit.stateCommitted,false);assert.equal(audit.recoveryAction,'suspend');
});

test('new configurations default to automatic recovery without an explicit recovery section',async t=>{
 const f=await fixture(t,n=>n===0?'plain text':JSON.stringify({response:'Exact words',memory_operations:[]}));const input={...f.config,maxTurns:1};delete input.recoveryConfig;await f.controller.start(input);await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal((await f.logs.loadConfig(input.runId)).recoveryConfig.enabled,true);assert.equal(f.stats().requests,2);
});

test('legacy configuration files stay immutable while the effective default recovery policy is audited',async t=>{
 const f=await fixture(t,n=>n===0?'invalid legacy response':JSON.stringify({response:'Exact legacy dialogue',memory_operations:[]}));const {resolveLlmConfig}=require('../dist/llm/LlmAdapter');const input={...f.config,maxTurns:1,llmConfig:resolveLlmConfig({...f.config.llmConfig,model:'real-loaded-id'})};delete input.recoveryConfig;await f.logs.saveConfig(input.runId,input);const file=path.join(f.root,'research/experiments',input.runId,'config.json'),before=await fs.readFile(file,'utf8');await f.controller.start(input);await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.controller.getConfig().recoveryConfig.enabled,true);assert.equal(f.stats().requests,2);assert.equal(await fs.readFile(file,'utf8'),before);assert.equal((await f.logs.latestExecution(input.runId)).recoveryPolicy.enabled,true);assert.equal((await f.logs.getConversationHistory(input.runId))[0].recoveryPolicy.enabled,true);
});

test('Resume after restoring a paused run reacquires the shared writer lease before inference',async t=>{
 const f=await fixture(t,n=>n===0?output({operational_operations:[action(),action()]}):output());await childRun(f,cfg(f),'pause');await f.controller.restore();assert.equal(f.controller.getStatus(),'paused');
 const otherOwner='other-researcher';await f.logs.acquireWriter(otherOwner);await assert.rejects(f.controller.resume(),/Another experiment writer/);assert.equal(f.stats().requests,1);await f.logs.releaseWriter(otherOwner);await f.controller.resume();await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().maximum,1);
});

test('repairing audit storage and Resume preserves the originally rejected evidence before another inference',async t=>{
 const f=await fixture(t,n=>n===0?output({operational_operations:[action(),action()]}):output());const append=f.logs.appendEvent.bind(f.logs);let fail=true;f.logs.appendEvent=async(run,event)=>{if(fail&&event.type==='recovery_attempt'){fail=false;throw Object.assign(Error('Transient audit storage failure'),{code:'EIO'});}return append(run,event);};await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'paused');assert.equal(f.stats().requests,1);await f.controller.resume();await finish(f);assert.equal(f.controller.getStatus(),'completed');const rejected=await attempts(f);assert.equal(rejected.length,1);assert.equal(rejected[0].code,'CONFLICTING_OPERATIONAL_TRANSITIONS');assert.equal(rejected[0].proposal.parsed.operational_operations.length,2);assert.equal(f.stats().requests,2);
});

test('private corrections and rejected proposals never reach another participant or become stored memories',async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);return output(n===0?{operational_operations:[action('SECRET_REJECTED_ACTIVITY'),action()],memory_operations:[{...memory,content:'SECRET_REJECTED_BELIEF'}]}:{});});
 await f.controller.start(cfg(f,{maxTurns:2,feedbackConfig:{enabled:true,visibility:'public'}}));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,3);assert.ok(requests[1].messages.some(m=>m.content.includes('SECRET_REJECTED_ACTIVITY')));assert.ok(requests[2].messages.every(m=>!m.content.includes('SECRET_REJECTED_ACTIVITY')&&!m.content.includes('SECRET_REJECTED_BELIEF')&&!m.content.includes('[EMERGENTSELF_CORRECTION_V1]')));assert.equal((await f.storage.loadWorkingState('bob')).entries.length,0);assert.equal((await f.storage.loadWorkingState('sara')).entries.length,0);
});

for(const control of ['stop','pause'])test(`${control} aborts an active HTTP inference and never commits its late response`,async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,async n=>{if(n===0)await gate;return output({memory_operations:[memory]});});
 await f.controller.start(cfg(f));await until(()=>f.stats().requests===1);await f.controller[control]();release();await sleep(20);assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,0);assert.equal(f.controller.getState().worldState.minute,0);assert.equal((await f.storage.loadWorkingState('bob')).entries.length,0);assert.equal(f.controller.getStatus(),control==='stop'?'stopped':'paused');
 assert.ok((await attempts(f)).some(event=>event.code==='RESEARCHER_CANCELLED'&&!event.stateCommitted));if(control==='pause'){await f.controller.resume();await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal((await f.storage.loadWorkingState('bob')).entries.length,1);}
});

test('a verified absent prepared commit survives a transient write failure without repeating inference',async t=>{
 const f=await fixture(t,()=>output({operational_operations:[move],world_operations:[take],memory_operations:[memory]}));const append=f.logs.appendConversationTurn.bind(f.logs);let fail=true;f.logs.appendConversationTurn=async(...args)=>{if(fail){fail=false;throw Object.assign(Error('Temporary write failure'),{code:'EIO'});}return append(...args);};await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,1);assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,1);assert.equal((await f.storage.loadWorkingState('bob')).entries.length,1);assert.equal(f.controller.getState().worldState.inventories[1].quantities.food,1);assert.ok((await attempts(f)).some(event=>event.code==='PREPARED_COMMIT_WRITE_RETRY'&&!event.stateCommitted));
});

test('a partially written corrupt log suspends without guessing or retrying the prepared mutation',async t=>{
 const f=await fixture(t,()=>output({operational_operations:[move],world_operations:[take]}));let writes=0;f.logs.appendConversationTurn=async()=>{writes++;await fs.appendFile(path.join(f.root,'research/experiments',f.config.runId,'conversation.jsonl'),'{');throw Object.assign(Error('Partial append'),{code:'EIO'});};await f.controller.start(cfg(f));await finish(f);assert.equal(f.controller.getStatus(),'paused');assert.equal(f.controller.getState().recovery.code,'COMMIT_SAFETY_UNVERIFIED');assert.equal(f.stats().requests,1);assert.equal(writes,1);assert.equal(f.controller.getState().worldState.minute,0);
});
