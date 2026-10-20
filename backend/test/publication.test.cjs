const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {fixture,until}=require('./helpers.cjs');
const {ResearchService}=require('../dist/research/ResearchService');
const {StudyService}=require('../dist/publication/StudyService');
const {normalizeStudy,verifyStudy}=require('../dist/publication/protocol');
const {syntheticExample}=require('../dist/publication/example');
const {synthesizeStudy,contrastInterval}=require('../dist/publication/synthesis');
const {buildPublication,verifyPublication}=require('../dist/publication/package');
const {captureCode}=require('../dist/publication/provenance');
const {hash}=require('../dist/research/protocol');
const reply=n=>JSON.stringify({response:n%2?'Consider the evidence.':'Could you explain?',memory_operations:[]});
const input=(runIds,extra={})=>({...syntheticExample().study.protocol,studyId:'planned-study',registrationType:'prospective',plannedRunIds:runIds,...extra});
async function setup(t){
 const f=await fixture(t,reply),research=new ResearchService(f.controller,f.logs,f.storage);
 await f.storage.saveAgentMemory('bob',[{id:'secret',content:'PERSONAL-MEMORY-SENTINEL'}]);
 await research.template('publication-template',{...f.config,maxTurns:2,llmConfig:{...f.config.llmConfig,model:'real-loaded-id',modelVersion:'fixture'}});
 const batch=await research.batch('publication-batch','publication-template',2,['none','enabled'],42);
 return {...f,research,batch,studies:new StudyService(f.controller,f.logs,research)};
}
async function run(f,trial){await f.research.startTrial(f.batch.batchId,trial.runId);await until(()=>['completed','paused'].includes(f.controller.getStatus()));}

test('prospective study freezes known plans before any inference; missing trials and zero outcomes stay visible',async t=>{
 const f=await setup(t),ids=f.batch.trials.map(t=>t.runId);const study=await f.studies.register(input(ids));
 assert.equal(f.stats().requests,0);assert.equal(study.plans.length,4);assert.ok(study.evidence.every(e=>e.turns===0));assert.equal(verifyStudy(study).registrationHash,study.registrationHash);
 await assert.rejects(f.studies.register(input(ids)),/EEXIST/);
 let report=await f.studies.report('planned-study');assert.equal(report.totals.missing,4);assert.equal(report.primary.contrasts[0].estimate,null);assert.equal(report.primary.contrasts[0].status,'unavailable');
 for(const trial of f.batch.trials)await run(f,trial);
 report=await f.studies.report('planned-study');assert.equal(report.totals.missing,0);assert.equal(report.primary.contrasts[0].estimate,0);assert.equal(report.primary.contrasts[0].status,'observed_zero');assert.deepEqual(report.primary.contrasts[0].ci95,[0,0]);
 assert.ok(report.primary.contrasts[0].evidence.every(e=>e.source.runId&&e.source.recordId));assert.equal(f.stats().maximum,1);
});

test('observed data require retrospective registration, and malformed hypotheses/exclusions cannot be silently accepted',async t=>{
 const f=await setup(t);await run(f,f.batch.trials[0]);const ids=f.batch.trials.map(t=>t.runId);
 await assert.rejects(f.studies.register(input(ids)),/retrospective/);
 const retrospective=await f.studies.register(input(ids,{registrationType:'retrospective'}));assert.equal(retrospective.protocol.registrationType,'retrospective');
 assert.throws(()=>normalizeStudy(input(ids,{hypotheses:[{...input(ids).hypotheses[0],metric:'invented-trait'}]})),/registered/);
 assert.throws(()=>normalizeStudy(input(ids,{analysis:{...input(ids).analysis,excludeRuns:[{runId:ids[0],reason:''}]}})),/rationale/);
 assert.throws(()=>normalizeStudy({...input(ids),unexpected:true}),/Unknown/);
 await assert.rejects(f.studies.register(input(['not-prepared'],{studyId:'unknown'})),/Prepare/);
});

test('independent-run difference intervals, evidence, nulls and prespecified sensitivity reproduce exactly',()=>{
 assert.deepEqual(contrastInterval([0,0],[1,1],100,7),{estimate:1,ci95:[1,1]});assert.equal(contrastInterval([0],[1],100,7).ci95,null);
 const {study,bundles,synthesis}=syntheticExample();assert.deepEqual(synthesis,synthesizeStudy(study,bundles));
 const contrast=synthesis.primary.contrasts[0];assert.equal(contrast.estimate,.5);assert.equal(contrast.left.length,2);assert.equal(contrast.right.length,2);assert.equal(contrast.status,'direction_and_threshold_met');
 assert.deepEqual(contrast.ci95,[1/3,2/3]);assert.equal(synthesis.sensitivity.length,3);assert.ok(contrast.evidence.some(e=>e.status==='failed'&&e.value===null));
 const missing=synthesizeStudy(study,bundles.slice(0,1));assert.equal(missing.totals.missing,3);assert.equal(missing.primary.contrasts[0].estimate,null);
 const tampered=structuredClone(study);tampered.protocol.title='Altered';assert.throws(()=>synthesizeStudy(tampered,bundles),/registration hash/);
});

test('exclusions retain the full trial ledger and all-observed sensitivity; changed configs split designs and record deviations',()=>{
 const {study,bundles}=syntheticExample();const copy=structuredClone(study);copy.protocol.analysis.excludeRuns=[{runId:bundles[2].runId,reason:'Prespecified eligibility example'}];delete copy.registrationHash;copy.registrationHash=hash(copy);
 const report=synthesizeStudy(copy,bundles);assert.equal(report.totals.excluded,1);assert.equal(report.primary.contrasts[0].right.length,1);assert.equal(report.primary.contrasts[0].ci95,null);
 assert.equal(report.sensitivity.find(s=>s.kind==='all_planned_observed').contrasts[0].right.length,2);assert.equal(report.ledger.length,4);
 const changed=structuredClone(bundles);changed[2].config.llmConfig.model='other-model';changed[2].configHash=hash(changed[2].config);delete changed[2].integrityHash;changed[2].integrityHash=hash(changed[2]);
 const deviation=synthesizeStudy(study,changed);assert.equal(deviation.totals.deviations,1);assert.equal(deviation.primary.contrasts.length,2);assert.ok(deviation.primary.contrasts.some(c=>c.status==='unavailable'));
});

test('private packages preserve exact raw evidence and code and reproduce; aggregate allowlist omits identifying free text and cannot claim raw reproduction',async t=>{
 const f=await setup(t),ids=f.batch.trials.map(t=>t.runId);await f.studies.register(input(ids,{title:'SENSITIVE-TITLE-SENTINEL'}));for(const trial of f.batch.trials)await run(f,trial);
 const before=await f.research.exportRun(ids[0]);
 const receipt=await f.studies.publish('planned-study',{publicationId:'private-one',profile:'private'}),bundle=await f.studies.publication(receipt.publicationId);
 assert.equal(bundle.exports.length,4);assert.ok(bundle.exports.some(b=>b.baseline.states.bob.entries.some(e=>e.content==='PERSONAL-MEMORY-SENTINEL')));assert.ok(bundle.code['backend/src/publication/synthesis.ts']);
 assert.equal(verifyPublication(bundle,true,(await captureCode()).codeHash).recomputed,true);
 await f.studies.publish('planned-study',{publicationId:'aggregate-one',profile:'aggregate'});const aggregate=await f.studies.publication('aggregate-one');const serialized=JSON.stringify(aggregate);
 for(const marker of ['PERSONAL-MEMORY-SENTINEL','SENSITIVE-TITLE-SENTINEL','publication-batch','real-loaded-id',f.config.llmConfig.baseUrl])assert.ok(!serialized.includes(marker),marker);
 assert.ok(!aggregate.exports&&!aggregate.study&&!aggregate.code&&!aggregate.analysis);assert.equal(aggregate.publicSummary.trials.length,4);assert.equal(verifyPublication(aggregate).valid,true);
 assert.throws(()=>verifyPublication(aggregate,true),/cannot reproduce/);
 const altered=structuredClone(bundle);altered.synthesis.totals.planned=99;assert.throws(()=>verifyPublication(altered),/integrity/);
 const wrongCode=structuredClone(bundle);wrongCode.code['backend/src/publication/synthesis.ts']+='\n';delete wrongCode.bundleHash;wrongCode.bundleHash=hash(wrongCode);assert.throws(()=>verifyPublication(wrongCode),/source digest/);
 assert.throws(()=>verifyPublication(bundle,true,'wrong-code'),/differs/);
 await assert.rejects(f.studies.publish('planned-study',{publicationId:'private-one',profile:'private'}),/EEXIST/);
 assert.deepEqual(await f.research.exportRun(ids[0]),before);
});

test('offline CLI builds and verifies private/aggregate artifacts without altering sources or overwriting existing output',async t=>{
 const f=await setup(t),{study,bundles}=syntheticExample();const studyFile=path.join(f.root,'study.json');await fs.writeFile(studyFile,JSON.stringify(study));
 const inputs=[];for(const bundle of bundles){const file=path.join(f.root,bundle.runId+'.json');await fs.writeFile(file,JSON.stringify(bundle));inputs.push(file);}
 const output=path.join(f.root,'private.json'),cli=path.resolve(__dirname,'../scripts/synthesize-study.cjs'),verify=path.resolve(__dirname,'../scripts/verify-publication.cjs');
 execFileSync(process.execPath,[cli,'--study',studyFile,'--output',output,'--profile','private',...inputs],{stdio:'pipe'});
 const result=JSON.parse(execFileSync(process.execPath,[verify,output,'--recompute'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.equal(result.recomputed,true);
 const extracted=path.join(f.root,'archived-source');
 execFileSync(process.execPath,[verify,output,'--extract-code',extracted],{stdio:'pipe'});
 await fs.symlink(path.resolve(__dirname,'../node_modules'),path.join(extracted,'backend/node_modules'),'dir');
 execFileSync(process.execPath,[path.resolve(__dirname,'../node_modules/typescript/bin/tsc'),'-p',path.join(extracted,'backend/tsconfig.json')],{stdio:'pipe'});
 const rebuilt=JSON.parse(execFileSync(process.execPath,[path.join(extracted,'backend/scripts/verify-publication.cjs'),output,'--recompute'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.equal(rebuilt.recomputed,true);
 assert.throws(()=>execFileSync(process.execPath,[verify,output,'--extract-code',extracted],{stdio:'pipe'}));
 assert.throws(()=>execFileSync(process.execPath,[cli,'--study',studyFile,'--output',output,'--profile','private',...inputs],{stdio:'pipe'}));
 assert.throws(()=>execFileSync(process.execPath,[cli,'--study',studyFile,'--output',studyFile,'--profile','private',...inputs],{stdio:'pipe'}));assert.deepEqual(JSON.parse(await fs.readFile(studyFile,'utf8')),study);
 execFileSync(process.execPath,[path.resolve(__dirname,'../scripts/generate-publication-example.cjs'),'--check'],{stdio:'pipe',env:{...process.env,LLM_MAX_TOKENS:'4096',LLM_OUTPUT_MODE:'json_only'}});
});

test('study HTTP routes preserve immutable protocols and return explicit missing-run synthesis',async t=>{
 const f=await setup(t),express=require('express'),http=require('node:http'),{createStudiesRouter}=require('../dist/api/studies');
 const app=express();app.use(express.json());app.use('/api/studies',createStudiesRouter(f.studies));const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/studies`,post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const protocol=input(f.batch.trials.map(t=>t.runId));assert.equal((await post('',protocol)).status,200);assert.equal((await post('',protocol)).status,409);
 assert.equal((await fetch(base+'/missing')).status,404);assert.equal((await (await post('/planned-study/report',{})).json()).totals.missing,4);
 assert.equal((await post('/planned-study/publications',{publicationId:'http-aggregate',profile:'aggregate'})).status,200);
 const data=await (await fetch(base+'/publications/http-aggregate')).json();assert.equal(data.profile,'aggregate');assert.equal(data.publicSummary.totals.missing,4);
 const defs=await (await fetch(base+'/defaults')).json();assert.ok(defs.validity.threats.some(t=>t.id==='seed_limits'));
});

test('documented local replication command registers before sequential inference against the real application APIs',async t=>{
 const f=await fixture(t,(n,request)=>JSON.stringify({...JSON.parse(reply(n)),decision:{mode:'communicate',reason:'Respond',goal:null},communication:{scope:'global',recipientAgentIds:[]}})),research=new ResearchService(f.controller,f.logs,f.storage),studies=new StudyService(f.controller,f.logs,research);
 const express=require('express'),http=require('node:http'),{createStudiesRouter}=require('../dist/api/studies'),{createAgentsRouter}=require('../dist/api/agents'),{createResearchRouter}=require('../dist/api/research'),{createExperimentRouter}=require('../dist/api/experiment');
 const app=express();app.use(express.json());app.use('/api/studies',createStudiesRouter(studies));app.use('/api/agents',createAgentsRouter(f.storage));app.use('/api/research',createResearchRouter(research));app.use('/api/experiment',createExperimentRouter(f.controller,f.logs));
 app.get('/api/llm/config',(req,res)=>res.json({baseUrl:f.config.llmConfig.baseUrl,maxTokens:2048,outputMode:'json_schema'}));app.get('/api/llm/models',(req,res)=>res.json([{id:'real-loaded-id'}]));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 let firstRegistrationTurns=null;const start=research.startTrial.bind(research);research.startTrial=async(...args)=>{if(firstRegistrationTurns===null){const registered=await studies.get('replication');firstRegistrationTurns=registered.evidence.reduce((n,e)=>n+e.turns,0);}return start(...args);};
 const result=await promisify(execFile)(process.execPath,[path.resolve(__dirname,'../scripts/replicate-study.cjs'),'--study-id','replication','--model-version','fixture','--repeats','2','--turns','2','--api',`http://127.0.0.1:${server.address().port}`,'--execute']);
 assert.ok(result.stdout.includes('Completed 4 trials'));assert.equal(firstRegistrationTurns,0);assert.equal(f.stats().maximum,1);assert.equal(f.stats().requests,8);
 const report=await studies.report('replication');assert.equal(report.totals.missing,0);assert.equal(report.totals.deviations,0);
});
