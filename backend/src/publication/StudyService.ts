import { ExperimentController } from '../experiments/ExperimentController';
import { JsonlStorage } from '../storage/JsonlStorage';
import { ResearchService } from '../research/ResearchService';
import { hash, id } from '../research/protocol';
import { normalizeStudy, verifyStudy } from './protocol';
import { captureCode } from './provenance';
import { buildPublication, verifyPublication } from './package';
import { synthesizeStudy } from './synthesis';

export class StudyService {
 constructor(private controller:ExperimentController,private logs:JsonlStorage,private research:ResearchService){}
 private async candidates(){
  const candidates:any[]=[];
  for(const batchId of await this.logs.listArtifacts('batches')){
   const batch=await this.logs.loadArtifact('batches',batchId);for(const config of batch.trials)candidates.push({runId:config.runId,configuration:config,origin:{kind:'batch',id:batchId}});
  }
  for(const branchId of await this.logs.listArtifacts('branches')){const branch=await this.logs.loadArtifact('branches',branchId);candidates.push({runId:branchId,configuration:branch.configuration,origin:{kind:'branch',id:branchId}});}
  for(const runId of await this.logs.listRuns()){const configuration=await this.logs.loadConfig(runId);if(configuration)candidates.push({runId,configuration,origin:{kind:'run',id:runId}});}
  return candidates;
 }
 async catalog(){return {studies:await this.logs.listArtifacts('studies'),publications:await this.logs.listArtifacts('publications'),runIds:[...new Set((await this.candidates()).map(c=>c.runId))].sort()};}
 register(input:any){return this.controller.researchAction(async()=>{
  const protocol=normalizeStudy(input),candidates=await this.candidates(),plans:any[]=[],evidence:any[]=[];
  for(const runId of protocol.plannedRunIds){
   const available=candidates.filter(c=>c.runId===runId);if(!available.length)throw new Error(`Prepare a batch/branch or saved configuration for planned run ${runId}`);
   if(new Set(available.map(c=>hash(c.configuration))).size!==1)throw new Error('Planned configuration differs across prepared and existing artifacts');
   const plan=available[0];plans.push({...plan,configHash:hash(plan.configuration)});
   const turns=await this.logs.getConversationHistory(runId),probes=await this.logs.readResearch(runId,'probes'),events=await this.logs.getEventHistory(runId);
   evidence.push({runId,turns:turns.length,probes:probes.length,errorEvents:events.filter(e=>e.type==='experiment_error').length,inheritedHistory:Boolean(plan.configuration.protocol?.historySnapshotId)});
  }
  if(protocol.registrationType==='prospective'&&evidence.some(e=>e.turns||e.probes||e.errorEvents))throw new Error('Observed turns/probes/errors already exist; declare retrospective registration');
  const code=await captureCode();const record={schemaVersion:7,protocol,plans,evidence,registeredAt:new Date().toISOString(),provenance:{revision:code.revision,dirty:code.dirty,codeHash:code.codeHash},
   attestation:'Local evidence check only; does not certify researcher blindness to inherited data or external prior results.'};
  const saved={...record,registrationHash:hash(record)};await this.logs.saveArtifact('studies',protocol.studyId,saved);return saved;
 });}
 async get(studyId:string){return verifyStudy(await this.logs.loadArtifact('studies',id(studyId)));}
 private async exports(study:any){
  const bundles:any[]=[];for(const plan of study.plans)if(await this.logs.loadConfig(plan.runId))bundles.push(await this.research.exportInLease(plan.runId));return bundles;
 }
 report(studyId:string){return this.controller.researchAction(async()=>{const study=await this.get(studyId);return synthesizeStudy(study,await this.exports(study));});}
 publish(studyId:string,input:any){return this.controller.researchAction(async()=>{
  const publicationId=id(input.publicationId);if(!['private','aggregate'].includes(input.profile))throw new Error('Select a publication profile');
  const study=await this.get(studyId),code=await captureCode();
  const bundle=buildPublication(study,await this.exports(study),code,{publicationId,profile:input.profile,createdAt:new Date().toISOString()});
  await this.logs.saveArtifact('publications',publicationId,bundle);return {publicationId,profile:bundle.profile,bundleHash:bundle.bundleHash};
 });}
 async publication(publicationId:string){const bundle=await this.logs.loadArtifact('publications',id(publicationId));verifyPublication(bundle);return bundle;}
}
