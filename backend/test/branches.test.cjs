const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {fixture,until}=require('./helpers.cjs');
const {ResearchService}=require('../dist/research/ResearchService');
const {BranchService}=require('../dist/branches/BranchService');
const {analyzeBundles}=require('../dist/analysis/analyze');
const {hash}=require('../dist/research/protocol');
const reply=n=>JSON.stringify({response:`Original model text ${n}\n  Exact.`,memory_operations:[]});
async function setup(t,respond=reply){
 const f=await fixture(t,respond),research=new ResearchService(f.controller,f.logs,f.storage);
 await f.storage.saveAgentMemory('bob',[{id:'b-one',content:'BOB-MEMORY'},{id:'b-two',content:'SECOND-MEMORY'}]);
 await f.storage.saveAgentMemory('sara',[{id:'s-one',content:'SARA-MEMORY'}]);
 await research.template('source',{...f.config,maxTurns:2,llmConfig:{...f.config.llmConfig,model:'real-loaded-id',modelVersion:'fixture-v1'}});
 const batch=await research.batch('batch','source',1,['enabled'],1);const sourceRun=batch.trials[0].runId;
 await research.startTrial('batch',sourceRun);await until(()=>f.controller.getStatus()==='completed');
 await research.snapshot('source-point',sourceRun,1,'Researcher','Source checkpoint');
 return {...f,research,sourceRun,branches:new BranchService(f.controller,f.logs,research)};
}
const create=(f,branchId,operations=[],extra={})=>f.branches.create({branchId,sourceSnapshotId:'source-point',operations,actor:'Researcher',reason:'Prespecified identity-continuity intervention',maxTurns:2,...extra});
async function finish(f){await until(()=>['completed','paused'].includes(f.controller.getStatus()));}

test('branches clone full participant state, inherited conversation and immutable model/config lineage',async t=>{
 const f=await setup(t);const sourceBefore=hash(await f.logs.getConversationHistory(f.sourceRun));
 const branch=await create(f,'control');assert.equal(branch.source.snapshotId,'source-point');assert.equal(branch.configuration.protocol.stateScope,'trial');
 assert.equal(branch.snapshot.context.length,2);assert.equal(branch.preSnapshot.stateHash,branch.snapshot.stateHash);
 assert.equal(branch.configuration.llmConfig.modelVersion,'fixture-v1');assert.deepEqual(branch.configuration.agentIds,['bob','sara']);
 await f.branches.start('control');await finish(f);assert.equal(f.controller.getStatus(),'completed');
 const turns=await f.logs.getConversationHistory('control');assert.equal(turns.length,2);assert.equal(turns[0].turnIndex,0);
 assert.ok(turns[0].prompt.system.includes('Original model text 0'));assert.ok(turns[0].prompt.system.includes('Original model text 1'));
 assert.equal(turns[0].configHash,branch.configHash);assert.equal(turns[0].response,'Original model text 2\n  Exact.');
 assert.equal(hash(await f.logs.getConversationHistory(f.sourceRun)),sourceBefore);assert.equal(f.stats().maximum,1);
 const exported=await f.research.exportRun('control');assert.equal(exported.branch.manifestHash,branch.manifestHash);assert.equal(exported.interventions.filter(e=>e.action==='branch_created').length,1);
 await assert.rejects(create(f,'control'),/already exists/);
});

test('withholding and selective restoration preserve original entry content, metadata and order',async t=>{
 const f=await setup(t);const withheld=await create(f,'withheld',[{kind:'withhold',agentId:'bob',entryIds:['b-one']}]);
 assert.deepEqual(withheld.snapshot.states.bob.entries.map(e=>e.id),['b-two']);
 const restored=await create(f,'restored',[{kind:'restore',agentId:'bob',fromBranchId:'withheld',operationIndex:0,entryIds:['b-one']}],{sourceSnapshotId:undefined,sourceBranchId:'withheld'});
 assert.deepEqual(restored.snapshot.states,withheld.preSnapshot.states);assert.equal(restored.source.parentBranchId,'withheld');
 await assert.rejects(create(f,'bad-restore',[{kind:'restore',agentId:'bob',fromBranchId:'withheld',operationIndex:0,entryIds:['b-one']}]),/overwrite/);
 await f.branches.start('withheld');await finish(f);const turns=await f.logs.getConversationHistory('withheld');
 assert.ok(!turns[0].prompt.system.includes('BOB-MEMORY'));assert.ok(turns[0].prompt.system.includes('SECOND-MEMORY'));
 assert.ok((await f.storage.loadWorkingState('bob')).entries.some(e=>e.content==='BOB-MEMORY'));
});

test('transplants and swaps carry donor evidence, avoid ID collisions and reverse exactly in a new baseline branch',async t=>{
 const f=await setup(t);
 const transplant=await create(f,'transplant',[{kind:'transplant',agentId:'sara',donorSnapshotId:'source-point',donorAgentId:'bob',entryIds:['b-one']}]);
 const imported=transplant.snapshot.states.sara.entries.find(e=>e.content==='BOB-MEMORY');assert.notEqual(imported.id,'b-one');assert.equal(imported.interventionProvenance[0].donorAgentId,'bob');
 assert.equal(transplant.snapshot.states.bob.entries.length,2);
 const swapped=await create(f,'swapped',[{kind:'swap',agentId:'bob',otherAgentId:'sara',entryIds:['b-one'],otherEntryIds:['s-one']}]);
 assert.ok(swapped.snapshot.states.bob.entries.some(e=>e.content==='SARA-MEMORY'));assert.ok(swapped.snapshot.states.sara.entries.some(e=>e.content==='BOB-MEMORY'));
 const reverse=await create(f,'undo-swap',[{kind:'reverse',fromBranchId:'swapped',operationIndex:0}],{sourceSnapshotId:undefined,sourceBranchId:'swapped'});
 assert.deepEqual(reverse.snapshot.states,swapped.preSnapshot.states);
 await assert.rejects(create(f,'diverged',[{kind:'attributes',agentId:'bob',values:{curiosity:9}},{kind:'reverse',fromBranchId:'swapped',operationIndex:0}],{sourceSnapshotId:undefined,sourceBranchId:'swapped'}),/diverged/);
});

test('attribute and history interventions are independent and preserve immutable initial stats',async t=>{
 const f=await setup(t);
 const attributes=await create(f,'attribute',[{kind:'attributes',agentId:'bob',values:{curiosity:9}}]);
 assert.equal(attributes.snapshot.states.bob.identity.stats.curiosity.initial,2);assert.equal(attributes.snapshot.states.bob.identity.stats.curiosity.current,9);
 assert.deepEqual(attributes.snapshot.context,attributes.preSnapshot.context);assert.deepEqual(attributes.snapshot.states.bob.entries,attributes.preSnapshot.states.bob.entries);
 const clear=await create(f,'history',[{kind:'history',mode:'clear'}]);assert.equal(clear.snapshot.context.length,0);assert.deepEqual(clear.snapshot.states,clear.preSnapshot.states);
 const reverse=await create(f,'restore-history',[{kind:'reverse',fromBranchId:'history',operationIndex:0}],{sourceSnapshotId:undefined,sourceBranchId:'history'});assert.deepEqual(reverse.snapshot.context,clear.preSnapshot.context);
 await f.branches.start('attribute');await finish(f);const turns=await f.logs.getConversationHistory('attribute');assert.ok(turns[0].prompt.system.includes('curiosity: 9'));assert.ok(turns[0].prompt.system.includes('Original model text 0'));
 await assert.rejects(create(f,'bad-stat',[{kind:'attributes',agentId:'bob',values:{unknown:5}}]),/existing stat/);
 await assert.rejects(create(f,'bad-range',[{kind:'attributes',agentId:'bob',values:{curiosity:11}}]),/0–10/);
});

test('branch state/logs evolve separately and restart never reinitializes state or repeats a committed turn',async t=>{
 let adding=false;const f=await setup(t,n=>JSON.stringify({response:`Actual ${n}`,memory_operations:adding?[{action:'add',type:'self_description',content:'A model-reported self-description',reason:'Observed'}]:[]}));
 const a=await create(f,'a'),b=await create(f,'b');const original=hash(await f.storage.loadWorkingState('bob'));adding=true;
 await f.branches.start('a');await finish(f);const after=hash(await f.logs.trialStorage('a').loadWorkingState('bob'));
 await f.branches.prepare('b');assert.equal(hash(await f.logs.trialStorage('b').loadWorkingState('bob')),hash(b.snapshot.states.bob));
 assert.equal((await f.logs.getConversationHistory('b')).length,0);assert.equal(hash(await f.storage.loadWorkingState('bob')),original);
 const calls=f.stats().requests;const restarted=f.createController();await restarted.start(a.configuration);assert.equal(restarted.getStatus(),'completed');assert.equal(f.stats().requests,calls);
 assert.equal(hash(await f.logs.trialStorage('a').loadWorkingState('bob')),after);
 assert.equal((await f.research.exportRun('a')).branch.source.snapshotId,'source-point');
});

test('model/version changes are explicit and immutable, with no inherited stale version for a changed endpoint',async t=>{
 const f=await setup(t);const branch=await create(f,'new-model',[],{llmConfig:{modelVersion:'fixture-v2',temperature:.1}});
 assert.equal(branch.configuration.llmConfig.modelVersion,'fixture-v2');assert.equal(branch.sourceConfiguration.llmConfig.modelVersion,'fixture-v1');assert.ok(branch.configurationDifferences.some(d=>d.path==='llmConfig.modelVersion'));
 await assert.rejects(create(f,'unknown-model',[],{llmConfig:{model:'not-loaded',modelVersion:'new'}}),/not loaded/);
 await assert.rejects(create(f,'stale-version',[],{llmConfig:{baseUrl:'http://127.0.0.1:9/v1'}}),/explicit model version/);
 await f.branches.prepare('new-model');await assert.rejects(f.controller.start({...branch.configuration,llmConfig:{...branch.configuration.llmConfig,modelVersion:'altered'}}),/exact saved configuration/);
});

test('paired probes are sequential read-only branch records with pre/post phases, context and exact model policy',async t=>{
 const f=await setup(t);await f.research.defineProbe('identity-probe',['What do you remember?','How do you describe yourself?']);
 const branch=await create(f,'probe-branch',[{kind:'withhold',agentId:'bob',entryIds:['b-one']},{kind:'history',mode:'clear'}],{llmConfig:{modelVersion:'fixture-v2'}});
 const source=hash(await f.logs.getConversationHistory(f.sourceRun));
 const pair=await f.branches.probePair('probe-branch',{agentId:'bob',probeId:'identity-probe',postTurnIndex:-1,modelPolicy:'same_branch',contextPolicy:'phase_history',actor:'R',reason:'Matched comparison'});
 assert.ok(pair.outcomes.every(o=>o.status==='success'));assert.deepEqual(pair.manifest.modelDifferences,[]);
 const probes=await f.logs.readResearch('probe-branch','probes');assert.equal(probes.length,4);
 const pre=probes.find(p=>p.comparison.phase==='pre'),post=probes.find(p=>p.comparison.phase==='post');
 assert.ok(pre.prompt.system.includes('BOB-MEMORY'));assert.ok(!post.prompt.system.includes('BOB-MEMORY'));
 assert.ok(pre.prompt.system.includes('Original model text 0'));assert.ok(!post.prompt.system.includes('Original model text 0'));
 assert.equal(pre.llmConfig.modelVersion,'fixture-v2');assert.equal(post.llmConfig.modelVersion,'fixture-v2');
 assert.equal((await f.logs.getConversationHistory('probe-branch')).length,0);assert.equal(hash(await f.logs.getConversationHistory(f.sourceRun)),source);
 assert.equal(hash(await f.logs.trialStorage('probe-branch').loadWorkingState('bob')),hash(branch.snapshot.states.bob));assert.equal(f.stats().maximum,1);
 const exported=await f.research.exportRun('probe-branch');const report=analyzeBundles([exported]);assert.equal(report.continuity.runs.length,1);assert.equal(report.continuity.runs[0].comparisons[0].rows.length,2);
 assert.equal(report.groups.length,4);assert.ok(report.observations.every(o=>o.source.stream==='probe'));
 const other=await f.branches.probePair('probe-branch',{agentId:'bob',probeId:'identity-probe',postTurnIndex:-1,modelPolicy:'source_vs_branch',actor:'R',reason:'Model comparison'});assert.ok(other.manifest.modelDifferences.some(d=>d.path==='modelVersion'));
});

test('paired-probe failures keep unrun items and incomplete/null comparisons',async t=>{
 let fail=false;const f=await setup(t,n=>fail?'Invalid':reply(n));await f.research.defineProbe('failed-probe',['One','Two']);await create(f,'failed-pair');fail=true;
 const pair=await f.branches.probePair('failed-pair',{agentId:'bob',probeId:'failed-probe',postTurnIndex:-1,modelPolicy:'same_branch',actor:'R',reason:'Failure outcome'});
 assert.deepEqual(pair.outcomes.map(o=>[o.status,o.attempts,o.unrunTurns]),[['failed',1,1],['failed',1,1]]);
 const report=analyzeBundles([await f.research.exportRun('failed-pair')]);const rows=report.continuity.runs[0].comparisons[0].rows;
 assert.equal(rows.length,2);assert.equal(rows[0].responseSimilarity,null);assert.equal(rows[1].preStatus,'unrun');assert.equal(report.totals.failedAttempts,2);
});

test('materialization recovers partial writes and never overwrites manifests, source files or configs',async t=>{
 const f=await setup(t);const branch=await create(f,'recover');
 const save=f.logs.trialStorage.bind(f.logs);let shouldFail=true;
 f.logs.trialStorage=runId=>{const storage=save(runId),write=storage.saveWorkingState.bind(storage);storage.saveWorkingState=async(agentId,state)=>{if(runId==='recover'&&shouldFail){shouldFail=false;throw Error('Injected materialization failure');}return write(agentId,state);};return storage;};
 await assert.rejects(f.branches.prepare('recover'),/Injected/);await f.branches.prepare('recover');await f.branches.prepare('recover');
 assert.equal((await f.logs.readResearch('recover','interventions')).filter(e=>e.action==='branch_created').length,1);
 assert.equal(hash(await f.logs.loadConfig('recover')),branch.configHash);
 const file=path.join(f.root,'research/branches/recover.json');const data=JSON.parse(await fs.readFile(file,'utf8'));data.snapshot.states.bob.identity.name='Tampered';await fs.writeFile(file,JSON.stringify(data));
 await assert.rejects(f.branches.prepare('recover'),/manifest hash/);
});

test('replacement histories require matching participants; invalid operations create no branch artifact',async t=>{
 const f=await setup(t);await f.research.snapshot('early',f.sourceRun,0,'R','Earlier checkpoint');
 const branch=await create(f,'replace',[{kind:'history',mode:'replace',donorSnapshotId:'early'}]);assert.equal(branch.snapshot.context.length,1);assert.deepEqual(branch.snapshot.states,branch.preSnapshot.states);
 await assert.rejects(create(f,'invalid',[{kind:'withhold',agentId:'sara',entryIds:['b-one']}]),/does not belong/);
 await assert.rejects(create(f,'invalid',[{kind:'withhold',agentId:'bob',entryIds:['b-one'],unexpected:true}]),/Unknown/);
 await assert.rejects(create(f,'invalid',null),/20 interventions/);
 assert.ok(!(await f.logs.listArtifacts('branches')).includes('invalid'));
});

test('branch HTTP routes expose immutable lineage, preparation and exact saved start semantics',async t=>{
 const f=await setup(t),express=require('express'),http=require('node:http'),{createBranchesRouter}=require('../dist/api/branches');
 const app=express();app.use(express.json());app.use('/api/branches',createBranchesRouter(f.branches));const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/branches`;
 const post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const request={branchId:'http-branch',sourceSnapshotId:'source-point',operations:[],actor:'R',reason:'HTTP workflow',maxTurns:2};
 assert.equal((await post('',request)).status,200);assert.equal((await post('',request)).status,409);
 assert.equal((await fetch(base+'/unknown')).status,404);assert.ok((await (await fetch(base+'/catalog')).json()).branches.includes('http-branch'));
 const branch=await (await fetch(base+'/http-branch')).json();assert.equal(branch.source.snapshotId,'source-point');
 assert.equal((await post('/http-branch/prepare',{})).status,200);assert.equal((await post('/http-branch/start',{})).status,200);await finish(f);
 assert.equal((await f.logs.getConversationHistory('http-branch')).length,2);
});

test('relationship transplants require explicit valid remapping and retain original wording',async t=>{
 const f=await setup(t),source=await f.logs.loadArtifact('snapshots','source-point');
 source.snapshotId='relationship-donor';source.states.bob.entries.push({...source.states.bob.entries[0],id:'relation',type:'relationship',relationship_agent_id:'sara',content:'Exact belief about Sara'});source.stateHash=hash(source.states);
 await f.logs.saveArtifact('snapshots','relationship-donor',source);
 const op={kind:'transplant',agentId:'sara',donorSnapshotId:'relationship-donor',donorAgentId:'bob',entryIds:['relation']};
 await assert.rejects(create(f,'bad-relation',[op]),/subject mapping/);
 const branch=await create(f,'mapped-relation',[{...op,relationshipMap:{sara:'bob'}}]);
 const entry=branch.snapshot.states.sara.entries.find(e=>e.type==='relationship');assert.equal(entry.relationship_agent_id,'bob');assert.equal(entry.content,'Exact belief about Sara');
});

test('branch inherited context tampering is rejected, including a recomputed local context hash',async t=>{
 const f=await setup(t),branch=await create(f,'context-integrity');await f.branches.prepare('context-integrity');
 const file=path.join(f.root,'research/snapshots',branch.snapshot.snapshotId+'.json');const snapshot=JSON.parse(await fs.readFile(file,'utf8'));snapshot.context[0].response='Altered';snapshot.contextHash=hash(snapshot.context);await fs.writeFile(file,JSON.stringify(snapshot));
 await assert.rejects(f.controller.start(branch.configuration),/snapshot differs/);
});

test('branch probes and resumed runs share one inference lease and preserve the inherited prefix once',async t=>{
 let gate=null,release;const f=await setup(t,async n=>{if(gate)await gate;return reply(n);});await f.research.defineProbe('lease-probe',['One','Two']);const branch=await create(f,'lease-branch',[],{maxTurns:4});
 gate=new Promise(r=>release=r);await f.branches.start('lease-branch');await until(()=>f.stats().requests===3);const pause=f.controller.pause();gate=null;release();await pause;
 gate=new Promise(r=>release=r);const pair=f.branches.probePair('lease-branch',{agentId:'bob',probeId:'lease-probe',postTurnIndex:0,modelPolicy:'same_branch',actor:'R',reason:'Serialized'});await until(()=>f.stats().requests===4);
 const resume=f.controller.resume();assert.equal(f.controller.getStatus(),'paused');gate=null;release();await pair;await resume;await finish(f);
 const turns=await f.logs.getConversationHistory('lease-branch');assert.equal(turns.length,4);assert.equal(turns[0].response,'Original model text 2\n  Exact.');assert.equal(f.stats().maximum,1);
 const snapshot=await f.research.snapshot('later-branch','lease-branch',3,'R','Evolved branch');assert.equal(snapshot.context.length,6);
 const child=await f.branches.create({branchId:'child-evolved',sourceSnapshotId:'later-branch',operations:[],actor:'R',reason:'Continued lineage'});assert.equal(child.source.parentBranchId,'lease-branch');assert.equal(child.snapshot.context.length,6);assert.equal(hash(child.snapshot.states),hash(snapshot.states));
});

test('missing branch working state is reconstructed from committed evolution rather than reset to baseline',async t=>{
 let evolve=false;const f=await setup(t,n=>JSON.stringify({response:`Kept ${n}`,memory_operations:evolve?[{action:'add',type:'self_description',content:'Evolved self-description',reason:'Observed'}]:[]}));await create(f,'missing-state');evolve=true;
 await f.branches.start('missing-state');await finish(f);const store=f.logs.trialStorage('missing-state'),before=hash(await store.loadWorkingState('bob'));
 await fs.unlink(path.join(f.root,'research/experiments/missing-state/working-state/agents/bob/state.json'));const calls=f.stats().requests;
 await f.branches.prepare('missing-state');assert.equal(hash(await store.loadWorkingState('bob')),before);assert.equal(f.stats().requests,calls);
});

test('source research export stays byte-equivalent through creation, intervention, branch probes and execution',async t=>{
 const f=await setup(t);const before=await f.research.exportRun(f.sourceRun);
 await f.research.defineProbe('source-integrity-probe',['A fixed question']);await create(f,'source-integrity',[{kind:'withhold',agentId:'bob',entryIds:['b-one']}]);
 await f.branches.probePair('source-integrity',{agentId:'bob',probeId:'source-integrity-probe',postTurnIndex:-1,modelPolicy:'same_branch',actor:'R',reason:'Integrity'});
 await f.branches.start('source-integrity');await finish(f);
 assert.deepEqual(await f.research.exportRun(f.sourceRun),before);
});

test('immutable artifacts publish whole documents without replacement and clean temporary files on conflicts',async t=>{
 const f=await setup(t);await create(f,'atomic');const before=await f.branches.get('atomic');
 await assert.rejects(f.logs.saveArtifact('branches','atomic',{replacement:true}),/EEXIST/);assert.deepEqual(await f.branches.get('atomic'),before);
 const files=await fs.readdir(path.join(f.root,'research/branches'));assert.ok(files.every(name=>!name.endsWith('.tmp')));
});
