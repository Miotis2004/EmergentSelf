const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {analyzeBundles}=require('../dist/analysis/analyze');
const {measure,calibration,similarity}=require('../dist/analysis/metrics');
const {METRICS,RUBRIC,STANDARD_BENCHMARK}=require('../dist/analysis/definitions');
const {hash}=require('../dist/research/protocol');
const {ResearchService}=require('../dist/research/ResearchService');
const {AnalysisService}=require('../dist/analysis/AnalysisService');
const {BenchmarkService}=require('../dist/analysis/BenchmarkService');
const {fixture,until}=require('./helpers.cjs');
const turn=(response,index,extra={})=>({eventId:`t-${index}`,agentId:index%2?'sara':'bob',turnIndex:index,response,parsedResponse:{response,memory_operations:[]},auditTrail:[],...extra});
function bundle(runId,turns,mode='enabled'){
 const config={runId,agentIds:['bob','sara'],maxTurns:100,memoryConfig:{mode,retrievalChars:1000},llmConfig:{model:'fixture',temperature:0},protocol:{condition:mode,initialStateHash:'same-state',systemPrompt:'same-prompt'}};
 return {runId,config,configHash:hash(config),turns,probes:[],events:[]};
}
const approximately=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('versioned measures have exact token, cue, question, revision and stability semantics',()=>{
 const entry=(type,content)=>({type,content,status:'active'});
 const record=turn('Maybe Sara, I disagree. We can explore galaxies?',0,{
  stream:'dialogue',parsedResponse:{memory_operations:[{action:'contradict',type:'belief'}]},
  auditTrail:[{operation:{action:'contradict',type:'belief'},status:'rejected'}],
  stateBefore:{entries:[entry('self_description','I like blue')]},stateAfter:{entries:[entry('self_description','I like green')]}
 });
 const {values,wordCount}=measure(record,['We explore distant stars and galaxies.'],['Sara']);
 assert.equal(wordCount,8);approximately(values.uncertainty_per_100_words,100/8);
 assert.equal(values.question_fraction,1);assert.equal(values.challenge_fraction,1);assert.equal(values.cooperation_fraction,1);
 assert.equal(values.participant_mention_fraction,1);assert.equal(values.belief_revision_proposal_fraction,1);assert.equal(values.accepted_belief_revision_fraction,0);
 assert.equal(values.self_description_similarity,.5);assert.equal(values.preference_similarity,.5);
 assert.equal(values.brier,null);assert.ok(values.topic_novelty>0);
 assert.equal(similarity([],[]),null);assert.equal(similarity([],['A']),0);
 const empty=measure({...turn('',0),stream:'dialogue'},[],['!!!']).values;
 assert.equal(empty.question_fraction,0);assert.equal(empty.topic_novelty,null);assert.equal(empty.uncertainty_per_100_words,null);assert.equal(empty.participant_mention_fraction,null);
 assert.equal(METRICS.length,Object.keys(values).length);assert.ok(METRICS.every(m=>m.definition&&m.version==='behavior-v1'));
});

test('calibration requires an explicit scored final response and never infers confidence from prose',()=>{
 const scoring={choices:['A','B'],expected:'B'};
 approximately(calibration('Answer: B; Confidence: 0.8',scoring).brier,.04);
 approximately(calibration('Answer: A; Confidence: 0.8',scoring).brier,.64);
 for(const response of ['Definitely B','Answer: B; Confidence: 2','Answer: C; Confidence: 0.8','Answer: B; Confidence: 0.8\nextra'])assert.equal(calibration(response,scoring).status,'unscorable');
 assert.equal(calibration('Definitely',null).status,'unavailable');
 assert.equal(measure({stream:'probe',response:{response:'Answer: B; Confidence: 0.8'},benchmark:{final:false,scoring}},[],[]).values.brier,null);
});

test('longitudinal windows retain failures, separate probes and report null instead of fabricated zeros',()=>{
 const b=bundle('one',[turn('Why?',0),turn('A statement.',1),turn('No question.',2)]);
 b.events=[{type:'experiment_error',agentId:'bob',turnIndex:2,timestamp:'a',message:'bad JSON'}];
 b.probes=[{id:'p',agentId:'bob',turnIndex:0,probeId:'fixed',probeSessionId:'session',probeTurn:0,status:'success',response:{response:'Question?',memory_operations:[]}}];
 const report=analyzeBundles([b],{windowSize:1});
 assert.equal(report.totals.successfulResponses,4);assert.equal(report.totals.failedAttempts,1);
 assert.equal(report.groups.length,2);assert.equal(report.groups.find(g=>g.stream==='probe').responses,1);
 const bob=report.units.find(u=>u.agentId==='bob'&&u.stream==='dialogue');
 assert.equal(bob.windows.length,3);assert.equal(bob.metrics.question_fraction.value,.5);
 assert.equal(bob.metrics.question_fraction.unavailable,1);assert.equal(bob.change.question_fraction,-1);
 assert.equal(bob.metrics.brier.value,null);assert.equal(bob.windows.find(w=>w.failures).metrics.question_fraction.value,null);
 assert.ok(report.observations.every(o=>o.source.runId&&o.source.recordId));
 assert.equal(report.observations.find(o=>o.source.stream==='probe').values.topic_novelty,null);
});

test('condition means weight agents then independent runs, with reproducible run bootstrap and explicit design strata',()=>{
 const a=bundle('a',[turn('?',0),turn('statement',1)]);
 const b=bundle('b',Array.from({length:20},(_,i)=>turn('statement',i)));
 const c=bundle('c',[turn('?',0)],'none');
 const report=analyzeBundles([a,b,c],{seed:17,bootstrapSamples:200});
 assert.deepEqual(report,analyzeBundles([a,b,c],{seed:17,bootstrapSamples:200}));
 const enabled=report.groups.find(g=>g.condition==='enabled');
 assert.equal(enabled.metrics.question_fraction.mean,.25);assert.equal(enabled.metrics.question_fraction.n,2);assert.equal(enabled.runCount,2);
 assert.deepEqual(enabled.metrics.question_fraction.ci95,[0,.5]);
 assert.equal(report.groups.find(g=>g.condition==='none').metrics.question_fraction.ci95,null);
 assert.equal(report.comparisons.length,1);assert.equal(report.comparisons[0].metrics.question_fraction.meanDifference,.75);
 const changed=bundle('changed',[turn('?',0)]);changed.config.llmConfig.model='other';changed.configHash=hash(changed.config);
 assert.equal(analyzeBundles([a,changed]).groups.length,2);
 const tampered=structuredClone(a);tampered.config.maxTurns=99;assert.throws(()=>analyzeBundles([tampered]),/hash mismatch/);
 const sealed={...a,integrityHash:hash(a)};assert.doesNotThrow(()=>analyzeBundles([sealed]));sealed.turns[0].response='tampered';assert.throws(()=>analyzeBundles([sealed]),/integrity/);
 assert.throws(()=>analyzeBundles([b,b]),/Duplicate run/);assert.throws(()=>analyzeBundles([b],{windowSize:0}),/Invalid analysis/);
});

async function setup(t,reply){
 const f=await fixture(t,reply??(()=>JSON.stringify({response:'Exact model text.\n  Kept.',memory_operations:[]})));
 const research=new ResearchService(f.controller,f.logs,f.storage);
 await f.storage.saveAgentMemory('bob',[{id:'selected',content:'SECRET-MEMORY-ZEBRA'}]);
 await research.template('analysis-template',{...f.config,maxTurns:2,llmConfig:{...f.config.llmConfig,model:'real-loaded-id',modelVersion:'fixture'}});
 const batch=await research.batch('analysis-batch','analysis-template',1,['enabled'],42);
 const runId=batch.trials[0].runId;await research.startTrial('analysis-batch',runId);await until(()=>f.controller.getStatus()==='completed');
 return {...f,research,runId,analysis:new AnalysisService(f.controller,f.logs,research),benchmarks:new BenchmarkService(f.controller,f.logs,research)};
}

test('benchmark arms use independent historical views, restore exact requests, keep all source state/history immutable and serialize inference',async t=>{
 const f=await setup(t);const history=hash(await f.logs.getConversationHistory(f.runId));
 const state=hash(await f.logs.trialStorage(f.runId).loadWorkingState('bob'));const global=hash(await f.storage.loadWorkingState('bob'));
 const definition=await f.benchmarks.define({benchmarkId:'test-v1',version:1,items:[{itemId:'score',dimension:'calibration',prompts:['Choose a letter'],scoring:{choices:['A','B'],expected:'B'}}]});
 await assert.rejects(f.benchmarks.define({benchmarkId:'test-v1',version:1,items:[{itemId:'score',dimension:'calibration',prompts:['Choose a letter'],scoring:{choices:['A','B'],expected:'B'}}]}),/already exists/);
 const result=await f.benchmarks.run({runId:f.runId,agentId:'bob',turnIndex:0,benchmarkId:'test-v1',entryIds:['selected'],randomizationSeed:3,actor:'Tester',reason:'Paired test'});
 assert.equal(result.outcomes.length,3);assert.ok(result.outcomes.every(o=>o.status==='success'));
 const exported=await f.research.exportRun(f.runId);const byArm=Object.fromEntries(exported.probes.map(p=>[p.benchmark.arm,p]));
 assert.ok(byArm.original.request.messages[0].content.includes('SECRET-MEMORY-ZEBRA'));
 assert.ok(!byArm.withheld.request.messages[0].content.includes('SECRET-MEMORY-ZEBRA'));
 assert.deepEqual(byArm.original.request,byArm.restored.request);
 assert.equal(byArm.original.sourceStateHash,byArm.withheld.sourceStateHash);assert.notEqual(byArm.original.stateHash,byArm.withheld.stateHash);
 assert.ok(!byArm.original.request.messages.at(-1).content.includes('expected'));
 assert.equal(byArm.original.benchmark.scoring.expected,'B');assert.equal(byArm.original.benchmark.final,true);
 assert.equal(exported.benchmarkDefinitions[0].benchmarkHash,definition.benchmarkHash);assert.equal(exported.benchmarkSessions.length,1);
 const report=await f.analysis.report([f.runId]);assert.equal(report.memoryDependence.length,1);
 assert.equal(report.memoryDependence[0].eligible,true);assert.equal(report.memoryDependence[0].originalRestoredRequestMatch,true);
 assert.equal(report.groups.find(g=>g.stream==='probe').calibration.unscorable,1);
 assert.equal(hash(await f.logs.getConversationHistory(f.runId)),history);assert.equal(hash(await f.logs.trialStorage(f.runId).loadWorkingState('bob')),state);assert.equal(hash(await f.storage.loadWorkingState('bob')),global);
 assert.equal(f.stats().maximum,1);
 await assert.rejects(f.benchmarks.run({runId:f.runId,agentId:'bob',turnIndex:0,benchmarkId:'test-v1',entryIds:['foreign'],actor:'Tester',reason:'Reject'}),/active memory/);
 await assert.rejects(f.research.probeInLease(f.runId,'bob',0,'x','Tester','Reject'),/lease/i);
});

test('failed benchmark items record failed and unrun turns and continue other planned items',async t=>{
 let fail=false;const f=await setup(t,()=>fail?'Invalid JSON':JSON.stringify({response:'Valid',memory_operations:[]}));
 await f.benchmarks.define({benchmarkId:'failure-v1',version:1,items:[{itemId:'two',dimension:'revision',prompts:['A','B']},{itemId:'one',dimension:'social',prompts:['C']}]});fail=true;
 const result=await f.benchmarks.run({runId:f.runId,agentId:'bob',turnIndex:0,benchmarkId:'failure-v1',actor:'Tester',reason:'Failure test'});
 assert.deepEqual(result.outcomes.map(o=>[o.status,o.attempts,o.successfulResponses,o.unrunProbeTurns]),[['failed',1,0,1],['failed',1,0,0]]);
 const report=await f.analysis.report([f.runId]);assert.equal(report.totals.failedAttempts,2);assert.equal(report.benchmarkOutcomes.length,2);
 assert.ok(report.groups.filter(g=>g.stream==='probe').every(g=>g.metrics.question_fraction.mean===null));
});

test('blinded datasets hide source metadata and answer keys, preserve wording, and immutably link ratings to exports',async t=>{
 const f=await setup(t);const original=await f.research.exportRun(f.runId);
 const view=await f.analysis.dataset({datasetId:'blind-v1',runIds:[f.runId],stream:'dialogue',sampleSize:10,seed:4});
 assert.equal(view.items.length,2);assert.equal(view.items[0].response,'Exact model text.\n  Kept.');
 assert.deepEqual(await f.analysis.publicDataset('blind-v1'),view);
 for(const key of ['assignments','sourceExports','sourceReportHash','condition','runId','expected'])assert.ok(!JSON.stringify(view).includes(`"${key}":`));
 assert.ok(!JSON.stringify(view).includes(f.runId));assert.ok(view.items.every(i=>/^[a-f0-9-]{36}$/.test(i.itemId)));
 const scores=Object.fromEntries(RUBRIC.dimensions.map(d=>[d.id,null]));scores.information_seeking=0;
 const rating={datasetId:'blind-v1',itemId:view.items[0].itemId,raterId:'Rater A',scores,tags:['cooperate'],justification:'Text offers to continue.'};
 const receipt=await f.analysis.rate(rating);assert.ok(!receipt.source);
 await assert.rejects(f.analysis.rate(rating),/EEXIST/);
 await assert.rejects(f.analysis.rate({...rating,raterId:'B',scores:{...scores,information_seeking:5}}),/0–4/);
 await assert.rejects(f.analysis.rate({...rating,raterId:'B',tags:['none','cooperate']}),/social tags/);
 const exported=await f.research.exportRun(f.runId);assert.equal(exported.evaluations.length,1);
 const report=analyzeBundles([exported]);assert.equal(report.totals.humanRatings,1);
 assert.equal(report.human.find(h=>h.dimension==='information_seeking').mean,0);
 assert.equal(report.human.find(h=>h.dimension==='tag_cooperate').mean,1);
 assert.ok(!report.human.some(h=>h.dimension==='revision_responsiveness'));
 assert.deepEqual(exported.turns,original.turns);assert.deepEqual(exported.config,original.config);
});

test('offline export CLI reproduces the report, writes CSV and never overwrites input or existing artifacts',async t=>{
 const f=await setup(t);const exported=await f.research.exportRun(f.runId);
 const input=path.join(f.root,'input.json'),output=path.join(f.root,'analysis.json'),csv=path.join(f.root,'metrics.csv');
 await fs.writeFile(input,JSON.stringify(exported));const before=await fs.readFile(input,'utf8');
 const cli=path.resolve(__dirname,'../scripts/analyze-exports.cjs');
 execFileSync(process.execPath,[cli,input,'--output',output,'--csv',csv,'--window','1','--seed','9','--bootstrap','100']);
 assert.deepEqual(JSON.parse(await fs.readFile(output,'utf8')),analyzeBundles([exported],{windowSize:1,seed:9,bootstrapSamples:100}));
 assert.ok((await fs.readFile(csv,'utf8')).includes('question_fraction'));assert.equal(await fs.readFile(input,'utf8'),before);
 assert.throws(()=>execFileSync(process.execPath,[cli,input,'--output',input],{stdio:'pipe'}));
 assert.throws(()=>execFileSync(process.execPath,[cli,input,'--output',output],{stdio:'pipe'}));
 assert.equal(await fs.readFile(input,'utf8'),before);
});

test('standard benchmark covers every planned behavioral domain with an explicit calibration key',()=>{
 assert.equal(STANDARD_BENCHMARK.items.length,9);assert.ok(STANDARD_BENCHMARK.items.some(i=>i.dimension==='contradiction'&&i.prompts.length===2));
 assert.equal(STANDARD_BENCHMARK.items.find(i=>i.scoring).scoring.expected,'B');
});

test('analysis HTTP routes enforce source validation and expose only the blinded public projection',async t=>{
 const f=await setup(t);const express=require('express'),http=require('node:http');
 const {createAnalysisRouter}=require('../dist/api/analysis');const app=express();app.use(express.json());app.use('/api/analysis',createAnalysisRouter(f.analysis,f.benchmarks));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/analysis`;
 const post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const defs=await (await fetch(base+'/definitions')).json();assert.equal(defs.metricVersion,'behavior-v1');assert.equal(defs.rubric.version,'human-v1');
 assert.equal((await post('/reports',{runIds:[]})).status,400);
 const report=await (await post('/reports',{runIds:[f.runId]})).json();assert.equal(report.totals.successfulResponses,2);
 const data=await (await post('/evaluation-datasets',{datasetId:'http-blind',runIds:[f.runId],stream:'dialogue',sampleSize:1})).json();assert.equal(data.items.length,1);assert.ok(!data.assignments);
 assert.deepEqual(await (await fetch(base+'/evaluation-datasets/http-blind')).json(),data);
 assert.equal((await fetch(base+'/evaluation-datasets/unknown')).status,404);
 assert.equal((await post('/evaluation-datasets',{datasetId:'http-blind',runIds:[f.runId],stream:'dialogue',sampleSize:1})).status,409);
 const score={datasetId:'http-blind',itemId:data.items[0].itemId,raterId:'R',scores:Object.fromEntries(RUBRIC.dimensions.map(d=>[d.id,null])),tags:null,justification:'Insufficient contextual evidence'};
 assert.equal((await post('/ratings',score)).status,200);assert.equal((await post('/ratings',score)).status,409);
});

test('benchmark lease blocks a resumed main loop until the entire session completes',async t=>{
 let release;let gate=null;const f=await setup(t,async()=>{if(gate)await gate;return JSON.stringify({response:'Kept exact',memory_operations:[]});});
 await f.benchmarks.define({benchmarkId:'lease-v1',version:1,items:[{itemId:'two',dimension:'social',prompts:['A','B']}]});
 // Start a separate main run and pause while its first request is in flight.
 gate=new Promise(r=>release=r);
 await f.controller.start({...f.config,runId:'paused-main',maxTurns:3});
 await until(()=>f.stats().requests===3);const pause=f.controller.pause();gate=null;release();await pause;
 const before=f.stats().requests;
 gate=new Promise(r=>release=r);
 const probing=f.benchmarks.run({runId:f.runId,agentId:'bob',turnIndex:0,benchmarkId:'lease-v1',actor:'Tester',reason:'Serialize with resume'});
 await until(()=>f.stats().requests===before+1);const resuming=f.controller.resume();
 assert.equal(f.controller.getStatus(),'paused');gate=null;release();
 await probing;await resuming;await until(()=>f.controller.getStatus()==='completed');
 assert.equal(f.stats().maximum,1);assert.equal(f.stats().requests,before+4);
});

test('memory dependence is unavailable when the withheld entries were outside original retrieval budgets',async t=>{
 const f=await setup(t);
 await f.research.template('zero-retrieval',{...f.config,maxTurns:1,memoryConfig:{retrievalEntries:0,retrievalChars:0,summaryChars:0},llmConfig:{...f.config.llmConfig,model:'real-loaded-id',modelVersion:'fixture'}});
 const batch=await f.research.batch('zero-batch','zero-retrieval',1,['enabled'],1);const runId=batch.trials[0].runId;
 await f.research.startTrial('zero-batch',runId);await until(()=>f.controller.getStatus()==='completed');
 await f.benchmarks.define({benchmarkId:'exposure-v1',version:1,items:[{itemId:'memory',dimension:'memory',prompts:['Recall something']} ]});
 await f.benchmarks.run({runId,agentId:'bob',turnIndex:0,benchmarkId:'exposure-v1',entryIds:['selected'],actor:'Tester',reason:'Exposure eligibility'});
 const report=await f.analysis.report([runId]);assert.equal(report.memoryDependence[0].eligible,false);assert.equal(report.memoryDependence[0].withheldSimilarity,null);
});


test('older exports need no new fields and human ratings cannot be attached to a different response',()=>{
 const b=bundle('old',[turn('Exact original',0)]);delete b.config.protocol;b.configHash=hash(b.config);
 const report=analyzeBundles([b]);assert.equal(report.sources[0].legacy,true);assert.equal(report.totals.successfulResponses,1);
 b.evaluations=[{ratingId:'bad',source:{runId:'old',stream:'dialogue',recordId:'t-0',responseHash:hash('Different response')}}];
 assert.throws(()=>analyzeBundles([b]),/source response mismatch/);
});

test('incomplete memory sessions retain null planned pairs when all multi-turn probes fail early',async t=>{
 let fail=false;const f=await setup(t,()=>fail?'Invalid':JSON.stringify({response:'Exact',memory_operations:[]}));
 await f.benchmarks.define({benchmarkId:'incomplete',version:1,items:[{itemId:'revision',dimension:'revision',prompts:['First','Second']}]});fail=true;
 await f.benchmarks.run({runId:f.runId,agentId:'bob',turnIndex:0,benchmarkId:'incomplete',entryIds:['selected'],actor:'Tester',reason:'Retain missing final replies'});
 const report=await f.analysis.report([f.runId]);assert.equal(report.memoryDependence.length,1);
 assert.equal(report.memoryDependence[0].complete,false);assert.equal(report.memoryDependence[0].eligible,null);assert.equal(report.memoryDependence[0].withheldSimilarity,null);
 assert.equal(report.benchmarkOutcomes.reduce((n,o)=>n+o.unrunProbeTurns,0),3);
});


test('repeated probe timelines follow historical source turns rather than random session UUIDs or administration order',()=>{
 const b=bundle('longitudinal',[]);
 b.probes=[
  {id:'later',agentId:'bob',turnIndex:20,probeId:'fixed',probeSessionId:'a',probeTurn:0,timestamp:'2026-01-01',status:'success',response:{response:'Statement',memory_operations:[]}},
  {id:'earlier',agentId:'bob',turnIndex:0,probeId:'fixed',probeSessionId:'z',probeTurn:0,timestamp:'2026-01-02',status:'success',response:{response:'Question?',memory_operations:[]}}
 ];
 const report=analyzeBundles([b],{windowSize:1});assert.deepEqual(report.units[0].windows.map(w=>w.firstSourceTurn),[0,20]);assert.equal(report.units[0].change.question_fraction,-1);
});
