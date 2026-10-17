import { hash } from '../research/protocol';
import { METRICS, METRIC_VERSION, CUES, RUBRIC, STOPWORDS } from './definitions';
import { measure, similarity } from './metrics';

const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
export function uncertainty(values:number[],samples:number,seed:number) {
    if(!values.length)return {n:0,mean:null,ci95:null};
    if(values.length<2)return {n:values.length,mean:mean(values),ci95:null};
    let state=seed>>>0;
    const draws=Array.from({length:samples},()=>{
        let sum=0;for(let i=0;i<values.length;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;sum+=values[Math.floor(state/4294967296*values.length)];}return sum/values.length;
    }).sort((a,b)=>a-b);
    return {n:values.length,mean:mean(values),ci95:[draws[Math.floor((draws.length-1)*0.025)],draws[Math.floor((draws.length-1)*0.975)]]};
}
function means(observations:any[]) {
    return Object.fromEntries(METRICS.map(metric=>{
        const valid=observations.map(o=>o.values?.[metric.id]).filter((v:any)=>typeof v==='number'&&Number.isFinite(v));
        return [metric.id,{value:mean(valid),n:valid.length,unavailable:observations.length-valid.length}];
    }));
}
function design(config:any,baseline:any) {
    const {mode,...memory}=config.memoryConfig||{};
    return hash({llm:config.llmConfig,topic:config.initialTopic??'',participants:config.agentIds,maxTurns:config.maxTurns,memory,
        system:config.protocol?.systemPrompt,turn:config.protocol?.turnPrompt,inputLimit:config.protocol?.inputCharLimit,
        attributes:config.protocol?.attributeMode,roles:config.protocol?.roles,
        initialState:config.protocol?.initialStateHash??(baseline?.states?hash(baseline.states):`unknown:${config.runId}`),
        legacy:config.protocol?null:config.runId});
}
export function observationKey(runId:string,stream:string,recordId:string){return `${runId}|${stream}|${recordId}`;}
export function analyzeBundles(bundles:any[],options:any={}) {
    const windowSize=options.windowSize??20,bootstrapSamples=options.bootstrapSamples??500,seed=options.seed??42;
    if(!Array.isArray(bundles)||!bundles.length||bundles.length>100)throw new Error('Analyze 1–100 exported runs');
    if(!Number.isSafeInteger(windowSize)||windowSize<1||windowSize>10000||!Number.isSafeInteger(bootstrapSamples)||bootstrapSamples<100||bootstrapSamples>2000||!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Invalid analysis window, bootstrap count or seed');
    const seenKeys=new Set<string>();
    const seen=new Set<string>();const observations:any[]=[];const sources:any[]=[];
    for(const bundle of bundles){
        if(!bundle?.config||typeof bundle.runId!=='string'||bundle.runId!==bundle.config.runId||!Array.isArray(bundle.config.agentIds)||!Array.isArray(bundle.turns)||!Array.isArray(bundle.probes??[]))throw new Error('Invalid exported run structure');
        if(seen.has(bundle.runId))throw new Error('Duplicate run in analysis');seen.add(bundle.runId);
        if(bundle.integrityHash){const {integrityHash,...data}=bundle;if(hash(data)!==integrityHash)throw new Error('Export integrity hash mismatch');}
        if(bundle.configHash&&bundle.configHash!==hash(bundle.config))throw new Error('Configuration hash mismatch');
        const condition=bundle.config.protocol?.condition??bundle.config.memoryConfig?.mode??'legacy-unspecified';
        const designHash=design(bundle.config,bundle.baseline);
        sources.push({runId:bundle.runId,configHash:hash(bundle.config),exportHash:hash(bundle),condition,designHash,legacy:!bundle.config.protocol});
        const context=new Map<number,string[]>();let recent:string[]=[];
        const turns=[...bundle.turns].sort((a,b)=>a.turnIndex-b.turnIndex);
        for(const turn of turns){context.set(turn.turnIndex,[...recent]);if(typeof turn.response==='string'){recent.push(turn.response);recent=recent.slice(-5);}}
        const sessions=new Map<string,string[]>();
        const sessionStarts=new Map<string,string>();
        for(const probe of bundle.probes??[]){
            const timestamp=String(probe.timestamp??'');
            const start=sessionStarts.get(probe.probeSessionId);
            if(start===undefined||timestamp<start)sessionStarts.set(probe.probeSessionId,timestamp);
        }
        const records=[...turns.map((r,index)=>({...r,recordId:r.eventId??`turn-${index}`,stream:'dialogue',status:'success'})),
            ...(bundle.events||[]).filter((e:any)=>e.type==='experiment_error').map((e:any,index:number)=>({...e,recordId:e.id??`error-${index}`,stream:'dialogue',status:'error'})),
            ...(bundle.probes||[]).map((p:any,index:number)=>({...p,recordId:p.id??`probe-${index}`,stream:'probe'}))]
            .sort((a,b)=>{
                if(a.stream!==b.stream)return a.stream.localeCompare(b.stream);
                if(a.stream==='probe')return a.turnIndex-b.turnIndex||String(sessionStarts.get(a.probeSessionId)).localeCompare(String(sessionStarts.get(b.probeSessionId)))||String(a.probeSessionId).localeCompare(String(b.probeSessionId))||a.probeTurn-b.probeTurn;
                return a.turnIndex-b.turnIndex||String(a.timestamp??'').localeCompare(String(b.timestamp??''))||String(a.recordId).localeCompare(String(b.recordId));
            });
        for(const record of records){
            const response=record.stream==='dialogue'?record.response:record.response?.response;
            const successful=record.status==='success'&&typeof response==='string';
            const agentId=record.agentId??'unattributed';
            if(agentId!=='unattributed'&&!bundle.config.agentIds.includes(agentId))throw new Error('Record belongs to a nonparticipant');
            const otherNames=bundle.config.agentIds.filter((value:string)=>value!==agentId).flatMap((value:string)=>[value,bundle.baseline?.states?.[value]?.identity?.name]).filter((value:any)=>typeof value==='string'&&value.length>0);
            const probeKey=record.stream==='probe'?`${record.probeHash??record.probeId??'unknown'}:${record.probeTurn??0}:${record.benchmark?.benchmarkHash??'unversioned'}:${record.benchmark?.itemId??'probe'}:${record.benchmark?.arm??'standard'}`:'dialogue';
            const previous=record.stream==='dialogue'?(context.get(record.turnIndex)??[]):(sessions.get(record.probeSessionId)??[]);
            const metrics=successful?measure(record,previous,[...new Set<string>(otherNames)]):{values:{},calibration:{status:'unavailable',correct:null,confidence:null,brier:null},wordCount:0};
            const source={runId:bundle.runId,agentId,stream:record.stream,recordId:record.recordId,turnIndex:record.turnIndex,
                ...(record.stream==='probe'?{probeSessionId:record.probeSessionId,probeTurn:record.probeTurn}:{}),responseHash:successful?hash(response):null};
            const key=observationKey(bundle.runId,record.stream,record.recordId);
            if(seenKeys.has(key))throw new Error('Duplicate source record');seenKeys.add(key);
            observations.push({source,key,condition,designHash,probeKey,
                status:successful?'success':'failed',error:successful?null:record.error??record.message??'Invalid response',...metrics,
                benchmark:record.benchmark??null,
                exposure:record.retrieval?{selectedIds:record.retrieval.selectedIds,summaryIds:record.retrieval.summaryIds}:null,
                requestHash:record.request?hash(record.request):null});
            if(successful&&record.stream==='probe'){const previousReplies=sessions.get(record.probeSessionId)??[];sessions.set(record.probeSessionId,[...previousReplies,response].slice(-5));}
        }
    }
    if(observations.length>100000)throw new Error('Analyze at most 100000 responses/attempts per report; choose fewer runs');
    const units:any[]=[];const unitLookup=new Map<string,any>();
    for(const observation of observations){
        const unitKey=JSON.stringify([observation.source.runId,observation.source.agentId,observation.source.stream,observation.probeKey]);
        let unit=unitLookup.get(unitKey);
        if(!unit){unit={key:unitKey,runId:observation.source.runId,agentId:observation.source.agentId,stream:observation.source.stream,probeKey:observation.probeKey,condition:observation.condition,designHash:observation.designHash,observations:[]};units.push(unit);unitLookup.set(unitKey,unit);}
        unit.observations.push(observation);
    }
    for(const unit of units){
        unit.metrics=means(unit.observations);
        unit.windows=Array.from({length:Math.ceil(unit.observations.length/windowSize)},(_,index)=>{
            const rows=unit.observations.slice(index*windowSize,(index+1)*windowSize);
            return {index,firstSourceTurn:rows[0].source.turnIndex,lastSourceTurn:rows.at(-1).source.turnIndex,count:rows.length,failures:rows.filter((r:any)=>r.status==='failed').length,metrics:means(rows)};
        });
        unit.change=Object.fromEntries(METRICS.map(metric=>{
            const values=unit.windows.map((w:any)=>w.metrics[metric.id].value).filter((value:any)=>value!==null);
            return [metric.id,values.length>=2?values.at(-1)-values[0]:null];
        }));
    }
    const groups:any[]=[];const groupLookup=new Map<string,any>();
    for(const unit of units){
        const groupKey=JSON.stringify([unit.condition,unit.designHash,unit.stream,unit.probeKey]);
        let group=groupLookup.get(groupKey);
        if(!group){group={key:groupKey,condition:unit.condition,designHash:unit.designHash,stream:unit.stream,probeKey:unit.probeKey,units:[]};groups.push(group);groupLookup.set(groupKey,group);}group.units.push(unit);
    }
    for(const group of groups){
        group.runCount=new Set(group.units.map((u:any)=>u.runId)).size;group.unitCount=group.units.length;
        const rows=group.units.flatMap((unit:any)=>unit.observations);
        group.responses=rows.filter((r:any)=>r.status==='success').length;group.failures=rows.length-group.responses;
        group.calibration={eligible:rows.filter((r:any)=>r.benchmark?.final&&r.benchmark?.scoring).length,
            scored:rows.filter((r:any)=>r.calibration.status==='scored').length,unscorable:rows.filter((r:any)=>r.calibration.status==='unscorable').length,
            bins:Array.from({length:5},(_,index)=>{
                const points=rows.filter((r:any)=>r.calibration.status==='scored'&&Math.min(4,Math.floor(r.calibration.confidence*5))===index);
                return {lower:index/5,upper:(index+1)/5,n:points.length,meanConfidence:mean(points.map((p:any)=>p.calibration.confidence)),accuracy:mean(points.map((p:any)=>p.calibration.correct))};
            })};
        group.metrics=Object.fromEntries(METRICS.map(metric=>{
            const byRun=new Map<string,number[]>();
            for(const unit of group.units){const value=unit.metrics[metric.id].value;if(value!==null)byRun.set(unit.runId,[...(byRun.get(unit.runId)??[]),value]);}
            return [metric.id,{...uncertainty([...byRun.values()].map(values=>mean(values)!),bootstrapSamples,seed),
                validObservations:rows.filter((r:any)=>typeof r.values[metric.id]==='number').length,unavailableObservations:rows.filter((r:any)=>typeof r.values[metric.id]!=='number').length}];
        }));
        group.longitudinalChanges=Object.fromEntries(METRICS.map(metric=>{
            const byRun=new Map<string,number[]>();
            for(const unit of group.units){const value=unit.change[metric.id];if(value!==null)byRun.set(unit.runId,[...(byRun.get(unit.runId)??[]),value]);}
            return [metric.id,uncertainty([...byRun.values()].map(values=>mean(values)!),bootstrapSamples,seed)];
        }));
        delete group.units;
    }
    const comparisons:any[]=[];
    for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
        const left=groups[i],right=groups[j];
        if(left.condition===right.condition||left.designHash!==right.designHash||left.stream!==right.stream||left.probeKey!==right.probeKey)continue;
        const difference=(a:number|null,b:number|null)=>a===null||b===null?null:b-a;
        comparisons.push({leftKey:left.key,rightKey:right.key,leftCondition:left.condition,rightCondition:right.condition,
            designHash:left.designHash,stream:left.stream,probeKey:left.probeKey,
            metrics:Object.fromEntries(METRICS.map(metric=>[metric.id,{
                meanDifference:difference(left.metrics[metric.id].mean,right.metrics[metric.id].mean),
                longitudinalChangeDifference:difference(left.longitudinalChanges[metric.id].mean,right.longitudinalChanges[metric.id].mean)
            }]))});
    }
    const memoryDependence:any[]=[];
    const benchmarkRows=observations.filter(row=>row.benchmark?.sessionId&&row.benchmark.final);
    const pairing=new Map<string,any[]>();
    for(const row of benchmarkRows){const key=JSON.stringify([row.source.runId,row.source.agentId,row.benchmark.sessionId,row.benchmark.itemId]);pairing.set(key,[...(pairing.get(key)??[]),row]);}
    const textByKey=new Map<string,string>();
    for(const bundle of bundles)for(const record of bundle.probes??[])if(record.status==='success')textByKey.set(observationKey(bundle.runId,'probe',record.id),record.response.response);
    for(const rows of pairing.values()){
        const original=rows.find(r=>r.benchmark.arm==='original'),withheld=rows.find(r=>r.benchmark.arm==='withheld'),restored=rows.find(r=>r.benchmark.arm==='restored');
        if(!rows[0].benchmark.entryIds?.length&&!withheld&&!restored)continue;
        const exposed=Boolean(original&&original.benchmark.entryIds?.some((entryId:string)=>[...(original.exposure?.selectedIds??[]),...(original.exposure?.summaryIds??[])].includes(entryId)));
        const complete=Boolean(original&&withheld&&restored&&[original,withheld,restored].every(r=>r.status==='success'));
        memoryDependence.push({sessionId:rows[0].benchmark.sessionId,itemId:rows[0].benchmark.itemId,runId:rows[0].source.runId,agentId:rows[0].source.agentId,
            eligible:original?exposed:null,complete,originalRestoredRequestMatch:complete?original.requestHash===restored.requestHash:null,
            withheldSimilarity:complete&&exposed?similarity([textByKey.get(original.key)!],[textByKey.get(withheld.key)!]):null,
            restoredSimilarity:complete&&exposed?similarity([textByKey.get(original.key)!],[textByKey.get(restored.key)!]):null,
            brierDeltaWithheld:complete&&exposed&&original.values.brier!==null&&withheld.values.brier!==null?withheld.values.brier-original.values.brier:null,
            interpretation:'Exploratory paired response differences; sampling and server nondeterminism remain alternative explanations.'});
    }
    // Retain planned paired items even when an early probe failure prevented all final responses.
    for(const bundle of bundles)for(const session of bundle.benchmarkSessions??[]){
        if(!session.entryIds?.length)continue;
        const definition=bundle.benchmarkDefinitions?.find((b:any)=>b.benchmarkId===session.benchmarkId);
        for(const item of definition?.items??[]){
            if(memoryDependence.some(row=>row.sessionId===session.sessionId&&row.itemId===item.itemId))continue;
            memoryDependence.push({sessionId:session.sessionId,itemId:item.itemId,runId:session.runId,agentId:session.agentId,
                eligible:null,complete:false,originalRestoredRequestMatch:null,withheldSimilarity:null,restoredSimilarity:null,brierDeltaWithheld:null,
                interpretation:'No complete final-response triplet; inspect benchmark outcomes and the saved session manifest.'});
        }
    }
    const human:any[]=[];
    const lookup=new Map(observations.map(row=>[row.key,row]));const ratings=new Map<string,any>();
    for(const bundle of bundles)for(const rating of bundle.evaluations??[]){
        if(ratings.has(rating.ratingId))continue;ratings.set(rating.ratingId,rating);
        const row=lookup.get(observationKey(rating.source.runId,rating.source.stream,rating.source.recordId));
        if(!row||row.source.responseHash!==rating.source.responseHash)throw new Error('Human rating source response mismatch');
    }
    for(const group of groups)for(const dimension of [...RUBRIC.dimensions,...RUBRIC.socialTags.map(tag=>({id:`tag_${tag}`}))]){
        const items=new Map<string,{row:any;scores:number[]}>();
        for(const rating of ratings.values()){
            if(rating.rubricVersion!==RUBRIC.version)throw new Error('Unsupported human rubric version');
            const row=lookup.get(observationKey(rating.source.runId,rating.source.stream,rating.source.recordId))!;
            const tag=dimension.id.startsWith('tag_')?dimension.id.slice(4):null;
            const value=tag?(rating.tags===null||rating.tags.includes('unclear')&&tag!=='unclear'?null:rating.tags.includes(tag)?1:0):rating.scores[dimension.id];
            if(row.condition!==group.condition||row.designHash!==group.designHash||row.source.stream!==group.stream||row.probeKey!==group.probeKey||value===null)continue;
            if(!Number.isInteger(value)||value<0||value>4)throw new Error('Invalid human rubric score');
            const item=items.get(row.key)??{row,scores:[] as number[]};item.scores.push(value);items.set(row.key,item);
        }
        if(!items.size)continue;
        const byUnit=new Map<string,{runId:string;values:number[]}>();
        for(const {row,scores} of items.values()){const key=JSON.stringify([row.source.runId,row.source.agentId]);const unit=byUnit.get(key)??{runId:row.source.runId,values:[] as number[]};unit.values.push(mean(scores)!);byUnit.set(key,unit);}
        const byRun=new Map<string,number[]>();for(const unit of byUnit.values())byRun.set(unit.runId,[...(byRun.get(unit.runId)??[]),mean(unit.values)!]);
        human.push({groupKey:group.key,dimension:dimension.id,rubricVersion:RUBRIC.version,items:items.size,ratings:[...items.values()].reduce((n,item)=>n+item.scores.length,0),...uncertainty([...byRun.values()].map(v=>mean(v)!),bootstrapSamples,seed)});
    }
    const report={schemaVersion:4,metricVersion:METRIC_VERSION,options:{windowSize,bootstrapSamples,seed},definitions:METRICS,lexicons:CUES,stopwords:[...STOPWORDS],tokenization:'Unicode NFKC lowercase; curly apostrophes normalized; contiguous Unicode letters/numbers; complete contiguous phrase matching.',rubric:RUBRIC,
        aggregation:'Per-response metrics → per-agent means → per-run means → equal-weight condition means. 95% percentile bootstrap resamples independent runs; CI unavailable for fewer than two runs. Grouped by design, stream and probe item/arm.',
        sources,benchmarkOutcomes:bundles.flatMap(bundle=>bundle.benchmarkOutcomes??[]),observations,units:units.map(({observations,...rest})=>rest),groups,comparisons,memoryDependence,human,
        totals:{runs:bundles.length,successfulResponses:observations.filter(o=>o.status==='success').length,failedAttempts:observations.filter(o=>o.status==='failed').length,humanRatings:ratings.size}};
    return {...report,reportHash:hash(report)};
}
