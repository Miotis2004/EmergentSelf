// Live decoder initialization check only. HTTP 200 is NOT a response-validation pass.
// Stop active experiments first; requests are submitted sequentially without changing run data.
const fs=require('node:fs/promises');
const path=require('node:path');
const {tmpdir}=require('node:os');
const {LlmAdapter,resolveLlmConfig,outputContract}=require('../dist/llm/LlmAdapter');
const {responseSchema,inferenceResponseSchema,INFERENCE_SCHEMA_VERSION}=require('../dist/llm/agentTurnSchema');
const modes=[['normal',false,false,false],['social',true,false,false],['task-social',true,true,false],['operational',false,false,true],['social-operational',true,false,true],['task-social-operational',true,true,true]];
(async()=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),'emergent-schema-check-'));
 console.log(`Schema/HTTP artifacts: ${root}`);
 const config=resolveLlmConfig({model:process.env.LLM_TEST_MODEL||'',outputMode:'json_schema'});
 const report={inferenceSchemaVersion:INFERENCE_SCHEMA_VERSION,results:[],compatibility:'unverified',purpose:'Grammar initialization only; completion validation is deliberately not tested with one generated token.'};
 for(const [name,social,task,operational] of modes)await fs.writeFile(path.join(root,`${name}.schema.json`),JSON.stringify(inferenceResponseSchema(social,task,operational),null,2));
 try{
  const models=await new LlmAdapter(config).getModels();
  if(!config.model&&models.length===1)config.model=models[0].id;
  if(!config.model||!models.some(model=>model.id===config.model))throw Error('Select an exact loaded model with LLM_TEST_MODEL');
  report.model=config.model;
  for(const [name,social,task,operational] of modes){
   const payload={model:config.model,messages:[{role:'system',content:outputContract(responseSchema(social,task,operational))},{role:'user',content:'Return one minimal valid object with empty memory operations. This is a serialization check.'}],max_tokens:1,temperature:config.temperature,response_format:{type:'json_schema',json_schema:{name:'agent_turn',schema:inferenceResponseSchema(social,task,operational)}}};
   await fs.writeFile(path.join(root,`${name}.request.json`),JSON.stringify(payload,null,2));
   const response=await fetch(`${config.baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(300000)});
   const body=await response.text();await fs.writeFile(path.join(root,`${name}.http.txt`),body);
   let envelope;try{envelope=JSON.parse(body);}catch{envelope=null;}
   const completionEnvelope=Array.isArray(envelope?.choices)&&envelope.choices.length>0;
   const grammarError=/error parsing grammar|failed to parse grammar|exceeds sane defaults|failed to initialize samplers/i.test(body);
   const result={name,completionEnvelope,httpStatus:response.status,accepted:response.ok&&completionEnvelope&&!grammarError,grammarError};report.results.push(result);
   if(!response.ok||result.grammarError||!completionEnvelope)throw Error(`${name}: server did not accept schema (HTTP ${response.status}); inspect saved HTTP artifact`);
   console.log(`PASS ${name}: HTTP ${response.status}, schema accepted; not a completed-response validation check.`);
  }
  report.compatibility='accepted-all-six';
 }catch(error){report.error=error.message;console.error(`Live llama.cpp compatibility ${report.results.length?'not established for all combinations':'UNVERIFIED'}: ${error.message}`);process.exitCode=1;}
 finally{await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));}
})();
