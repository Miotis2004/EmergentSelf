import { hash } from '../research/protocol';
import { analyzeBundles } from '../analysis/analyze';
import { synthesizeStudy } from './synthesis';
import { DATA_DICTIONARY, VALIDITY } from './metadata';
import { sha256 } from './provenance';

function aggregate(study:any,synthesis:any){
 const runIds=study.protocol.plannedRunIds;const designs=[...new Set(synthesis.primary.contrasts.map((c:any)=>c.designHash).filter(Boolean))];
 const alias=(id:any,values:any[],prefix:string)=>id===null?null:`${prefix}-${values.indexOf(id)+1}`;
 const cleanContrast=(c:any)=>({hypothesis:alias(c.hypothesisId,study.protocol.hypotheses.map((h:any)=>h.hypothesisId),'hypothesis'),design:alias(c.designHash,designs,'design'),domain:c.domain,metric:c.metric,status:c.status,
  estimate:c.estimate,ci95:c.ci95,leftCount:c.left.length,rightCount:c.right.length,intervalIncludesZero:c.intervalIncludesZero??null,
  meetsMinimumEffect:c.meetsMinimumEffect??null,matchesDirection:c.matchesDirection??null,longitudinalDifference:c.longitudinalDifference??null});
 // No raw report/config objects or researcher-supplied prose cross this allowlist.
 return {registrationType:study.protocol.registrationType,totals:synthesis.totals,
  hypotheses:study.protocol.hypotheses.map((h:any,index:number)=>({id:`hypothesis-${index+1}`,domain:h.domain,metric:h.metric,leftCondition:h.leftCondition,rightCondition:h.rightCondition,prediction:h.prediction,minimumEffect:h.minimumEffect,stream:h.stream})),
  trials:synthesis.ledger.map((r:any)=>({run:alias(r.runId,runIds,'trial'),status:r.status,turns:r.turns,maxTurns:r.maxTurns,failures:r.failures,probeFailures:r.probeFailures,excluded:r.excluded,deviation:r.deviation})),
  primary:{windowSize:synthesis.primary.windowSize,contrasts:synthesis.primary.contrasts.map(cleanContrast)},
  sensitivity:synthesis.sensitivity.map((s:any)=>({kind:s.kind,windowSize:s.windowSize,contrasts:s.contrasts.map(cleanContrast)})),
  method:synthesis.method,interpretation:synthesis.interpretation};
}
export function buildPublication(study:any,exports:any[],provenance:any,options:any){
 if(!['private','aggregate'].includes(options.profile))throw new Error('Choose private reproduction or aggregate-only export');
 const synthesis=synthesizeStudy(study,exports);
 const {files,...codeMetadata}=provenance;
 const base={schemaVersion:7,profile:options.profile,publicationId:options.profile==='private'?options.publicationId:'aggregate-release',createdAt:options.createdAt,
  dataDictionary:DATA_DICTIONARY,validity:VALIDITY,provenance:codeMetadata};
 const payload=options.profile==='private'?{...base,study,exports,synthesis,analysis:exports.length?analyzeBundles(exports,{windowSize:study.protocol.analysis.windowSize,bootstrapSamples:study.protocol.analysis.bootstrapSamples,seed:study.protocol.analysis.seed}):null,code:files,
  reproduction:'Verify bundleHash and code digests. Recompute synthesis/analysis from included immutable study and exports using npm run verify-publication -- FILE --recompute. The matching backend source and lockfile are archived in code.'}:
  {...base,publicSummary:aggregate(study,synthesis),reproduction:'Aggregate-only: no raw text/configuration or source event mapping is included. Integrity can be checked; full analysis reproduction requires the private package. This export is not a guarantee of anonymity.'};
 return {...payload,bundleHash:hash(payload)};
}
export function verifyPublication(bundle:any,recompute=false,currentCodeHash?:string){
 const {bundleHash,...payload}=bundle;if(hash(payload)!==bundleHash)throw new Error('Publication integrity hash mismatch');
 if(bundle.schemaVersion!==7||!['private','aggregate'].includes(bundle.profile))throw new Error('Unsupported publication format');
 if(hash(bundle.provenance.fileHashes)!==bundle.provenance.codeHash)throw new Error('Code manifest digest mismatch');
 if(bundle.profile==='private'){
  if(!bundle.code||Object.keys(bundle.code).some(name=>!/^(backend|examples\/phase-vii)\/[A-Za-z0-9_./-]+$/.test(name)||name.split('/').includes('..')))throw new Error('Invalid archived source paths');
  const files=Object.fromEntries(Object.entries(bundle.code).map(([name,contents])=>{if(typeof contents!=='string')throw new Error('Invalid source contents');return [name,sha256(contents)];}));
  if(hash(files)!==bundle.provenance.codeHash||hash(files)!==hash(bundle.provenance.fileHashes))throw new Error('Archived source digest mismatch');
  if(recompute){
   if(currentCodeHash&&currentCodeHash!==bundle.provenance.codeHash)throw new Error('Current analysis code differs from archived source; reconstruct the archived backend before claiming exact reproduction');
   const synthesis=synthesizeStudy(bundle.study,bundle.exports);if(hash(synthesis)!==hash(bundle.synthesis))throw new Error('Synthesis does not reproduce');
   const analysis=bundle.exports.length?analyzeBundles(bundle.exports,bundle.study.protocol.analysis):null;
   if(hash(analysis)!==hash(bundle.analysis))throw new Error('Behavioral analysis does not reproduce');
  }
 }else if(recompute)throw new Error('Aggregate-only package cannot reproduce raw-data analysis');
 return {valid:true,profile:bundle.profile,recomputed:recompute,bundleHash};
}
