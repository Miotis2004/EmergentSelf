import { hash } from '../research/protocol';
import { environmentCondition, resolveEnvironment } from './environment';

// Equal-agent, then equal-run summaries. Task scores have no moral interpretation.
const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
export function analyzeSocial(bundles:any[],windowSize:number){
    const runs=bundles.map(bundle=>{
        const env=resolveEnvironment(bundle.config);
        const rows=[...bundle.turns].sort((a,b)=>a.turnIndex-b.turnIndex).filter((t:any)=>t.social).map((turn:any)=>({eventId:turn.eventId,agentId:turn.agentId,turnIndex:turn.turnIndex,
            addressed:turn.social.action==='speak'&&turn.social.recipient_id!==null?1:0,declined:turn.social.action==='decline'?1:0,
            amount:turn.taskDecision?.amount??null,feedbackIds:turn.retrieval?.feedbackIds??[]}));
        const events=[...(bundle.events??[]),...(bundle.feedback??[])];
        const outcomes=events.filter(e=>e.type==='task_outcome');
        const rewards=events.filter(e=>e.type==='feedback');
        const agents=bundle.config.agentIds.map((agentId:string)=>{
            const owned=rows.filter((r:any)=>r.agentId===agentId);
            const metric=(subset:any[],key:string)=>mean(subset.map(r=>r[key]).filter(v=>typeof v==='number'));
            const windows=Array.from({length:Math.ceil(owned.length/windowSize)},(_,index)=>{
                const data=owned.slice(index*windowSize,(index+1)*windowSize);
                return {index,firstTurn:data[0].turnIndex,lastTurn:data.at(-1)!.turnIndex,count:data.length,addressed:metric(data,'addressed'),declined:metric(data,'declined'),amount:metric(data,'amount')};
            });
            const change=(key:'addressed'|'declined'|'amount')=>windows.length>1&&windows[0][key]!==null&&windows.at(-1)![key]!==null?windows.at(-1)![key]!-windows[0][key]!:null;
            const scores=outcomes.flatMap(e=>e.awards).filter(a=>a.agentId===agentId).map(a=>a.score);
            return {agentId,turns:owned.length,addressed:metric(owned,'addressed'),declined:metric(owned,'declined'),amount:metric(owned,'amount'),
                meanTaskScore:mean(scores),settledDecisions:scores.length,feedbackCount:rewards.filter(e=>e.agentId===agentId).length,
                exposedTurns:owned.filter((r:any)=>r.feedbackIds.length).length,windows,
                amountChange:change('amount'),addressedChange:change('addressed'),declinedChange:change('declined')};
        });
        const {mode,...memory}=bundle.config.memoryConfig??{};
        const designHash=hash({...(bundle.config.recoveryConfig?.onCorrectiveExhaustion==='record_idle_incomplete_and_advance'?{correctiveExhaustionPolicy:bundle.config.recoveryConfig.onCorrectiveExhaustion}:{}),model:bundle.config.llmConfig,participants:bundle.config.agentIds,topic:bundle.config.initialTopic??'',maxTurns:bundle.config.maxTurns,
            memory:{...memory,mode},social:env.socialConfig,task:env.taskConfig,
            feedbackRules:{positiveScore:env.feedbackConfig.positiveScore,negativeScore:env.feedbackConfig.negativeScore,maxVisible:env.feedbackConfig.maxVisible},
            inheritedHistory:bundle.config.protocol?.historyContextHash??bundle.config.protocol?.historySnapshotId??null,prompt:bundle.config.protocol?.systemPrompt,turnPrompt:bundle.config.protocol?.turnPrompt,attributes:bundle.config.protocol?.attributeMode,roles:bundle.config.protocol?.roles,inputLimit:bundle.config.protocol?.inputCharLimit,
            initialState:bundle.config.protocol?.initialStateHash??(bundle.baseline?.states?hash(bundle.baseline.states):bundle.runId),legacy:bundle.config.protocol?null:bundle.runId});
        return {runId:bundle.runId,condition:environmentCondition(bundle.config),designHash,configuration:env,agents,decisions:rows,
            taskOutcomes:outcomes,feedback:rewards,unsettledDecisions:rows.filter((r:any)=>env.taskConfig.kind!=='none'&&!outcomes.some(o=>o.awards.some((a:any)=>a.decisionEventId===r.eventId))).length};
    });
    const groups:any[]=[];
    for(const run of runs){
        let group=groups.find(g=>g.designHash===run.designHash&&g.condition===run.condition);
        if(!group){group={designHash:run.designHash,condition:run.condition,runs:[]};groups.push(group);}group.runs.push(run);
    }
    for(const group of groups){
        group.runCount=group.runs.length;
        group.metrics=Object.fromEntries(['addressed','declined','amount','meanTaskScore','amountChange','addressedChange','declinedChange'].map(key=>{
            const values=group.runs.map((run:any)=>mean(run.agents.map((a:any)=>a[key]).filter((v:any)=>v!==null))).filter((v:any)=>v!==null);
            return [key,{mean:mean(values),n:values.length}];
        }));delete group.runs;
    }
    const comparisons:any[]=[];
    for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++)if(groups[i].designHash===groups[j].designHash&&groups[i].condition!==groups[j].condition){
        const left=groups[i],right=groups[j];comparisons.push({left:left.condition,right:right.condition,designHash:left.designHash,
            differences:Object.fromEntries(Object.keys(left.metrics).map(key=>[key,left.metrics[key].mean===null||right.metrics[key].mean===null?null:right.metrics[key].mean-left.metrics[key].mean]))});
    }
    return {version:'social-v1',definitions:{addressed:'Fraction of explicit speaking decisions addressed to a participant ID.',declined:'Fraction of explicit abstentions.',amount:'Mean submitted integer task amount; abstentions unavailable.',meanTaskScore:'Net score per settled decision, including explicit abstention score zero.',addressedChange:'Last minus first agent-window addressed fraction.',declinedChange:'Last minus first agent-window abstention fraction.',amountChange:'Last minus first agent-window mean amount, requiring available endpoints in two windows.'},
        interpretation:'Descriptive task/social outcomes, not moral understanding, personality or consciousness. Human feedback is a researcher intervention; compare exposure and selection effects.',runs,groups,comparisons};
}
