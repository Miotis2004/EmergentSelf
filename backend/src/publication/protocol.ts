import { METRICS } from '../analysis/definitions';
import { id, text, seed, hash } from '../research/protocol';
export const SOCIAL_METRICS=['addressed','declined','amount','meanTaskScore','amountChange','addressedChange','declinedChange'];
export const PROCEDURES=['samplingPlan','randomization','blinding','exclusionRules','stoppingRule','analysisPlan'] as const;
const fields=(input:any,allowed:string[])=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))throw new Error('Unknown or invalid study fields');};
export function normalizeStudy(input:any){
 fields(input,['studyId','title','researchQuestion','registrationType','hypotheses','procedures','plannedRunIds','analysis','actor']);
 id(input.studyId);text(input.title,'Study title',300);text(input.researchQuestion,'Research question',2000);text(input.actor,'Researcher',200);
 if(!['prospective','retrospective'].includes(input.registrationType))throw new Error('Declare prospective or retrospective registration');
 if(!Array.isArray(input.plannedRunIds)||!input.plannedRunIds.length||input.plannedRunIds.length>100||new Set(input.plannedRunIds).size!==input.plannedRunIds.length)throw new Error('Plan 1–100 distinct run IDs');input.plannedRunIds.forEach(id);
 fields(input.procedures,[...PROCEDURES]);for(const key of PROCEDURES)text(input.procedures[key],key,4000);
 if(!Array.isArray(input.hypotheses)||!input.hypotheses.length||input.hypotheses.length>20||new Set(input.hypotheses.map((h:any)=>h.hypothesisId)).size!==input.hypotheses.length)throw new Error('Provide 1–20 distinct hypotheses');
 const hypotheses=input.hypotheses.map((h:any)=>{
  fields(h,['hypothesisId','question','domain','metric','leftCondition','rightCondition','prediction','minimumEffect','stream','probeKey']);
  id(h.hypothesisId);text(h.question,'Hypothesis question',2000);
  if(!['behavior','social'].includes(h.domain)||!(h.domain==='behavior'?METRICS.map(m=>m.id):SOCIAL_METRICS).includes(h.metric))throw new Error('Choose a registered behavioral/social measure');
  const condition=(value:any)=>typeof value==='string'&&(h.domain==='behavior'?['none','history','enabled'].includes(value):/^(off|(task|both|researcher)-(immediate-0|delayed-([1-9][0-9]{0,2}|1000))-(private|public))$/.test(value));
  if(!condition(h.leftCondition)||!condition(h.rightCondition)||h.leftCondition===h.rightCondition)throw new Error('Choose distinct valid condition labels');
  if(!['greater','less','different'].includes(h.prediction)||typeof h.minimumEffect!=='number'||!Number.isFinite(h.minimumEffect)||h.minimumEffect<0||h.minimumEffect>10000)throw new Error('Specify a directional prediction and nonnegative minimum effect');
  const stream=h.stream??'dialogue';
  if(!['dialogue','probe'].includes(stream)||(h.domain==='social'&&stream!=='dialogue'))throw new Error('Invalid hypothesis stream');
  if(stream==='probe')text(h.probeKey,'Exact probe stratum key',2000);
  return {...h,stream,...(stream==='dialogue'?{probeKey:'dialogue'}:{})};
 });
 fields(input.analysis,['windowSize','bootstrapSamples','seed','sensitivityWindows','excludeRuns']);
 const {windowSize,bootstrapSamples}=input.analysis;
 if(!Number.isSafeInteger(windowSize)||windowSize<1||windowSize>10000||!Number.isSafeInteger(bootstrapSamples)||bootstrapSamples<100||bootstrapSamples>2000)throw new Error('Invalid window or bootstrap size');seed(input.analysis.seed);
 const windows=input.analysis.sensitivityWindows;
 if(!Array.isArray(windows)||!windows.length||windows.length>5||new Set(windows).size!==windows.length||windows.some(w=>!Number.isSafeInteger(w)||w<1||w>10000))throw new Error('Prespecify 1–5 distinct sensitivity windows');
 const excludes=input.analysis.excludeRuns??[];
 if(!Array.isArray(excludes)||new Set(excludes.map((e:any)=>e.runId)).size!==excludes.length)throw new Error('Invalid exclusion list');
 for(const e of excludes){fields(e,['runId','reason']);if(!input.plannedRunIds.includes(e.runId))throw new Error('Excluded run must be planned');text(e.reason,'Exclusion rationale',2000);}
 return {...input,hypotheses,analysis:{...input.analysis,excludeRuns:excludes}};
}
export function verifyStudy(study:any){const {registrationHash,...record}=study;if(hash(record)!==registrationHash)throw new Error('Study registration hash mismatch');normalizeStudy(study.protocol);
 if(!Array.isArray(study.plans)||study.plans.length!==study.protocol.plannedRunIds.length||new Set(study.plans.map((p:any)=>p.runId)).size!==study.plans.length||study.plans.some((p:any)=>!study.protocol.plannedRunIds.includes(p.runId)||hash(p.configuration)!==p.configHash||p.configuration.runId!==p.runId))throw new Error('Invalid registered trial plan');
 return study;}
