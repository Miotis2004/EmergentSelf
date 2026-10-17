import { hash, normalizeProtocol, DEFAULT_SYSTEM_PROMPT } from '../research/protocol';
import { resolveMemoryConfig } from '../memory/types';
import { resolveLlmConfig } from '../llm/LlmAdapter';
import { normalizeStudy } from './protocol';
import { synthesizeStudy } from './synthesis';
// Entirely synthetic teaching data. No real agent conversation or private memory is used.
export function syntheticExample(){
 const agentIds=['agent-a','agent-b'];
 const states=Object.fromEntries(agentIds.map(id=>[id,{schemaVersion:2,identity:{id,name:id,stats:{curiosity:{initial:5,current:5}},memories:[],beliefs:[]},entries:[]}]));
 const bundles:any[]=[];
 for(const mode of ['none','enabled'])for(let repeat=1;repeat<=2;repeat++){
  const runId=`synthetic-${mode}-${repeat}`,memoryConfig=resolveMemoryConfig({mode:mode as any});
  const config={runId,agentIds,initialTopic:'',maxTurns:6,memoryConfig,llmConfig:resolveLlmConfig({baseUrl:'http://127.0.0.1:8080/v1',model:'synthetic-model-not-an-inference-result',modelVersion:'synthetic-v1',temperature:.7,maxTokens:2048,outputMode:'json_schema'}),
   protocol:normalizeProtocol({stateScope:'trial',snapshotId:'synthetic-start',initialStateHash:hash(states)},mode as any)};
  const turns=Array.from({length:6},(_,turnIndex)=>{
   const agentId=agentIds[turnIndex%2],response=mode==='enabled'&&turnIndex<(repeat===1?4:2)?'Could you explain the evidence?':'I will consider the available evidence.';
   const prompt={system:DEFAULT_SYSTEM_PROMPT,messages:[{role:'user',content:'A synthetic placeholder stimulus.'}]};
   return {schemaVersion:2,eventId:`${runId}-turn-${turnIndex}`,runId,agentId,agentName:agentId,turnIndex,response,
    timestamp:`2026-01-01T00:00:0${turnIndex}.000Z`,parsedResponse:{response,memory_operations:[]},rawResponse:JSON.stringify({response,memory_operations:[]}),
    auditTrail:[],stateBefore:states[agentId],stateAfter:states[agentId],prompt,request:{model:config.llmConfig.model,messages:[{role:'system',content:prompt.system},...prompt.messages]}};
  });
  const events=mode==='enabled'&&repeat===2?[{id:`${runId}-failure`,type:'experiment_error',runId,agentId:'agent-b',turnIndex:1,message:'Synthetic malformed-output failure; later retry succeeded.',timestamp:'2026-01-01T00:00:00.500Z'}]:[];
  const bundle={schemaVersion:3,synthetic:true,runId,config,configHash:hash(config),baseline:{atTurn:-1,states},turns,events,probes:[],interventions:[],evaluations:[],feedback:[]};
  bundles.push({...bundle,integrityHash:hash(bundle)});
 }
 const protocol=normalizeStudy({studyId:'synthetic-study',title:'Synthetic reproducibility example',researchQuestion:'Can the pipeline trace a known question-marker difference?',actor:'Synthetic researcher',registrationType:'retrospective',plannedRunIds:bundles.map(b=>b.runId),
  hypotheses:[{hypothesisId:'h1',question:'Synthetic enabled responses have a larger question-marker fraction than synthetic no-memory responses.',domain:'behavior',metric:'question_fraction',leftCondition:'none',rightCondition:'enabled',prediction:'greater',minimumEffect:.1}],
  procedures:{samplingPlan:'Four entirely synthetic runs, two per condition; no model was queried.',randomization:'Fixed teaching order; no experimental randomization.',blinding:'No human evaluation in this example.',exclusionRules:'No exclusions; retain the synthetic failure.',stoppingRule:'Six synthetic committed turns per run.',analysisPlan:'Known right-minus-left question-marker effect; independent-run bootstrap is demonstrated, not used for a scientific claim.'},
  analysis:{windowSize:2,bootstrapSamples:200,seed:42,sensitivityWindows:[1,3],excludeRuns:[]}});
 const record={schemaVersion:7,protocol,plans:bundles.map(b=>({runId:b.runId,configuration:b.config,configHash:b.configHash,origin:{kind:'synthetic',id:'example-v1'}})),evidence:[],registeredAt:'2026-01-01T00:00:00.000Z',provenance:{revision:'synthetic-example-v1',dirty:null,codeHash:null},attestation:'Synthetic teaching fixture; not a prospective study or local-model result.'};
 const study={...record,registrationHash:hash(record)};
 return {study,bundles,synthesis:synthesizeStudy(study,bundles)};
}
