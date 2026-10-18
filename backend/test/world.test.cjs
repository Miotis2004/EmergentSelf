const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {fixture,until}=require('./helpers.cjs');
const w=require('../dist/world/simulation');
const {resolveOperational}=require('../dist/operations/state');
const {responseSchema,inferenceResponseSchema,validateAgentTurn}=require('../dist/llm/agentTurnSchema');
const {ResearchService}=require('../dist/research/ResearchService');
const {BranchService}=require('../dist/branches/BranchService');
const {hash}=require('../dist/research/protocol');
const op=resolveOperational({enabled:true,locations:[{id:'store',name:'Store'},{id:'room',name:'Room'}],observationPolicy:'co_located'});
const agents=['bob','sara'];
function config(extra={}){return w.resolveWorld({enabled:true,initialPositions:{bob:'store',sara:'room'},items:[{id:'food',name:'Food',unit:'portion',stackable:true,consumable:true}],inventories:[
 {id:'store-food',ownerType:'location',ownerId:'store',visibility:'local',authorizedAgentIds:[],quantities:{food:10}},
 {id:'bob-bag',ownerType:'agent',ownerId:'bob',visibility:'private',authorizedAgentIds:[],quantities:{}},
 {id:'sara-bag',ownerType:'agent',ownerId:'sara',visibility:'private',authorizedAgentIds:[],quantities:{}}
],...extra},agents,op);}
const take=(quantity=2)=>({action:'take_item',source_inventory_id:'store-food',destination_inventory_id:'bob-bag',item_id:'food',quantity,reason:'Taking supplies'});
const reply=(operations=[],speech='',operational_operations=[])=>JSON.stringify({response:speech,memory_operations:[],operational_operations,world_operations:operations});
const finish=async f=>until(()=>['completed','paused'].includes(f.controller.getStatus()));
const delivery=(extra={})=>({id:'delivery',atMinute:15,intervalMinutes:15,occurrences:3,inventoryId:'store-food',itemId:'food',quantityDelta:2,affectedAgentIds:['bob'],observation:'Food delivered',wake:true,...extra});

test('clock uses integer minutes and optional world configuration preserves legacy mode',()=>{
 assert.equal(w.resolveWorld(undefined,agents,op),undefined);assert.equal(w.formatSimulationTime(1500),'Day 2 01:00');
 for(const extra of [{minutesPerTurn:0},{initialMinute:1.2},{items:[{id:'bad'}]},{inventories:[{...config().inventories[0],quantities:{food:-1}}]},{initialPositions:{stranger:'store'}},{events:[delivery({occurrences:1001})]}])assert.throws(()=>config(extra));
 const c=config();assert.deepEqual(w.resolveWorld(c,agents,op),c);
});

test('recurring events expand deterministically once per occurrence, including large time jumps',()=>{
 const c=config({events:[delivery(),delivery({id:'a-event',atMinute:15,occurrences:1,quantityDelta:1})]}),before=w.initialWorld(c,agents);
 const first=w.advanceWorld(before,c,50,agents,'run:advance');
 assert.deepEqual(first.state.executed,['a-event:0','delivery:0','delivery:1','delivery:2']);assert.equal(first.state.inventories[0].quantities.food,17);
 const again=w.advanceWorld(first.state,c,50,agents,'run:advance2');assert.equal(again.state.inventories[0].quantities.food,17);assert.equal(again.events.filter(e=>e.type==='world_scheduled_event').length,0);
 assert.equal(before.minute,0);assert.equal(before.inventories[0].quantities.food,10);
});

test('transfers conserve quantities; consumption is explicit; inspection records authorized evidence',()=>{
 const c=config(),before=w.initialWorld(c,agents);
 const result=w.prepareWorld(before,c,'bob',[take(),{action:'inspect_inventory',inventory_id:'bob-bag',reason:'Checking stock'}],'store',agents,'run:turn:0','',null);
 assert.equal(result.state.inventories[0].quantities.food,8);assert.equal(result.state.inventories[1].quantities.food,2);assert.equal(result.state.minute,15);
 assert.equal(result.events[0].requestedOperation.action,'take_item');assert.equal(result.events[0].changes.length,2);assert.equal(result.state.observations[0].source,'authoritative_world');
 const consumed=w.prepareWorld(result.state,c,'bob',[{action:'consume_item',inventory_id:'bob-bag',item_id:'food',quantity:1,reason:'Eating'}],'store',agents,'run:turn:1','',null);assert.equal(consumed.state.inventories[1].quantities.food,1);
 assert.deepEqual(w.prepareWorld(before,c,'bob',[take()],'store',agents,'run:turn:0','',null).state,w.prepareWorld(before,c,'bob',[take()],'store',agents,'run:turn:0','',null).state);
});

test('failed transactional execution leaves clock and all inventories unchanged',()=>{
 const c=config(),before=w.initialWorld(c,agents),saved=hash(before);
 for(const operations of [[take(11)],[take(),take(100)],[{action:'consume_item',inventory_id:'sara-bag',item_id:'food',quantity:1,reason:'invalid'}],[{...take(),quantity:0}]])assert.throws(()=>w.prepareWorld(before,c,'bob',operations,'store',agents,'failed','',null));
 assert.equal(hash(before),saved);
});

test('visibility does not confer physical access, and remote private inventories require explicit authorization',()=>{
 const c=config(),s=w.initialWorld(c,agents);
 assert.deepEqual(w.worldContext(s,c,'sara').inventories.map(i=>i.id),['sara-bag']);
 assert.throws(()=>w.prepareWorld(s,c,'sara',[{action:'inspect_inventory',inventory_id:'bob-bag',reason:'peek'}],'room',agents,'x','',null),/Unauthorized/);
 s.inventories[1].authorizedAgentIds=['sara'];assert.doesNotThrow(()=>w.prepareWorld(s,c,'sara',[{action:'inspect_inventory',inventory_id:'bob-bag',reason:'permitted'}],'room',agents,'x','',null));
 s.inventories[0].visibility='public';assert.equal(w.worldContext(s,c,'sara').inventories.length,3);
 assert.throws(()=>w.prepareWorld(s,c,'sara',[{...take(),destination_inventory_id:'sara-bag'}],'room',agents,'x','',null),/accessible/);
 assert.deepEqual(w.worldContext(s,c,'bob').colocatedAgents,[]);s.positions.sara='store';assert.deepEqual(w.worldContext(s,c,'bob').colocatedAgents,['sara']);
});

test('local communication records recipients, filters transcript and wakes only addressed colocated agents',()=>{
 const c=config({schedulingMode:'event_driven'}),before=w.initialWorld(c,agents);before.waits.sara={untilMinute:100};
 assert.throws(()=>w.prepareWorld(before,c,'bob',[],'store',agents,'x','Hello','sara'),/recipient/);
 const remote=w.prepareWorld(before,c,'bob',[],'store',agents,'x','Private speech',null);assert.deepEqual(remote.recipients,[]);assert.ok(remote.state.waits.sara);
 before.positions.sara='store';const local=w.prepareWorld(before,c,'bob',[],'store',agents,'x','Hello','sara');assert.deepEqual(local.recipients,['sara']);assert.equal(local.state.waits.sara,undefined);
 assert.deepEqual(w.visibleHistory([{agentId:'bob',response:'hidden',messageRecipients:[]},{agentId:'bob',response:'visible',messageRecipients:['sara']}],'sara',c).map(t=>t.response),['visible']);
});

test('event-driven wait conditions wake on time and scheduled occurrence; round-robin remains strict',()=>{
 const c=config({schedulingMode:'event_driven',events:[delivery()]}),s=w.initialWorld(c,agents);s.waits={bob:{eventId:'delivery'},sara:{untilMinute:30}};
 assert.equal(w.nextAgent(s,c,agents,0),undefined);assert.equal(w.nextWakeMinute(s,c),15);
 const after=w.advanceWorld(s,c,15,agents,'step').state;assert.equal(w.nextAgent(after,c,agents,0),'bob');assert.ok(after.waits.sara);
 assert.equal(w.nextAgent(s,{...c,schedulingMode:'round_robin'},agents,1),'sara');
 const later=w.advanceWorld(after,c,30,agents,'step2').state;assert.equal(later.waits.sara,undefined);
});

for(const [social,task,operational] of [[false,false,true],[true,false,true],[true,true,true]])test(`world schema projection and independent validation social=${social} task=${task}`,()=>{
 const value={response:'',memory_operations:[],operational_operations:[],world_operations:[take()],...(social?{social:{action:'decline',recipient_id:null}}:{})};
 assert.doesNotThrow(()=>validateAgentTurn(value,social,task,operational,true));
 for(const change of [{world_operations:[{...take(),quantity:-1}]},{world_operations:[{action:'schedule_event',reason:'invented'}]},{world_operations:Array.from({length:9},()=>take())}])assert.throws(()=>validateAgentTurn({...value,...change},social,task,operational,true),/schema/);
 const json=JSON.stringify(inferenceResponseSchema(social,task,operational,true));assert.ok(!json.includes('maxLength'));assert.ok(!json.includes('maxItems'));assert.ok(json.includes('world_operations'));assert.ok(JSON.stringify(responseSchema(social,task,operational,true)).includes('maxItems'));
});

test('failed inference preserves world time; Resume/restart retain commits without duplicate transfers or scheduled effects',async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);return n===0?reply([take()]):n===1?'plain text':reply();});
 const cfg={...f.config,maxTurns:3,operationalConfig:op,worldConfig:config({events:[delivery()]})};
 await f.controller.start(cfg);await finish(f);assert.equal(f.controller.getStatus(),'paused');assert.equal(f.controller.getState().worldState.minute,15);
 const committed=await f.logs.worldAt(cfg.runId);assert.equal(committed.inventories[0].quantities.food,10);assert.equal(committed.inventories[1].quantities.food,2);
 await Promise.all([f.controller.resume(),f.controller.resume()]);await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.controller.getState().worldState.minute,45);assert.equal(f.stats().maximum,1);
 const history=await f.logs.getConversationHistory(cfg.runId);assert.deepEqual(history.map(t=>t.simulationMinute),[0,15,30]);assert.equal(history[0].worldValidation.status,'passed');assert.equal(history[0].worldObservation.locationId,'store');
 const error=(await f.logs.getEventHistory(cfg.runId)).find(e=>e.type==='experiment_error');assert.equal(error.attempt.rawResponse,'plain text');
 await f.controller.stop();const restart=f.createController();await restart.start(cfg);assert.equal(restart.getState().worldState.minute,45);assert.equal(f.stats().requests,4);
 assert.equal((await f.logs.worldAt(cfg.runId)).executed.length,3);
 assert.ok(!requests[1].messages[0].content.includes('Taking supplies'));
});

test('world rejection audits original operation and leaves memory, movement, inventory and time uncommitted',async t=>{
 const f=await fixture(t,()=>JSON.stringify({response:'Proposed',memory_operations:[{action:'add',type:'belief',content:'A new belief',reason:'Proposal'}],operational_operations:[{action:'set_location',location_id:'store',reason:'Move'}],world_operations:[take(100)]}));
 const before=hash(await f.storage.loadWorkingState('bob'));
 await f.controller.start({...f.config,maxTurns:1,operationalConfig:op,worldConfig:config()});await finish(f);
 assert.equal(f.controller.getStatus(),'paused');assert.equal(f.controller.getState().worldState.minute,0);assert.equal(hash(await f.storage.loadWorkingState('bob')),before);assert.equal((await f.logs.getConversationHistory(f.config.runId)).length,0);
 const error=(await f.logs.getEventHistory(f.config.runId)).find(e=>e.type==='experiment_error');assert.equal(error.attempt.worldOperations[0].quantity,100);assert.equal(error.attempt.worldValidation.status,'rejected');assert.match(error.message,/Insufficient/);
});

test('all-waiting agents advance without empty inference; explicit wake survives restart',async t=>{
 const f=await fixture(t,(n)=>n<2?reply([{action:'wait_until',until_minute:1440,reason:'Resting'}]):reply([{action:'wait_until',until_minute:2880,reason:'Resting again'}]));
 const cfg={...f.config,maxTurns:4,operationalConfig:op,worldConfig:config({schedulingMode:'event_driven'})};
 await f.controller.start(cfg);await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,4);
 const history=await f.logs.getConversationHistory(cfg.runId);assert.deepEqual(history.map(t=>t.simulationMinute),[0,15,1440,1455]);
 assert.ok((await f.logs.getEventHistory(cfg.runId)).some(e=>e.type==='world_checkpoint'&&e.simulationMinute===1440));
 await f.controller.wakeAgent('bob','Researcher','Next decision');const state=f.controller.getState().worldState;assert.equal(state.waits.bob,undefined);assert.equal((await f.logs.worldAt(cfg.runId)).waits.bob,undefined);
});

test('snapshot restoration and branches isolate inventories, clock and schedule execution histories',async t=>{
 const f=await fixture(t,()=>reply()),research=new ResearchService(f.controller,f.logs,f.storage),branches=new BranchService(f.controller,f.logs,research);
 await f.controller.start({...f.config,maxTurns:2,operationalConfig:op,worldConfig:config({events:[delivery()]}),protocol:{},llmConfig:{...f.config.llmConfig,modelVersion:'mock'}});await finish(f);
 const sourceHistory=hash(await f.logs.getConversationHistory(f.config.runId));
 const snapshot=await research.snapshot('world-point',f.config.runId,1,'Researcher','Fork world');assert.equal(snapshot.worldState.minute,30);assert.equal(snapshot.worldHash,hash(snapshot.worldState));
 await f.controller.stop();const branch=await branches.create({branchId:'world-branch',sourceSnapshotId:'world-point',actor:'Researcher',reason:'Isolation',maxTurns:2});
 assert.deepEqual(branch.snapshot.worldState,snapshot.worldState);await branches.start('world-branch');await finish(f);assert.equal(f.controller.getStatus(),'completed');
 assert.equal((await f.logs.worldAt('world-branch')).minute,60);assert.equal((await f.logs.worldAt(f.config.runId)).minute,30);assert.equal(hash(await f.logs.getConversationHistory(f.config.runId)),sourceHistory);assert.equal(hash(await f.logs.loadArtifact('snapshots','world-point')),hash(snapshot));
});

test('four-agent event-driven residence runs multiple days without concurrent inference or modifying unselected agents',async t=>{
 const ids=['bob','sara','walter','mckee','unselected'];
 const f=await fixture(t,()=>reply([{action:'wait_until',until_minute:4320,reason:'Wait for next activity'}]),ids);
 const unused=hash(await f.storage.loadWorkingState('unselected'));
 const residenceOp=resolveOperational({enabled:true,locations:[...op.locations,{id:'room2',name:'Second room'},{id:'room3',name:'Third room'}],observationPolicy:'co_located'});
 const participants=ids.slice(0,4),wc=w.resolveWorld({enabled:true,minutesPerTurn:1440,initialPositions:{bob:'store',sara:'room',walter:'room2',mckee:'room3'},events:[{id:'daily-bell',atMinute:1440,intervalMinutes:1440,occurrences:3,environmentKey:'bell',value:'rung',affectedAgentIds:participants,observation:'Daily bell',wake:true}]},participants,residenceOp);

 await f.controller.start({...f.config,agentIds:participants,maxTurns:3,operationalConfig:residenceOp,worldConfig:wc});await finish(f);
 assert.equal(f.controller.getStatus(),'completed');assert.equal(f.controller.getState().worldState.minute,4320);assert.equal(f.stats().maximum,1);assert.equal(hash(await f.storage.loadWorkingState('unselected')),unused);
});

test('initial-time events precede inference; explicit advancement and rejected events persist without replay',async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);return reply();});
 const cfg={...f.config,maxTurns:1,operationalConfig:op,worldConfig:config({events:[delivery({atMinute:0,occurrences:1}),delivery({id:'invalid-effect',atMinute:30,occurrences:1,quantityDelta:-100})]})};
 await f.controller.start(cfg);await finish(f);
 assert.equal(f.controller.getStatus(),'completed');assert.ok(requests[0].messages[0].content.includes('Food delivered'));
 assert.equal((await f.logs.worldAt(cfg.runId)).inventories[0].quantities.food,12);
 await f.controller.advanceTime(45,'Researcher','Skip idle period');const state=await f.logs.worldAt(cfg.runId);assert.equal(state.minute,45);assert.equal(state.inventories[0].quantities.food,12);assert.ok(state.executed.includes('invalid-effect:0'));
 const checkpoint=(await f.logs.getEventHistory(cfg.runId)).filter(e=>e.type==='world_checkpoint').at(-1);assert.equal(checkpoint.events.find(e=>e.occurrenceId==='invalid-effect:0').status,'rejected');
 await f.controller.stop();const restarted=f.createController();await restarted.start(cfg);assert.deepEqual(restarted.getState().worldState,state);
});

test('projection failure recovers the committed world and memory without retrying the transfer',async t=>{
 const f=await fixture(t,n=>reply(n===0?[take()]:[]));
 const original=f.logs.projectTurn.bind(f.logs);let fail=true;f.logs.projectTurn=async(...args)=>{if(fail){fail=false;throw Error('Injected disk projection failure');}return original(...args);};
 await f.controller.start({...f.config,maxTurns:2,operationalConfig:op,worldConfig:config()});await finish(f);assert.equal(f.controller.getStatus(),'paused');assert.equal(f.controller.getTurnIndex(),1);assert.equal(f.controller.getState().worldState.minute,15);
 await f.controller.resume();await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,2);assert.equal((await f.logs.worldAt(f.config.runId)).inventories[1].quantities.food,2);assert.equal((await f.logs.getEventHistory(f.config.runId)).filter(e=>e.id.endsWith(':operation:0')).length,1);
});

test('event-driven runs pause when no wake source remains and researcher wake resumes without filler turns',async t=>{
 const f=await fixture(t,n=>reply(n<2?[{action:'wait',reason:'Waiting for meaningful input'}]:[]));
 const cfg={...f.config,maxTurns:4,operationalConfig:op,worldConfig:config({schedulingMode:'event_driven'})};
 await f.controller.start(cfg);await finish(f);assert.equal(f.controller.getStatus(),'paused');assert.equal(f.stats().requests,2);assert.equal(f.controller.getTurnIndex(),2);assert.equal(f.controller.getState().worldState.minute,30);
 await f.controller.wakeAgent('bob','Researcher','Explicit decision');assert.equal(f.controller.getState().worldState.waits.bob,undefined);
 await Promise.all([f.controller.resume(),f.controller.resume()]);await finish(f);assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,4);assert.equal(f.stats().maximum,1);
 assert.deepEqual((await f.logs.getConversationHistory(cfg.runId)).map(turn=>turn.agentId),['bob','sara','bob','bob']);
});

for(const research of [false,true])for(const policy of ['local','global'])test(`${research?'research':'standard'} ${policy} prompts preserve authorized transcript boundaries on every turn`,async t=>{
 const requests=[],f=await fixture(t,(n,request)=>{requests.push(request);return reply([],n===0?'DISTANT_PRIVATE_MESSAGE':'A response');});
 await f.controller.start({...f.config,maxTurns:2,operationalConfig:op,worldConfig:config({communicationPolicy:policy,observationPolicy:'self_only'}),llmConfig:{...f.config.llmConfig,modelVersion:'mock'},...(research?{protocol:{}}:{})});await finish(f);assert.equal(f.controller.getStatus(),'completed');
 assert.equal(requests[1].messages[0].content.includes('DISTANT_PRIVATE_MESSAGE'),policy==='global');
 for(const request of requests){assert.ok(request.messages[0].content.includes('Authoritative world observations'));assert.ok(request.messages.at(-1).content.includes('world_operations'));assert.equal(request.response_format.type,'json_schema');}
 const turns=await f.logs.getConversationHistory(f.config.runId);assert.deepEqual(turns[0].messageRecipients,policy==='global'?['sara']:[]);
});

test('task decisions remain eligible while waiting and preserve reproducible participant rounds',()=>{
 const c=config({schedulingMode:'event_driven'}),s=w.initialWorld(c,agents);s.waits={bob:{},sara:{}};
 assert.equal(w.nextAgent(s,c,agents,1,true),'sara');assert.equal(w.nextAgent(s,c,agents,1,false),undefined);
});

test('an authorized colocated agent-to-agent transfer and deposit use atomic conservation',()=>{
 const c=config(),s=w.initialWorld(c,agents);s.positions.sara='store';s.inventories[1].quantities.food=3;s.inventories[2].authorizedAgentIds=['bob'];
 const transfer={...take(2),action:'transfer_item',source_inventory_id:'bob-bag',destination_inventory_id:'sara-bag'};
 const result=w.prepareWorld(s,c,'bob',[transfer],'store',agents,'transfer','',null);assert.equal(result.state.inventories[1].quantities.food,1);assert.equal(result.state.inventories[2].quantities.food,2);
 const deposit={...take(1),action:'deposit_item',source_inventory_id:'bob-bag',destination_inventory_id:'store-food'};
 const after=w.prepareWorld(result.state,c,'bob',[deposit],'store',agents,'deposit','',null);assert.equal(after.state.inventories[0].quantities.food,11);assert.equal(after.state.inventories[1].quantities.food,0);
});

test('the published four-room residence example has valid references and bounded event expansion',async()=>{
 const example=JSON.parse(await fs.readFile(require('node:path').join(__dirname,'../../examples/world-residence.json'),'utf8'));
 const cfg=w.resolveWorld(example.worldConfig,example.agentIds,resolveOperational(example.operationalConfig));assert.equal(new Set(Object.values(cfg.initialPositions)).size,4);assert.equal(w.schedule(cfg).length,14);
 const world=w.initialWorld(cfg,example.agentIds);assert.equal(w.worldContext(world,cfg,'bob').colocatedAgents.length,0);assert.ok(!w.worldContext(world,cfg,'bob').inventories.some(i=>i.id==='supply-food'));
});

test('restored state rejects incompatible inventory definitions and schedule history instead of repairing them',()=>{
 const c=config(),s=w.initialWorld(c,agents),locations=op.locations.map(l=>l.id);
 assert.doesNotThrow(()=>w.assertWorldCompatible(s,c,agents,locations));
 const wrong=structuredClone(s);wrong.inventories[0].ownerId='room';assert.throws(()=>w.assertWorldCompatible(wrong,c,agents,locations),/inventory/i);
 const unknown=structuredClone(s);unknown.executed=['invented:0'];assert.throws(()=>w.assertWorldCompatible(unknown,c,agents,locations),/schedule/);
 const negative=structuredClone(s);negative.inventories[0].quantities.food=-1;assert.throws(()=>w.assertWorldCompatible(negative,c,agents,locations),/quantities/);
});

test('historical research probes record world proposals and authorized context without applying effects',async t=>{
 const f=await fixture(t,n=>reply(n>=2?[take()]:[])),research=new ResearchService(f.controller,f.logs,f.storage);
 await f.controller.start({...f.config,maxTurns:2,operationalConfig:op,worldConfig:config(),protocol:{},llmConfig:{...f.config.llmConfig,modelVersion:'mock'}});await finish(f);
 const before=hash(await f.logs.worldAt(f.config.runId)),agentBefore=hash(await f.storage.loadWorkingState('bob'));
 await research.defineProbe('world-read-only',['What would you do next?']);const result=await research.probe(f.config.runId,'bob',1,'world-read-only','Researcher','Read-only world proposal');
 assert.equal(result.results[0].status,'success');assert.equal(result.results[0].worldPolicy,'read-only');assert.equal(result.results[0].response.world_operations[0].action,'take_item');assert.equal(result.results[0].worldObservation.locationId,'store');assert.equal(hash(await f.logs.worldAt(f.config.runId)),before);assert.equal(hash(await f.storage.loadWorkingState('bob')),agentBefore);
});
