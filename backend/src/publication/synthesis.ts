import { analyzeBundles } from '../analysis/analyze';
import { hash } from '../research/protocol';
import { verifyStudy } from './protocol';
const mean=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
// Independent-run percentile bootstrap. It does not assume responses are independent samples.
export function contrastInterval(left:number[],right:number[],samples:number,seed:number){
 const estimate=left.length&&right.length?mean(right)!-mean(left)!:null;
 if(left.length<2||right.length<2)return {estimate,ci95:null};
 let state=seed>>>0;const draw=(values:number[])=>{let sum=0;for(let i=0;i<values.length;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;sum+=values[Math.floor(state/4294967296*values.length)];}return sum/values.length;};
 const deltas=Array.from({length:samples},()=>draw(right)-draw(left)).sort((a,b)=>a-b);
 return {estimate,ci95:[deltas[Math.floor((samples-1)*.025)],deltas[Math.floor((samples-1)*.975)]]};
}
function comparisons(study:any,report:any){
 return study.protocol.hypotheses.flatMap((h:any)=>{
  const rows=h.domain==='behavior'?report.units.filter((u:any)=>u.stream===h.stream&&u.probeKey===h.probeKey).map((u:any)=>({runId:u.runId,agentId:u.agentId,condition:u.condition,designHash:u.designHash,value:u.metrics[h.metric].value,change:u.change[h.metric]})):
   report.social.runs.flatMap((r:any)=>r.agents.map((a:any)=>({runId:r.runId,agentId:a.agentId,condition:r.condition,designHash:r.designHash,value:a[h.metric],change:null})));
  const designs=[...new Set(rows.filter((r:any)=>[h.leftCondition,h.rightCondition].includes(r.condition)).map((r:any)=>r.designHash))];
  if(!designs.length)return [{hypothesisId:h.hypothesisId,domain:h.domain,metric:h.metric,designHash:null,status:'unavailable',estimate:null,ci95:null,left:[],right:[],evidence:[]}];
  return designs.map(designHash=>{
   const selected=rows.filter((r:any)=>r.designHash===designHash);
   const runMeans=(condition:string,key:string)=>{
    const values=new Map<string,number[]>();for(const row of selected.filter((r:any)=>r.condition===condition&&typeof r[key]==='number'))values.set(row.runId,[...(values.get(row.runId)??[]),row[key]]);
    return [...values].map(([runId,values])=>({runId,value:mean(values)!}));
   };
   const left=runMeans(h.leftCondition,'value'),right=runMeans(h.rightCondition,'value');
   const effect=contrastInterval(left.map(r=>r.value),right.map(r=>r.value),report.options.bootstrapSamples,report.options.seed);
   const change=contrastInterval(runMeans(h.leftCondition,'change').map(r=>r.value),runMeans(h.rightCondition,'change').map(r=>r.value),report.options.bootstrapSamples,report.options.seed);
   const magnitude=effect.estimate===null?null:Math.abs(effect.estimate)>=h.minimumEffect;
   const direction=effect.estimate===null?null:h.prediction==='greater'?effect.estimate>0:h.prediction==='less'?effect.estimate<0:effect.estimate!==0;
   const evidence=h.domain==='behavior'?report.observations.filter((o:any)=>o.designHash===designHash&&o.source.stream===h.stream&&o.probeKey===h.probeKey&&[h.leftCondition,h.rightCondition].includes(o.condition)).map((o:any)=>({key:o.key,source:o.source,status:o.status,value:o.values[h.metric]??null})):
    report.social.runs.filter((r:any)=>r.designHash===designHash&&[h.leftCondition,h.rightCondition].includes(r.condition)).map((r:any)=>({runId:r.runId,decisionIds:r.decisions.map((d:any)=>d.eventId),outcomeIds:r.taskOutcomes.map((o:any)=>o.id)}));
   return {hypothesisId:h.hypothesisId,domain:h.domain,metric:h.metric,designHash,leftCondition:h.leftCondition,rightCondition:h.rightCondition,left,right,...effect,
    status:effect.estimate===null?'unavailable':effect.estimate===0?'observed_zero':magnitude&&direction?'direction_and_threshold_met':'direction_or_threshold_not_met',
    intervalIncludesZero:effect.ci95?effect.ci95[0]<=0&&effect.ci95[1]>=0:null,meetsMinimumEffect:magnitude,matchesDirection:direction,longitudinalDifference:change,evidence};
  });
 });
}
export function synthesizeStudy(study:any,bundles:any[]){
 verifyStudy(study);
 if(!Array.isArray(bundles)||bundles.some(b=>!study.protocol.plannedRunIds.includes(b.runId)))throw new Error('Synthesis includes an unplanned run');
 const hashes=new Set<string>();for(const b of bundles){if(hashes.has(b.runId))throw new Error('Duplicate synthesis run');hashes.add(b.runId);}
 const analysis=study.protocol.analysis;
 const ledger=study.plans.map((plan:any)=>{
  const bundle=bundles.find(b=>b.runId===plan.runId),exclusion=analysis.excludeRuns.find((e:any)=>e.runId===plan.runId);
  return {runId:plan.runId,plannedConfigHash:plan.configHash,actualConfigHash:bundle?hash(bundle.config):null,exportHash:bundle?hash(bundle):null,
   status:!bundle?'missing':bundle.turns.length>=bundle.config.maxTurns?'completed':'incomplete',turns:bundle?.turns.length??0,maxTurns:plan.configuration.maxTurns,
   failures:bundle?.events?.filter((e:any)=>e.type==='experiment_error').length??0,probeFailures:bundle?.probes?.filter((p:any)=>p.status!=='success').length??0,
   deviation:bundle&&hash(bundle.config)!==plan.configHash?'configuration_changed':null,excluded:Boolean(exclusion),exclusionReason:exclusion?.reason??null};
 });
 // Validate every supplied export, including exclusions, before using any subset.
 const allReport=bundles.length?analyzeBundles(bundles,{windowSize:analysis.windowSize,bootstrapSamples:analysis.bootstrapSamples,seed:analysis.seed}):null;
 const selected=bundles.filter(b=>!analysis.excludeRuns.some((e:any)=>e.runId===b.runId));
 const build=(input:any[],windowSize:number)=>{
  if(!input.length)return {windowSize,reportHash:null,contrasts:comparisons(study,{units:[],social:{runs:[]},options:analysis,observations:[]})};
  const report=analyzeBundles(input,{windowSize,bootstrapSamples:analysis.bootstrapSamples,seed:analysis.seed});
  return {windowSize,reportHash:report.reportHash,contrasts:comparisons(study,report)};
 };
 const primary=build(selected,analysis.windowSize);
 const sensitivity=[...analysis.sensitivityWindows.map((window:number)=>({kind:'window',...build(selected,window)})),{kind:'all_planned_observed',...build(bundles,analysis.windowSize)}];
 const result={version:'synthesis-v1',studyId:study.protocol.studyId,registrationHash:study.registrationHash,registrationType:study.protocol.registrationType,ledger,
  primary,sensitivity,allObservedReportHash:allReport?.reportHash??null,
  totals:{planned:ledger.length,observed:bundles.length,missing:ledger.filter((r:any)=>r.status==='missing').length,incomplete:ledger.filter((r:any)=>r.status==='incomplete').length,excluded:ledger.filter((r:any)=>r.excluded).length,deviations:ledger.filter((r:any)=>r.deviation).length},
  method:'Right minus left; equal-agent then equal-run means within matched design/stream/probe strata. Independent-run percentile bootstrap, saved seed and draws. CI unavailable with fewer than two eligible runs per condition. Sensitivity varies prespecified windows and includes excluded observed trials.',
  interpretation:'Direction/threshold labels are descriptive, not significance tests or confirmed hypotheses. Intervals are unadjusted for multiple hypotheses; shared starts, matched batches and seed/server dependence can violate independent-run assumptions. Missing/excluded outcomes remain visible; no missing outcome is imputed as zero.'};
 return {...result,synthesisHash:hash(result)};
}
