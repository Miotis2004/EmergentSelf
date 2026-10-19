const {test}=require('node:test');
const assert=require('node:assert/strict');
const w=require('../dist/world/simulation');
const tr=require('../dist/world/transformations');
const {resolveOperational}=require('../dist/operations/state');
const {classifyFailure}=require('../dist/recovery/recovery');
const {validateAgentTurn,inferenceResponseSchema}=require('../dist/llm/agentTurnSchema');
const {fixture,until}=require('./helpers.cjs');
const residence=require('../../examples/transformations-residence.json');
const repair=require('../../examples/transformations-repair.json');
const clone=structuredClone;
function setup(input=residence){const raw=clone(input),agents=Object.keys(raw.initialPositions),locations=[...new Set([...Object.values(raw.initialPositions),'outside'])];const operational=resolveOperational({enabled:true,locations:locations.map(id=>({id,name:id}))});const config=w.resolveWorld(raw,agents,operational);let state=w.initialWorld(config,agents),n=0;return {config,agents,operational,get state(){return state;},set state(v){state=v;},go(agent,ops=[],location=state.positions[agent],speech=''){const result=w.prepareWorld(state,config,agent,ops,location,agents,'turn:'+n++,speech,null);state=result.state;return result;},jump(minute){const result=w.advanceWorld(state,config,minute,agents,'jump:'+n++);state=result.state;return result;}};}
const op=(action,fields={})=>({action,...fields,reason:'Deterministic test'});
const propose=(recipe,task='breakfast',workspace='kitchen-work')=>op('propose_transformation',{transformation_id:recipe,task_id:task,workspace_id:workspace});
const contribute=(item,role='input',inventory='pantry',task='breakfast',quantity=1)=>op('contribute_transformation',{task_id:task,inventory_id:inventory,item_id:item,quantity,role});
const action=(name,task='breakfast')=>op(name,{task_id:task});
const quantity=(s,inv,item)=>s.inventories.find(i=>i.id===inv).quantities[item]??0;
function light(f){return f.go('helena',[propose('light-stove','light'),contribute('match','input','pantry','light'),contribute('stove','tool','pantry','light'),action('start_transformation','light')]);}
function breakfast(f){light(f);f.go('helena',[propose('prepare-oatmeal'),contribute('oats'),contribute('pot','tool'),contribute('stove','catalyst')]);f.go('clara',[action('join_transformation'),contribute('water'),action('start_transformation')]);}
function code(fn,expected){assert.throws(fn,e=>{assert.equal(e.code,expected);assert.equal(classifyFailure(e).retry,'correct');return true;});}

test('residence breakfast: verified light/cook/distribute/consume, exact quantities and reusable equipment',()=>{
 const f=setup();breakfast(f);let t=f.state.transformations.tasks.find(t=>t.id==='breakfast');assert.equal(t.status,'in_progress');assert.equal(quantity(f.state,'pantry','match'),1);assert.equal(quantity(f.state,'pantry','oats'),1);assert.equal(quantity(f.state,'counter','oatmeal'),0);
 assert.equal(w.nextWakeMinute(f.state,f.config),t.completionMinute);f.jump(t.completionMinute);
 assert.equal(quantity(f.state,'counter','oatmeal'),4);assert.equal(quantity(f.state,'pantry','oats'),0);assert.equal(quantity(f.state,'pantry','water'),0);assert.equal(quantity(f.state,'pantry','pot'),1);assert.equal(quantity(f.state,'pantry','stove'),1);assert.equal(f.state.transformations.itemProperties.stove.lit,true);
 for(const agent of f.agents)f.go(agent,[op('take_item',{source_inventory_id:'counter',destination_inventory_id:agent+'-bag',item_id:'oatmeal',quantity:2}),op('consume_item',{inventory_id:agent+'-bag',item_id:'oatmeal',quantity:1})]);
 assert.equal(quantity(f.state,'counter','oatmeal'),0);assert.equal(quantity(f.state,'helena-bag','oatmeal'),1);assert.equal(quantity(f.state,'clara-bag','oatmeal'),1);
 const ledger=f.state.transformations.ledger;assert.equal(ledger.filter(e=>e.type==='transformation_output_produced')[0].quantity,4);assert.ok(ledger.some(e=>e.type==='item_consumed'&&e.agentId==='clara'&&e.operation.action==='consume_item'));assert.equal(ledger.find(e=>e.type==='item_consumed'&&e.agentId==='clara').lots[0].producerTaskId,'breakfast');assert.ok(ledger.find(e=>e.type==='transformation_output_produced').lot.parents.includes('initial:pantry:oats'));assert.ok(f.state.observations.some(e=>e.kind==='transformation_completed'&&e.data.taskId==='breakfast'));
 w.assertWorldCompatible(f.state,f.config,f.agents,f.operational.locations.map(l=>l.id));
});

test('generic water repair preserves valve identity and records typed property/environment changes',()=>{
 const f=setup(repair);f.go('marcus',[propose('repair-valve','repair','maintenance-work'),contribute('seal','input','supplies','repair'),contribute('repair-kit','tool','supplies','repair'),contribute('valve','target','supplies','repair')]);
 f.go('gideon',[action('join_transformation','repair'),action('start_transformation','repair')]);const deadline=f.state.transformations.tasks[0].completionMinute;f.jump(deadline+200);
 assert.equal(f.state.environment['water-system'],'repaired');assert.equal(f.state.transformations.itemProperties.valve.condition,'repaired');assert.equal(quantity(f.state,'supplies','valve'),1);assert.equal(quantity(f.state,'supplies','repair-kit'),1);assert.equal(quantity(f.state,'supplies','seal'),0);assert.ok(f.state.transformations.ledger.some(e=>e.type==='transformation_item_modified'&&e.itemId==='valve'));
});

test('speech alone never cooks, repairs, consumes or learns recipes',()=>{const f=setup();const before=clone(f.state.inventories);f.go('helena',[],undefined,'I cooked breakfast and ate four servings.');assert.deepEqual(f.state.inventories,before);assert.equal(f.state.transformations.tasks.length,0);});

test('missing inputs and participants are rejected atomically with actionable recovery code',()=>{
 const f=setup();f.go('helena',[propose('prepare-oatmeal')]);const before=clone(f.state);code(()=>f.go('helena',[action('start_transformation')]),'MISSING_REQUIRED_INPUT');assert.deepEqual(f.state,before);
});

test('private resource owners must voluntarily contribute; remote workspaces reject access',()=>{
 const raw=clone(residence);raw.inventories[0].quantities.oats=0;raw.inventories[2].quantities.oats=1;const f=setup(raw);f.go('helena',[propose('prepare-oatmeal')]);code(()=>f.go('helena',[contribute('oats','input','clara-bag')]),'UNAUTHORIZED_RESOURCE_ACCESS');code(()=>f.go('helena',[contribute('water')],'outside'),'WRONG_LOCATION');
 f.go('clara',[action('join_transformation'),contribute('oats','input','clara-bag')]);assert.equal(f.state.transformations.tasks[0].contributions[0].agentId,'clara');
});

test('reservations exclude competing tasks, transfers and consumption; cancellation returns unused stock',()=>{
 const f=setup();f.go('helena',[propose('light-stove','a'),contribute('stove','tool','pantry','a')]);f.go('clara',[propose('light-stove','b')]);code(()=>f.go('clara',[contribute('stove','tool','pantry','b')]),'RESOURCE_ALREADY_RESERVED');
 code(()=>f.go('helena',[op('take_item',{source_inventory_id:'pantry',destination_inventory_id:'helena-bag',item_id:'stove',quantity:1})]),'RESOURCE_ALREADY_RESERVED');code(()=>f.go('clara',[action('cancel_transformation','a')]),'UNAUTHORIZED_RESOURCE_ACCESS');
 f.go('helena',[action('cancel_transformation','a')]);f.go('clara',[contribute('stove','tool','pantry','b')]);assert.equal(quantity(f.state,'pantry','stove'),1);
});

test('start consumption is not restored by cancellation or timed failure',()=>{
 const raw=clone(residence);raw.transformations.recipes[0].consumption='start';raw.transformations.recipes[0].durationMinutes=20;const f=setup(raw);light(f);assert.equal(quantity(f.state,'pantry','match'),1);f.go('helena',[action('cancel_transformation','light')]);assert.equal(quantity(f.state,'pantry','match'),1);assert.equal(tr.reserved(f.state,'pantry','stove'),0);assert.equal(f.state.environment['stove-lit'],'false');
 const g=setup(raw);light(g);g.go('helena',[],'outside');g.jump(50);assert.equal(g.state.transformations.tasks[0].status,'failed');assert.equal(quantity(g.state,'pantry','match'),1);assert.equal(g.state.environment['stove-lit'],'false');
});

test('scheduled environment changes interleave with deadlines across clock jumps; replay creates no outputs/audits twice',()=>{
 const raw=clone(residence);raw.events=[{id:'power',atMinute:10,occurrences:1,environmentKey:'stove-lit',value:'false',affectedAgentIds:['helena','clara'],observation:'Stove went out',wake:true}];const f=setup(raw);breakfast(f);f.jump(100);assert.equal(f.state.transformations.tasks.find(t=>t.id==='breakfast').status,'failed');assert.equal(quantity(f.state,'counter','oatmeal'),0);assert.equal(quantity(f.state,'pantry','oats'),1);
 const g=setup();breakfast(g);g.jump(100);const ledger=clone(g.state.transformations.ledger);g.jump(1000);assert.deepEqual(g.state.transformations.ledger,ledger);assert.equal(quantity(g.state,'counter','oatmeal'),4);
});

test('clock event tie completes tasks before equal-minute configured events deterministically',()=>{const raw=clone(residence);raw.transformations.recipes[0].durationMinutes=10;raw.events=[{id:'change',atMinute:10,occurrences:1,environmentKey:'stove-lit',value:'false',affectedAgentIds:[],observation:'Off',wake:false}];const f=setup(raw);light(f);f.jump(10);assert.equal(f.state.transformations.tasks[0].status,'completed');assert.equal(f.state.environment['stove-lit'],'false');});

test('discovery and verified teaching are explicit; plain narrative does not grant recipe knowledge',()=>{
 const raw=clone(residence);raw.transformations.knowledgePolicy='verified';raw.transformations.initialKnowledge={helena:['light-stove']};const f=setup(raw);code(()=>f.go('clara',[op('inspect_transformation',{transformation_id:'light-stove'})]),'TRANSFORMATION_NOT_FOUND');f.go('helena',[],undefined,'Clara, light-stove is how you light it.');assert.deepEqual(f.state.transformations.knowledge.clara,[]);f.go('helena',[op('teach_transformation',{transformation_id:'light-stove',recipient_id:'clara'})]);assert.deepEqual(f.state.transformations.knowledge.clara,['light-stove']);
 raw.transformations.knowledgePolicy='discover';raw.transformations.initialKnowledge={};const g=setup(raw);g.go('helena',[op('discover_transformations')]);assert.equal(g.state.transformations.knowledge.helena.length,2);
});

test('configuration rejects invalid quantities, references, tool overlaps, typed properties and workspace permissions',()=>{
 const mutations=[r=>r.transformations.recipes[0].inputs[0].quantity=0,r=>r.transformations.recipes[0].requiredTools[0].itemId='invented',r=>r.transformations.recipes[0].requiredTools.push({itemId:'match',quantity:1}),r=>r.transformations.recipes[0].itemChanges.stove.lit='true',r=>r.transformations.workspaces[0].authorizedAgentIds=['stranger'],r=>r.transformations.recipes[0].requiredLocation='nowhere',r=>r.transformations.recipes[0].requiredEnvironment={'undefined-key':'true'},r=>r.transformations.recipes[0].outputs=[{itemId:'stove',quantity:2}]];
 for(const change of mutations){const raw=clone(residence);change(raw);assert.throws(()=>setup(raw));}
});

test('invalid contribution amount/role and entire multi-operation proposal roll back',()=>{const f=setup();const before=clone(f.state);assert.throws(()=>f.go('helena',[propose('light-stove'),contribute('match','input','pantry','breakfast',100)]));assert.deepEqual(f.state,before);assert.throws(()=>f.go('helena',[{...propose('light-stove'),invented:true}]));assert.deepEqual(f.state,before);});

test('completed task cannot restart or duplicate output; concurrent independent tasks retain deterministic ordering',()=>{
 const f=setup();light(f);code(()=>f.go('helena',[action('start_transformation','light')]),'TASK_ALREADY_COMPLETED');
 const raw=clone(residence);raw.transformations.recipes[0].durationMinutes=20;raw.transformations.recipes[0].requiredTools=[];raw.transformations.recipes[0].itemChanges={};const g=setup(raw);
 g.go('helena',[propose('light-stove','a'),contribute('match','input','pantry','a'),action('start_transformation','a')]);g.go('clara',[propose('light-stove','b'),contribute('match','input','pantry','b'),action('start_transformation','b')]);g.jump(100);assert.deepEqual(g.state.transformations.tasks.map(t=>t.status),['completed','completed']);assert.equal(quantity(g.state,'pantry','match'),0);
});

test('new operations use existing strict agent-turn schema; inference projection has no large bounded repetitions',()=>{
 for(const [social,task] of [[false,false],[true,false],[true,true]]){const value={response:'',memory_operations:[],operational_operations:[],world_operations:[propose('light-stove')],...(social?{social:{action:'decline',recipient_id:null}}:{})};assert.doesNotThrow(()=>validateAgentTurn(value,social,task,true,true));const schema=JSON.stringify(inferenceResponseSchema(social,task,true,true));assert.ok(schema.includes('start_transformation'));assert.ok(!schema.includes('maxLength'));assert.throws(()=>validateAgentTurn({...value,world_operations:[contribute('match','input','pantry','breakfast',0)]},social,task,true,true));}
});

test('restored state validates reservations and deadlines without modifying persisted data',()=>{const f=setup();breakfast(f);const serialized=JSON.stringify(f.state),restored=JSON.parse(serialized);w.assertWorldCompatible(restored,f.config,f.agents,f.operational.locations.map(l=>l.id));assert.equal(JSON.stringify(restored),serialized);f.state=restored;f.jump(100);assert.equal(quantity(f.state,'counter','oatmeal'),4);const bad=clone(restored);bad.transformations.tasks.find(t=>t.id==='breakfast').completionMinute++;assert.throws(()=>w.assertWorldCompatible(bad,f.config,f.agents,f.operational.locations.map(l=>l.id)));});

// Full controller/log integration proves the extension rides canonical commits and corrective retries.
function controllerConfig(f){const raw=clone(residence);raw.initialPositions={bob:'kitchen',sara:'kitchen'};raw.inventories=raw.inventories.map(i=>({...i,id:i.id.replace('helena','bob').replace('clara','sara'),ownerId:i.ownerId.replace('helena','bob').replace('clara','sara')}));raw.transformations.workspaces[0].authorizedAgentIds=['bob','sara'];return {...f.config,maxTurns:3,operationalConfig:resolveOperational({enabled:true,locations:[{id:'kitchen',name:'Kitchen'}]}),worldConfig:raw,recoveryConfig:{enabled:true,initialBackoffMs:10,maxBackoffMs:20,persistentConnectivityRecovery:false}};}
const response=ops=>JSON.stringify({response:'',memory_operations:[],operational_operations:[],world_operations:ops});
test('corrective retry records original failed task proposal and commits once; restart preserves canonical world',async t=>{
 const f=await fixture(t,n=>n===0?response([propose('light-stove'),contribute('stove','tool'),action('start_transformation')]):n===1?response([propose('light-stove'),contribute('match'),contribute('stove','tool'),action('start_transformation')]):response([]));const cfg=controllerConfig(f);await f.controller.start(cfg);await until(()=>['completed','paused'].includes(f.controller.getStatus()));assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().maximum,1);assert.equal(f.stats().requests,4);
 const state=await f.logs.worldAt(cfg.runId);assert.equal(quantity(state,'pantry','match'),1);assert.equal(state.transformations.tasks.length,1);const events=await f.logs.getEventHistory(cfg.runId);assert.ok(events.some(e=>e.type==='recovery_attempt'&&JSON.stringify(e).includes('MISSING_REQUIRED_INPUT')));assert.equal((await f.logs.getConversationHistory(cfg.runId)).length,3);
 await f.controller.stop();const restarted=f.createController();await restarted.start(cfg);assert.deepEqual((await f.logs.worldAt(cfg.runId)).transformations,state.transformations);assert.equal(f.stats().requests,4);
});

test('scheduled removal cannot steal reservations and reusable private tools cannot be consumed or carried away',()=>{
 const raw=clone(residence);raw.events=[{id:'remove',atMinute:5,occurrences:1,inventoryId:'pantry',itemId:'pot',quantityDelta:-1,affectedAgentIds:[],observation:'Remove pot',wake:false}];const f=setup(raw);breakfast(f);const result=f.jump(6);assert.equal(quantity(f.state,'pantry','pot'),1);assert.equal(result.events.find(e=>e.type==='world_scheduled_event').status,'rejected');f.jump(100);assert.equal(quantity(f.state,'counter','oatmeal'),4);
 const g=setup();g.go('helena',[op('take_item',{source_inventory_id:'pantry',destination_inventory_id:'helena-bag',item_id:'pot',quantity:1})]);light(g);g.go('helena',[propose('prepare-oatmeal'),contribute('oats'),contribute('pot','tool','helena-bag'),contribute('stove','catalyst')]);g.go('clara',[action('join_transformation'),contribute('water'),action('start_transformation')]);g.go('helena',[],'outside');g.go('helena',[],'kitchen');assert.equal(g.state.transformations.tasks.find(t=>t.id==='breakfast').status,'failed');assert.equal(quantity(g.state,'pantry','oats'),1);assert.equal(quantity(g.state,'helena-bag','pot'),1);
});

test('workspace authorization applies to normal inventory transfers as well as task operations',()=>{const raw=clone(residence);raw.transformations.workspaces[0].authorizedAgentIds=['helena'];raw.inventories.find(i=>i.id==='counter').quantities.oatmeal=1;const f=setup(raw);code(()=>f.go('clara',[op('take_item',{source_inventory_id:'counter',destination_inventory_id:'clara-bag',item_id:'oatmeal',quantity:1})]),'UNAUTHORIZED_RESOURCE_ACCESS');});

test('consumable reserved inputs cannot be eaten before task completion',()=>{const raw=clone(residence);raw.items.find(i=>i.id==='match').consumable=true;raw.inventories[0].quantities.match=0;raw.inventories[1].quantities.match=1;const f=setup(raw);f.go('helena',[propose('light-stove','light'),contribute('match','input','helena-bag','light')]);code(()=>f.go('helena',[op('consume_item',{inventory_id:'helena-bag',item_id:'match',quantity:1})]),'RESOURCE_ALREADY_RESERVED');});

test('active timed tasks survive pause/restart and isolated branches; source snapshot and historical bytes stay unchanged',async t=>{
 const {ResearchService}=require('../dist/research/ResearchService'),{BranchService}=require('../dist/branches/BranchService'),{hash}=require('../dist/research/protocol');
 const f=await fixture(t,n=>n===0?response([propose('light-stove','light'),contribute('match','input','pantry','light'),contribute('stove','tool','pantry','light'),action('start_transformation','light')]):response([])),cfg=controllerConfig(f);cfg.maxTurns=1;cfg.worldConfig.transformations.recipes[0].durationMinutes=20;cfg.protocol={};cfg.llmConfig={...cfg.llmConfig,modelVersion:'mock'};
 await f.controller.start(cfg);await until(()=>['completed','paused'].includes(f.controller.getStatus()));assert.equal(f.controller.getStatus(),'completed');assert.equal((await f.logs.worldAt(cfg.runId)).transformations.tasks[0].status,'in_progress');
 const research=new ResearchService(f.controller,f.logs,f.storage),branches=new BranchService(f.controller,f.logs,research),snapshot=await research.snapshot('task-point',cfg.runId,0,'Researcher','Task checkpoint'),history=await f.logs.getConversationHistory(cfg.runId),sourceHash=hash(history);
 await f.controller.stop();const restarted=f.createController();await restarted.start(await f.logs.loadConfig(cfg.runId));assert.equal(restarted.getState().worldState.transformations.tasks[0].completionMinute,20);await restarted.stop();
 const branch=await branches.create({branchId:'task-branch',sourceSnapshotId:'task-point',actor:'Researcher',reason:'Isolation',maxTurns:1});assert.deepEqual(branch.snapshot.worldState.transformations,snapshot.worldState.transformations);await branches.start('task-branch');await until(()=>['completed','paused'].includes(f.controller.getStatus()));await f.controller.advanceTime(30,'Researcher','Complete branch work');
 assert.equal((await f.logs.worldAt('task-branch')).transformations.tasks[0].status,'completed');assert.equal((await f.logs.worldAt(cfg.runId)).transformations.tasks[0].status,'in_progress');assert.equal(hash(await f.logs.getConversationHistory(cfg.runId)),sourceHash);assert.equal(hash(await f.logs.loadArtifact('snapshots','task-point')),hash(snapshot));
});

test('event-driven all-waiting agents advance to a pending task completion without filler inference',async t=>{
 const f=await fixture(t,n=>n===0?response([propose('light-stove','light'),contribute('match','input','pantry','light'),contribute('stove','tool','pantry','light'),action('start_transformation','light'),op('wait')]):n===1?response([op('wait')]):response([]));const cfg=controllerConfig(f);cfg.worldConfig.transformations.recipes[0].durationMinutes=20;await f.controller.start(cfg);await until(()=>['completed','paused'].includes(f.controller.getStatus()));assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().requests,3);assert.equal(f.stats().maximum,1);const turns=await f.logs.getConversationHistory(cfg.runId);assert.deepEqual(turns.map(t=>t.simulationMinute),[0,1,20]);assert.equal((await f.logs.worldAt(cfg.runId)).transformations.tasks[0].status,'completed');
});

test('partial consumption policy consumes only start-phase ingredients, preserves the rest on interruption',()=>{
 const raw=clone(residence);raw.transformations.recipes[1].inputs[0].consumeAt='start';const f=setup(raw);breakfast(f);assert.equal(quantity(f.state,'pantry','oats'),0);assert.equal(quantity(f.state,'pantry','water'),1);f.go('helena',[],'outside');assert.equal(f.state.transformations.tasks.find(t=>t.id==='breakfast').status,'failed');assert.equal(quantity(f.state,'pantry','oats'),0);assert.equal(quantity(f.state,'pantry','water'),1);assert.equal(quantity(f.state,'counter','oatmeal'),0);w.assertWorldCompatible(f.state,f.config,f.agents,f.operational.locations.map(l=>l.id));
});
