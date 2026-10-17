import { randomUUID } from 'crypto';
import { ExperimentController } from '../experiments/ExperimentController';
import { JsonlStorage } from '../storage/JsonlStorage';
import { ResearchService } from '../research/ResearchService';
import { hash, id, shuffled, text, seed } from '../research/protocol';

export class BenchmarkService {
    constructor(private controller:ExperimentController,private logs:JsonlStorage,private research:ResearchService){}
    define(input:any){return this.controller.researchAction(async()=>{
        id(input?.benchmarkId);
        if((await this.logs.listArtifacts('benchmarks')).includes(input.benchmarkId))throw Object.assign(new Error('Benchmark ID already exists'),{code:'EEXIST'});
        if(input.version!==1||!Array.isArray(input.items)||!input.items.length||input.items.length>20)throw new Error('Benchmark version 1 requires 1–20 items');
        if(new Set(input.items.map((item:any)=>item.itemId)).size!==input.items.length)throw new Error('Benchmark item IDs must be unique');
        const items=input.items.map((item:any)=>{
            id(item.itemId);text(item.dimension,'Dimension',100);
            if(!Array.isArray(item.prompts)||!item.prompts.length||item.prompts.length>10)throw new Error('Each item requires 1–10 probe turns');
            item.prompts.forEach((prompt:any)=>text(prompt,'Benchmark prompt',1600));
            let scoring;
            if(item.scoring){
                const {choices,expected}=item.scoring;
                if(!Array.isArray(choices)||choices.length<2||choices.length>20||new Set(choices).size!==choices.length||choices.some((choice:any)=>typeof choice!=='string'||!/^[A-Za-z0-9_-]{1,20}$/.test(choice))||!choices.includes(expected))throw new Error('Scored items require distinct answer codes and an expected code');
                scoring={choices:[...choices],expected};
            }
            return {itemId:item.itemId,dimension:item.dimension,prompts:[...item.prompts],...(scoring?{scoring}:{})};
        });
        const definition={schemaVersion:4,version:1,benchmarkId:input.benchmarkId,items};
        const benchmarkHash=hash(definition);
        // Each item becomes an immutable Phase III probe definition with known prompts.
        for(const item of items){
            const prompts=[...item.prompts];
            if(item.scoring)prompts[prompts.length-1]+=`\nAnswer codes: ${item.scoring.choices.join(', ')}. Respond exactly: Answer: CODE; Confidence: NUMBER (NUMBER between 0 and 1).`;
            const probeId=`bm-${benchmarkHash.slice(0,32)}-${hash(item.itemId).slice(0,32)}`;
            await this.logs.saveArtifact('probe-definitions',probeId,{schemaVersion:3,probeId,prompts,promptHash:hash(prompts)});
            (item as any).probeId=probeId;
        }
        const saved={...definition,benchmarkHash};
        await this.logs.saveArtifact('benchmarks',input.benchmarkId,saved);return saved;
    });}
    run(input:any){return this.controller.researchAction(async()=>{
        const {runId,agentId,turnIndex,benchmarkId,actor,reason}=input;
        id(runId);id(agentId);id(benchmarkId);text(actor,'Researcher',200);text(reason,'Reason');
        if(!Number.isSafeInteger(turnIndex))throw new Error('Select an integer source turn');
        const definition=await this.logs.loadArtifact('benchmarks',benchmarkId);
        const originalDefinition={schemaVersion:4,version:definition.version,benchmarkId,items:definition.items.map(({probeId,...item}:any)=>item)};
        if(hash(originalDefinition)!==definition.benchmarkHash)throw new Error('Benchmark definition hash mismatch');
        const config=await this.logs.loadConfig(runId);
        if(!config?.protocol)throw new Error('Benchmarks require a Phase III run');
        const state=(await this.logs.memoryHistory(runId,agentId,turnIndex)).state;
        const entryIds=input.entryIds??[];
        if(!Array.isArray(entryIds)||entryIds.length>100||new Set(entryIds).size!==entryIds.length||entryIds.some((entryId:any)=>typeof entryId!=='string'||!state.entries.some(entry=>entry.id===entryId&&entry.status==='active')))throw new Error('Select distinct active memory IDs belonging to the source agent');
        if(entryIds.length&&config.memoryConfig.mode!=='enabled')throw new Error('Memory dependence requires a structured-memory run');
        const randomizationSeed=seed(input.randomizationSeed??42);
        const arms=entryIds.length?shuffled(['original','withheld','restored'],randomizationSeed):['original'];
        const sessionId=randomUUID();
        const manifest={schemaVersion:4,sessionId,benchmarkId,benchmarkHash:definition.benchmarkHash,runId,agentId,turnIndex,sourceStateHash:hash(state),configHash:hash(config),entryIds:[...entryIds],arms,plan:arms.flatMap(arm=>definition.items.map((item:any)=>({arm,itemId:item.itemId,probeId:item.probeId,turns:item.prompts.length}))),randomizationSeed,actor,reason,createdAt:new Date().toISOString()};
        await this.logs.saveArtifact('benchmark-sessions',sessionId,manifest);
        const outcomes:any[]=[];
        // Each arm/item is an independent conversation, under one inference lease.
        for(const arm of arms)for(const item of definition.items){
            let outcome:any={schemaVersion:4,sessionId,runId,agentId,turnIndex,benchmarkId,itemId:item.itemId,arm,timestamp:new Date().toISOString()};
            try{
                const result=await this.research.probeInLease(runId,agentId,turnIndex,item.probeId,actor,reason,{
                    withholdEntryIds:arm==='withheld'?entryIds:[],
                    benchmark:{sessionId,benchmarkId,benchmarkHash:definition.benchmarkHash,itemId:item.itemId,dimension:item.dimension,arm,entryIds,scoring:item.scoring}
                });
                outcome={...outcome,probeSessionId:result.probeSessionId,status:result.results.length===item.prompts.length&&result.results.every((record:any)=>record.status==='success')?'success':'failed',attempts:result.results.length,successfulResponses:result.results.filter((record:any)=>record.status==='success').length,unrunProbeTurns:item.prompts.length-result.results.length};
            }catch(error:any){outcome={...outcome,status:'failed',error:error.message,attempts:0,successfulResponses:0,unrunProbeTurns:item.prompts.length};}
            await this.logs.appendResearch(runId,'benchmarks',outcome);outcomes.push(outcome);
        }
        return {session:manifest,outcomes};
    });}
    async catalog(){return {benchmarks:await this.logs.listArtifacts('benchmarks'),sessions:await this.logs.listArtifacts('benchmark-sessions'),datasets:await this.logs.listArtifacts('evaluations-private')};}
}
