const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {fixture,until}=require('./helpers.cjs');
const {resolveEnvironment,validateDecision,settleRound,visibleFeedback}=require('../dist/social/environment');
const {FeedbackService}=require('../dist/social/FeedbackService');
const {ResearchService}=require('../dist/research/ResearchService');
const {analyzeBundles}=require('../dist/analysis/analyze');
const {hash}=require('../dist/research/protocol');
const social=(text='Unchanged text',recipient=null,amount)=>({response:text,memory_operations:[],social:{action:'speak',recipient_id:recipient},...(amount===undefined?{}:{task_decision:{amount}})});
const decline=()=>({response:'',memory_operations:[],social:{action:'decline',recipient_id:null}});
const config=(f,extra={})=>({...f.config,maxTurns:6,socialConfig:{enabled:true},taskConfig:{kind:'public_goods'},...extra});
async function done(f){await until(()=>['completed','paused'].includes(f.controller.getStatus()));}

test('environment validates frozen controls and explicit social/task decisions without rewriting text',()=>{
 assert.equal(resolveEnvironment({}).feedbackConfig.enabled,false);
 for(const input of [{socialConfig:{enabled:1}},{taskConfig:{kind:'public_goods'}},{feedbackConfig:{enabled:true,source:'task'}},{feedbackConfig:{delayTurns:0}},{feedbackConfig:{negativeScore:1}},{feedbackConfig:{visibility:'secret'}}])assert.throws(()=>resolveEnvironment(input));
 const c={agentIds:['bob','sara','c'],socialConfig:{enabled:true},taskConfig:{kind:'public_goods'}};
 assert.doesNotThrow(()=>validateDecision(social('  Exact\nText.','sara',5),c,'bob'));
 assert.doesNotThrow(()=>validateDecision(decline(),c,'bob'));
 for(const r of [social('x','bob',1),social('x','outsider',1),social('x',null,11),social('x',null,1.5),social('x'),{...decline(),response:'Invented speech'},{...decline(),task_decision:{amount:0}}])assert.throws(()=>validateDecision(r,c,'bob'));
 assert.throws(()=>validateDecision(social(),{agentIds:['bob','sara']},'bob'),/disabled/);
});

test('three participants address, abstain and keep relationship beliefs private; unchecked agents never change',async t=>{
 const requests=[];const f=await fixture(t,(n,p)=>{requests.push(p);const r=n%3===1?decline():social(`Exact text ${n}`,n%3===0?'sara':null);if(n===0)r.memory_operations=[{action:'add',type:'relationship',relationship_agent_id:'sara',content:'PRIVATE-RELATIONSHIP-EVIDENCE',reason:'An observation',confidence:.6}];return JSON.stringify(r);},['bob','sara','charlie','unchecked']);
 await f.storage.saveAgentBeliefs('bob',[{id:'private',content:'BOB-ONLY-BELIEF'}]);
 const untouched=hash(await f.storage.loadWorkingState('unchecked'));
 await f.controller.start(config(f,{agentIds:['bob','sara','charlie'],taskConfig:{kind:'none'},maxTurns:6}));await done(f);
 assert.equal(f.controller.getStatus(),'completed');assert.equal(f.stats().maximum,1);
 const turns=await f.logs.getConversationHistory(f.config.runId);assert.deepEqual(turns.map(r=>r.agentId),['bob','sara','charlie','bob','sara','charlie']);
 assert.equal(turns[1].response,'');assert.equal(turns[1].social.action,'decline');assert.equal(turns[0].response,'Exact text 0');
 assert.ok(requests[0].messages[0].content.includes('BOB-ONLY-BELIEF'));assert.ok(!requests[1].messages[0].content.includes('BOB-ONLY-BELIEF'));
 assert.ok(requests[2].messages[0].content.includes('sara [declined]'));
 assert.equal(hash(await f.storage.loadWorkingState('unchecked')),untouched);
 assert.ok((await f.storage.loadWorkingState('bob')).entries.some(e=>e.type==='relationship'&&e.relationship_agent_id==='sara'));
 assert.ok(requests[3].messages[0].content.includes('PRIVATE-RELATIONSHIP-EVIDENCE'));assert.ok(!requests[4].messages[0].content.includes('PRIVATE-RELATIONSHIP-EVIDENCE'));
 assert.ok(requests.every(p=>p.response_format.json_schema.schema.required.includes('social')));
});

test('public-goods outcomes and signed feedback have reproducible inputs, score rules and source links',async t=>{
 const f=await fixture(t,n=>JSON.stringify(social('Decision',null,n%2===0?10:0)));
 await f.controller.start(config(f,{maxTurns:4,feedbackConfig:{enabled:true,source:'task',visibility:'private'}}));await done(f);
 const turns=await f.logs.getConversationHistory(f.config.runId),events=await f.logs.getEventHistory(f.config.runId);
 const outcomes=events.filter(e=>e.type==='task_outcome');assert.equal(outcomes.length,2);
 assert.deepEqual(outcomes[0].awards.map(a=>a.score),[-2.5,7.5]);assert.equal(outcomes[0].pool,10);
 assert.deepEqual(outcomes[0].awards.map(a=>a.decisionEventId),turns.slice(0,2).map(t=>t.eventId));
 const rewards=events.filter(e=>e.type==='feedback');assert.equal(rewards.length,4);assert.equal(rewards[0].deliverFromTurn,2);
 assert.deepEqual(turns[0].retrieval.feedbackIds,[]);assert.equal(turns[2].retrieval.feedbackIds.length,1);assert.equal(turns[3].retrieval.feedbackIds.length,1);
 assert.ok(turns[2].prompt.system.includes('"score":-2.5'));assert.ok(!turns[2].prompt.system.includes('"score":7.5'));
 assert.ok(turns[3].prompt.system.includes('"score":7.5'));assert.equal(f.stats().maximum,1);
});

test('competitive bids handle ties, abstentions and partial rounds without invented outcomes',()=>{
 const c={runId:'race',agentIds:['a','b','c'],socialConfig:{enabled:true},taskConfig:{kind:'resource_race',prize:12},feedbackConfig:{enabled:false}};
 const row=(agentId,turnIndex,amount)=>({eventId:`e${turnIndex}`,agentId,turnIndex,social:{action:amount===null?'decline':'speak',recipient_id:null},...(amount===null?{}:{taskDecision:{amount}})});
 const events=settleRound(c,[row('a',0,4),row('b',1,4),row('c',2,null)]);
 assert.equal(events.length,1);assert.deepEqual(events[0].awards.map(a=>a.score),[2,2,0]);assert.deepEqual(events[0].winners,['a','b']);
 assert.deepEqual(settleRound(c,[row('a',0,4)]),[]);
 assert.deepEqual(settleRound(c,[row('a',0,null),row('b',1,null),row('c',2,null)])[0].awards.map(a=>a.score),[0,0,0]);
 assert.deepEqual(settleRound(c,[row('a',0,0),row('b',1,0),row('c',2,0)])[0].awards.map(a=>a.score),[4,4,4]);
});

test('baseline records outcomes but supplies no feedback; delayed public feedback observes the exact boundary',async t=>{
 const f=await fixture(t,()=>JSON.stringify(social('Choice',null,2)));
 await f.controller.start(config(f,{maxTurns:5,feedbackConfig:{enabled:false,source:'task'}}));await done(f);
 const baseline=await f.logs.getConversationHistory(f.config.runId);
 assert.ok(baseline.every(t=>!t.prompt.system.includes('Delivered environmental feedback')));
 assert.equal((await f.logs.getEventHistory(f.config.runId)).filter(e=>e.type==='feedback').length,0);
 await f.controller.start(config(f,{runId:'delayed',maxTurns:5,feedbackConfig:{enabled:true,source:'task',timing:'delayed',delayTurns:2,visibility:'public'}}));await done(f);
 const delayed=await f.logs.getConversationHistory('delayed');
 assert.deepEqual(delayed.slice(0,4).map(t=>t.retrieval.feedbackIds.length),[0,0,0,0]);assert.equal(delayed[4].retrieval.feedbackIds.length,2);
 assert.equal(delayed[4].taskDecision.amount,2);assert.ok(delayed[4].prompt.system.includes('Delivered environmental feedback'));
 const limited=visibleFeedback({...config(f),feedbackConfig:{enabled:true,maxVisible:1}},'bob',10,await f.logs.getEventHistory('delayed'));assert.equal(limited.length,1);
});

test('researcher feedback is paused-only, immutable, source-linked, signed by frozen rules and never applied to memory',async t=>{
 const f=await fixture(t,()=>JSON.stringify(social()));const feedback=new FeedbackService(f.controller,f.logs);
 await f.controller.start(config(f,{maxTurns:2,taskConfig:{kind:'none'},feedbackConfig:{enabled:true,positiveScore:3,negativeScore:-2}}));await done(f);
 const state=hash(await f.storage.loadWorkingState('bob'));
 const request={feedbackId:'r1',agentId:'bob',turnIndex:0,valence:'negative',actor:'Researcher',reason:'Specified observable criterion not met'};
 const broadcasts=[];f.controller.onEvent((type,event)=>{if(type==='environment_event')broadcasts.push(event);});
 const event=await feedback.record(f.config.runId,request);assert.equal(broadcasts.length,1);assert.ok((await f.controller.getSnapshot()).events.some(e=>e.id===event.id));assert.equal(event.score,-2);assert.equal(event.deliverFromTurn,2);assert.equal(event.sourceTurnIndex,0);
 assert.equal(event.decisionEventId,(await f.logs.getConversationHistory(f.config.runId))[0].eventId);
 await assert.rejects(feedback.record(f.config.runId,request),/already exists/);
 await assert.rejects(feedback.record(f.config.runId,{...request,feedbackId:'bad',agentId:'sara'}),/committed decision/);
 assert.equal(hash(await f.storage.loadWorkingState('bob')),state);
});

test('invalid social decisions pause safely and Resume retries without duplicating completed choices',async t=>{
 let fail=true;const f=await fixture(t,n=>JSON.stringify(n===1&&fail?social('bad','outsider',1):social(`Exact ${n}`,null,1)));
 const c=config(f,{maxTurns:4});await f.controller.start(c);await done(f);assert.equal(f.controller.getStatus(),'paused');
 assert.match(f.controller.getState().error.message,/Recipient/);assert.equal(f.controller.getTurnIndex(),1);
 fail=false;await Promise.all([f.controller.resume(),f.controller.resume()]);await done(f);
 const turns=await f.logs.getConversationHistory(c.runId);assert.equal(turns.length,4);assert.equal(turns[0].response,'Exact 0');assert.equal(turns[1].response,'Exact 2');
 assert.equal((await f.logs.getEventHistory(c.runId)).filter(e=>e.type==='task_outcome').length,2);assert.equal(f.stats().maximum,1);
});

test('round journal recovery repairs task/reward events exactly once without repeating inference',async t=>{
 const f=await fixture(t,()=>JSON.stringify(social('Kept',null,1)));
 const original=f.logs.appendEvent.bind(f.logs);let injected=false;
 f.logs.appendEvent=async(run,event)=>{if(event.type==='feedback'&&!injected){injected=true;throw Error('Injected projection failure');}return original(run,event);};
 const c=config(f,{maxTurns:4,feedbackConfig:{enabled:true,source:'task'}});await f.controller.start(c);await done(f);
 assert.equal(f.controller.getStatus(),'paused');assert.equal(f.stats().requests,2);assert.equal(f.controller.getTurnIndex(),2);
 await f.controller.resume();await done(f);assert.equal(f.stats().requests,4);
 let events=await f.logs.getEventHistory(c.runId);assert.equal(events.filter(e=>e.type==='task_outcome').length,2);assert.equal(events.filter(e=>e.type==='feedback').length,4);
 assert.equal(new Set(events.map(e=>e.id)).size,events.length);
 const before=hash(events);const restarted=f.createController();await restarted.start(c);assert.equal(restarted.getStatus(),'completed');
 events=await f.logs.getEventHistory(c.runId);assert.equal(hash(events),before);assert.equal(f.stats().requests,4);
});

test('matched feedback-control batches freeze rules and starting state and export comparison evidence',async t=>{
 const f=await fixture(t,n=>JSON.stringify(social(`Exact ${n}`,null,n%2)));
 const research=new ResearchService(f.controller,f.logs,f.storage);
 await research.template('social-template',config(f,{maxTurns:4,llmConfig:{...f.config.llmConfig,model:'real-loaded-id',modelVersion:'fixture'},feedbackConfig:{enabled:true,source:'task',visibility:'public'}}));
 const batch=await research.batch('social-batch','social-template',1,['enabled'],42,false,['off','configured']);
 assert.equal(batch.trials.length,2);assert.deepEqual(batch.trials.map(c=>c.feedbackConfig.enabled).sort(),[false,true]);
 assert.equal(batch.trials[0].protocol.initialStateHash,batch.trials[1].protocol.initialStateHash);
 const bundles=[];for(const trial of batch.trials){await research.startTrial(batch.batchId,trial.runId);await done(f);assert.equal(f.controller.getStatus(),'completed');bundles.push(await research.exportRun(trial.runId));}
 const report=analyzeBundles(bundles,{windowSize:1});assert.equal(report.social.groups.length,2);assert.equal(report.social.comparisons.length,1);
 assert.ok(report.social.groups.every(g=>g.metrics.amountChange.n===1));assert.equal(report.social.runs.reduce((n,r)=>n+r.taskOutcomes.length,0),4);
 assert.equal(hash(bundles[0].config),bundles[0].configHash);assert.equal(report.groups.length,2);assert.equal(f.stats().maximum,1);
 const saved=await fs.readFile(path.join(f.root,'research/experiments',batch.trials[0].runId,'config.json'),'utf8');
 await f.controller.start(batch.trials[0]);assert.equal(await fs.readFile(path.join(f.root,'research/experiments',batch.trials[0].runId,'config.json'),'utf8'),saved);
});


test('private and public researcher feedback reach only eligible prompts after Pause and Resume',async t=>{
 for(const visibility of ['private','public'])await t.test(visibility,async t=>{
  let release;const gate=new Promise(r=>release=r);
  const f=await fixture(t,async n=>{if(n===0)await gate;return JSON.stringify(social('Exact text'));},['bob','sara','charlie']);
  const c=config(f,{agentIds:['bob','sara','charlie'],maxTurns:4,taskConfig:{kind:'none'},feedbackConfig:{enabled:true,visibility}});
  await f.controller.start(c);await until(()=>f.stats().requests===1);
  const feedback=new FeedbackService(f.controller,f.logs);
  await assert.rejects(feedback.record(c.runId,{feedbackId:'blocked',agentId:'bob',turnIndex:0,valence:'positive',actor:'R',reason:'Blocked'}),/Pause or stop/);
  const pausing=f.controller.pause();release();await pausing;
  await feedback.record(c.runId,{feedbackId:'signal',agentId:'bob',turnIndex:0,valence:'positive',actor:'R',reason:'SCORE-EVIDENCE-MARKER'});
  await f.controller.resume();await done(f);const turns=await f.logs.getConversationHistory(c.runId);
  assert.equal(turns[1].prompt.system.includes('SCORE-EVIDENCE-MARKER'),visibility==='public');
  assert.equal(turns[2].prompt.system.includes('SCORE-EVIDENCE-MARKER'),visibility==='public');
  assert.equal(turns[3].prompt.system.includes('SCORE-EVIDENCE-MARKER'),true);assert.equal(f.stats().maximum,1);
 });
});

test('JSON-only social output follows the same decisions and preserves actual speech',async t=>{
 const requests=[];const f=await fixture(t,(n,p)=>{requests.push(p);return JSON.stringify(social('  Exact\nmodel text.','sara'));});
 await f.controller.start(config(f,{maxTurns:1,taskConfig:{kind:'none'},llmConfig:{...f.config.llmConfig,outputMode:'json_only'}}));await done(f);
 assert.equal(f.controller.getStatus(),'completed');assert.equal(requests[0].response_format.type,'json_object');
 assert.ok(requests[0].messages.at(-1).content.includes('Include social'));
 assert.equal((await f.logs.getConversationHistory(f.config.runId))[0].response,'  Exact\nmodel text.');
});

test('feedback HTTP endpoint validates decisions, preserves immutable IDs, and exports records without rewriting history',async t=>{
 const f=await fixture(t,()=>JSON.stringify(social()));await f.controller.start(config(f,{maxTurns:1,taskConfig:{kind:'none'},feedbackConfig:{enabled:true}}));await done(f);
 const express=require('express'),http=require('node:http'),{createFeedbackRouter}=require('../dist/api/feedback');
 const app=express();app.use(express.json());app.use(createFeedbackRouter(new FeedbackService(f.controller,f.logs)));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/runs/${f.config.runId}/feedback`;
 const post=data=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const request={feedbackId:'http',agentId:'bob',turnIndex:0,valence:'positive',actor:'Researcher',reason:'Observable criterion'};
 const before=hash(await f.logs.getConversationHistory(f.config.runId));
 const response=await post(request);assert.equal(response.status,200);assert.equal((await response.json()).score,1);
 assert.equal((await post(request)).status,409);assert.equal((await post({...request,feedbackId:'bad',turnIndex:3})).status,400);
 const research=new ResearchService(f.controller,f.logs,f.storage);const exported=await research.exportRun(f.config.runId);
 assert.equal(exported.feedback.length,1);assert.equal(hash(await f.logs.getConversationHistory(f.config.runId)),before);
 const {integrityHash,...data}=exported;assert.equal(integrityHash,hash(data));
});

test('100 committed three-agent task turns retain ordering, score exactly 33 rounds and preserve a pending decision',async t=>{
 const ids=['bob','sara','charlie'];const f=await fixture(t,n=>JSON.stringify(social(`Actual text ${n}`,ids[(n+1)%3],n%11)),ids);
 const c=config(f,{agentIds:ids,maxTurns:100,feedbackConfig:{enabled:true,source:'task',visibility:'public',timing:'delayed',delayTurns:1,maxVisible:6}});
 await f.controller.start(c);await done(f);assert.equal(f.controller.getStatus(),'completed');
 const turns=await f.logs.getConversationHistory(c.runId);assert.equal(turns.length,100);assert.ok(turns.every((r,i)=>r.turnIndex===i&&r.agentId===ids[i%3]&&r.response===`Actual text ${i}`));
 const events=await f.logs.getEventHistory(c.runId);assert.equal(events.filter(e=>e.type==='task_outcome').length,33);assert.equal(events.filter(e=>e.type==='feedback').length,99);
 const research=new ResearchService(f.controller,f.logs,f.storage);const bundle=await research.exportRun(c.runId);const report=analyzeBundles([bundle],{windowSize:10});
 assert.equal(report.social.runs[0].unsettledDecisions,1);assert.equal(report.social.runs[0].agents.reduce((n,a)=>n+a.settledDecisions,0),99);assert.equal(f.stats().maximum,1);
});

test('rule versions and arbitrary researcher score overrides are rejected before writing evidence',async t=>{
 assert.throws(()=>resolveEnvironment({taskConfig:{version:2}}),/version/);
 const f=await fixture(t,()=>JSON.stringify(social()));await f.controller.start(config(f,{maxTurns:1,taskConfig:{kind:'none'},feedbackConfig:{enabled:true}}));await done(f);
 await assert.rejects(new FeedbackService(f.controller,f.logs).record(f.config.runId,{feedbackId:'override',agentId:'bob',turnIndex:0,valence:'positive',actor:'R',reason:'Criterion',score:999}),/saved rules/);
 assert.equal((await f.logs.readResearch(f.config.runId,'feedback')).length,0);
});
