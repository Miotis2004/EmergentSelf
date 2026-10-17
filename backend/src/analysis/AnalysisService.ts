import { randomUUID } from 'crypto';
import { ExperimentController } from '../experiments/ExperimentController';
import { JsonlStorage } from '../storage/JsonlStorage';
import { ResearchService } from '../research/ResearchService';
import { hash, id, seed, shuffled, text } from '../research/protocol';
import { analyzeBundles } from './analyze';
import { RUBRIC } from './definitions';

export class AnalysisService {
    constructor(private controller:ExperimentController,private logs:JsonlStorage,private research:ResearchService){}
    private async bundles(runIds:string[]) {
        if(!Array.isArray(runIds)||!runIds.length||runIds.length>100||new Set(runIds).size!==runIds.length)throw new Error('Select 1–100 distinct runs');
        return Promise.all(runIds.map(runId=>this.research.exportInLease(id(runId))));
    }
    report(runIds:string[],options:any={}) {return this.controller.researchAction(async()=>analyzeBundles(await this.bundles(runIds),options));}
    dataset(input:any){return this.controller.researchAction(async()=>{
        const datasetId=id(input.datasetId),orderSeed=seed(input.seed??42),sampleSize=input.sampleSize??100;
        if(!Number.isSafeInteger(sampleSize)||sampleSize<1||sampleSize>500||!['dialogue','probe','both'].includes(input.stream))throw new Error('Choose dialogue/probe/both and 1–500 evaluation items');
        const bundles=await this.bundles(input.runIds);const report=analyzeBundles(bundles);
        const raw=new Map<string,any>();
        for(const bundle of bundles){
            const turns=[...bundle.turns].sort((a,b)=>a.turnIndex-b.turnIndex);
            turns.forEach((record,index)=>raw.set(`${bundle.runId}|dialogue|${record.eventId??`turn-${index}`}`,{
                response:record.response,stimulus:record.prompt?.messages?.at(-1)?.content??'',
                context:turns.slice(Math.max(0,index-3),index).map(turn=>turn.response)
            }));
            bundle.probes.forEach((record:any,index:number)=>raw.set(`${bundle.runId}|probe|${record.id??`probe-${index}`}`,{
                response:record.response?.response,stimulus:record.prompt?.messages?.at(-1)?.content??'',
                context:(record.prompt?.messages??[]).slice(-4,-1).map((message:any)=>message.content)
            }));
        }
        const eligible=report.observations.filter(row=>row.status==='success'&&(input.stream==='both'||row.source.stream===input.stream));
        const selected=shuffled(eligible,orderSeed).slice(0,sampleSize);
        if(!selected.length)throw new Error('No successful responses are available for evaluation');
        const assignments:Record<string,any>=Object.create(null);
        const items=selected.map(row=>{
            const itemId=randomUUID();assignments[itemId]=row.source;
            const record=raw.get(row.key);
            return {itemId,response:record.response,stimulus:record.stimulus,context:record.context};
        });
        const publicView={schemaVersion:4,datasetId,rubric:RUBRIC,items};
        const saved={schemaVersion:4,datasetId,publicView,assignments,seed:orderSeed,sourceReportHash:report.reportHash,sourceExports:report.sources,requestedSampleSize:sampleSize,availableItems:eligible.length};
        await this.logs.saveArtifact('evaluations-private',datasetId,saved);return publicView;
    });}
    async publicDataset(datasetId:string){return (await this.logs.loadArtifact('evaluations-private',id(datasetId))).publicView;}
    rate(input:any){return this.controller.researchAction(async()=>{
        const dataset=await this.logs.loadArtifact('evaluations-private',id(input.datasetId));
        const raterId=text(input.raterId,'Rater pseudonym',200).trim();
        if(!Object.hasOwn(dataset.assignments,input.itemId))throw new Error('Unknown blinded item');
        if(!input.scores||typeof input.scores!=='object'||Array.isArray(input.scores)||Object.keys(input.scores).length!==RUBRIC.dimensions.length)throw new Error('Provide every rubric dimension; use null for insufficient evidence');
        const scores:Record<string,number|null>=Object.create(null);
        for(const dimension of RUBRIC.dimensions){const score=input.scores[dimension.id];if(score!==null&&(!Number.isInteger(score)||score<0||score>4))throw new Error('Rubric scores must be integers 0–4 or null');scores[dimension.id]=score;}
        const tags=input.tags;
        if(tags!==null&&(!Array.isArray(tags)||!tags.length||new Set(tags).size!==tags.length||tags.some(tag=>!RUBRIC.socialTags.includes(tag))||(tags.length>1&&(tags.includes('none')||tags.includes('unclear')))))throw new Error('Choose distinct social tags, none/unclear alone, or null');
        const justification=text(input.justification,'Evidence/justification',2000);
        const ratingId=hash({datasetId:input.datasetId,raterId,itemId:input.itemId});
        const record={schemaVersion:4,ratingId,datasetId:input.datasetId,itemId:input.itemId,raterId,rubricVersion:RUBRIC.version,scores,tags,justification,source:dataset.assignments[input.itemId],sourceReportHash:dataset.sourceReportHash,timestamp:new Date().toISOString()};
        await this.logs.saveArtifact('ratings',ratingId,record);
        return {ratingId,datasetId:input.datasetId,itemId:input.itemId,raterId};
    });}
}
