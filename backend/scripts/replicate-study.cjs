// Explicit local researcher workflow. Defaults to preparing/registering; --execute enables real inference.
(async()=>{
 const args=process.argv.slice(2),options={api:'http://localhost:3000',repeats:3,turns:100},flags=new Set();
 const names={'--study-id':'studyId','--model-version':'modelVersion','--model':'model','--llm-url':'llmUrl','--api':'api','--repeats':'repeats','--turns':'turns'};
 for(let i=0;i<args.length;i++){if(args[i]==='--execute'){flags.add('execute');continue;}const name=names[args[i]];if(!name||!args[i+1])throw Error('Unknown option or missing value');options[name]=args[++i];}
 if(2*Number(options.repeats)*Number(options.turns)>100000)throw Error('Keep the planned study at or below 100000 turns for one synthesis report');
 const {id}=require('../dist/research/protocol');id(options.studyId);
 if(options.studyId.length>80||!options.modelVersion||!Number.isSafeInteger(Number(options.repeats))||Number(options.repeats)<2||Number(options.repeats)>50||!Number.isSafeInteger(Number(options.turns))||Number(options.turns)<2||Number(options.turns)>100000)throw Error('Use --study-id (≤80 characters), --model-version, --repeats 2–50 and --turns 2–100000');
 const api=options.api.replace(/\/$/,'');
 const call=async(method,route,body)=>{
  const response=await fetch(api+route,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);return data;
 };
 const status=await call('GET','/api/experiment/status');if(['running','paused'].includes(status.status))throw Error('Stop/reset the existing active run before preparing this replication');
 const defaults=await call('GET','/api/llm/config'),baseUrl=options.llmUrl||defaults.baseUrl;
 const models=await call('GET',`/api/llm/models?baseUrl=${encodeURIComponent(baseUrl)}`),model=options.model||(models.length===1?models[0].id:null);
 if(!model||!models.some(m=>m.id===model))throw Error('Select an exact loaded --model');
 const agentIds=[`${options.studyId}-a`,`${options.studyId}-b`];
 for(const [index,agentId] of agentIds.entries())await call('POST','/api/agents',{id:agentId,name:`Participant ${index+1}`,stats:{curiosity:{initial:5,current:5},sociability:{initial:5,current:5}}});
 const templateId=`${options.studyId}-template`,batchId=`${options.studyId}-batch`;
 await call('POST','/api/research/templates',{templateId,configuration:{runId:'unused',agentIds,maxTurns:Number(options.turns),initialTopic:'',memoryConfig:{mode:'enabled'},llmConfig:{...defaults,baseUrl,model,modelVersion:options.modelVersion,temperature:.7},protocol:{attributeMode:'numeric'}}});
 const batch=await call('POST','/api/research/batches',{batchId,templateId,repeats:Number(options.repeats),conditions:['none','enabled'],randomizationSeed:42,randomizeParticipants:false});
 await call('POST','/api/studies',{studyId:options.studyId,title:'Local structured-memory replication',researchQuestion:'How does structured memory change observable question-marker frequency under fixed prompts?',actor:'local-researcher',registrationType:'prospective',plannedRunIds:batch.trials.map(t=>t.runId),
  hypotheses:[{hypothesisId:'h1',question:'Structured memory produces a higher question-marker fraction than no memory.',domain:'behavior',metric:'question_fraction',leftCondition:'none',rightCondition:'enabled',prediction:'greater',minimumEffect:.05}],
  procedures:{samplingPlan:`${options.repeats} independent runs intended per condition; ${options.turns} total turns per run; two identical initial agent snapshots. Assess server/seed dependence before inference.`,randomization:'Seeded balanced trial order, seed 42; fixed participant order.',blinding:'Automated punctuation proxy; no human rating for primary outcome.',exclusionRules:'No exclusions; retain failures/incomplete trials and all-observed sensitivity.',stoppingRule:'Stop each trial at its saved maximum; pause on errors; no silent retry or extension.',analysisPlan:'Equal-agent/run question-marker means; right-minus-left difference; unadjusted 500-draw independent-run bootstrap; sensitivity windows 10 and 40. Exploratory, no consciousness/trait claim.'},
  analysis:{windowSize:20,bootstrapSamples:500,seed:42,sensitivityWindows:[10,40],excludeRuns:[]}});
 process.stdout.write(`Prepared and locally registered ${batch.trials.length} trials for ${options.studyId}.\n`);
 if(!flags.has('execute')){process.stdout.write('No inference started. Start saved trials in the dashboard, or invoke a new study with --execute.\n');return;}
 for(const trial of batch.trials){
  await call('POST',`/api/research/batches/${batchId}/start`,{runId:trial.runId});
  while(true){const current=await call('GET','/api/experiment/status');if(current.status==='completed')break;if(current.status!=='running')throw Error(`Run ${trial.runId} ${current.status}; inspect its logged diagnostic before explicitly resuming. Remaining trials were not started.`);await new Promise(r=>setTimeout(r,500));}
 }
 process.stdout.write(`Completed ${batch.trials.length} trials. Generate synthesis and publication packages in the dashboard.\n`);
})().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
