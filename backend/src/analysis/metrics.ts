import { CUES, STOPWORDS } from './definitions';
export function tokens(value:string):string[] {return value.normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").match(/[\p{L}\p{N}]+/gu)||[];}
export function phraseCount(words:string[],phrases:string[]):number {
    return phrases.reduce((sum,phrase)=>{
        const parts=tokens(phrase);if(!parts.length)return sum;let n=0;
        for(let i=0;i<=words.length-parts.length;i++) if(parts.every((part,j)=>words[i+j]===part)) n++;
        return sum+n;
    },0);
}
export function similarity(left:string[],right:string[]):number|null {
    const a=new Set(left.flatMap(tokens)),b=new Set(right.flatMap(tokens));
    if(!a.size&&!b.size)return null;
    return [...a].filter(word=>b.has(word)).length/new Set([...a,...b]).size;
}
export function calibration(response:string,scoring:any) {
    if(!scoring)return {status:'unavailable',correct:null,confidence:null,brier:null};
    const match=response.trim().match(/^Answer: ([A-Za-z0-9_-]{1,20}); Confidence: (0(?:\.\d+)?|1(?:\.0+)?)$/);
    if(!match||!scoring.choices.includes(match[1]))return {status:'unscorable',correct:null,confidence:null,brier:null};
    const confidence=Number(match[2]),correct=match[1]===scoring.expected?1:0;
    return {status:'scored',correct,confidence,brier:(confidence-correct)**2};
}
function entryText(state:any,kind:string):string[] {
    return (state?.entries||[]).filter((entry:any)=>entry.status==='active'&&(kind==='self_description'?entry.type===kind:
        ['belief','self_description'].includes(entry.type)&&phraseCount(tokens(entry.content),CUES.preference)>0)).map((entry:any)=>entry.content);
}
export function measure(record:any,previous:string[],otherNames:string[]) {
    const response=record.stream==='dialogue'?record.response:record.response?.response;
    const words=tokens(response),vocabulary=new Set(words.filter(word=>!STOPWORDS.has(word)));
    const prior=new Set(previous.slice(-5).flatMap(tokens).filter(word=>!STOPWORDS.has(word)));
    const novelty=vocabulary.size>=5&&prior.size?[...vocabulary].filter(word=>!prior.has(word)).length/vocabulary.size:null;
    const operations=record.parsedResponse?.memory_operations??record.response?.memory_operations??record.auditTrail?.map((event:any)=>event.operation);
    const revision=(op:any)=>op?.type==='belief'&&['update','contradict','consolidate','retire'].includes(op.action);
    const scored=calibration(response,record.benchmark?.final?record.benchmark.scoring:undefined);
    const values:Record<string,number|null>={
        question_fraction:/[?？]/.test(response)?1:0,topic_novelty:novelty,topic_candidate_fraction:novelty===null?null:novelty>=0.6?1:0,
        uncertainty_per_100_words:words.length?100*phraseCount(words,CUES.uncertainty)/words.length:null,
        assertion_per_100_words:words.length?100*phraseCount(words,CUES.assertion)/words.length:null,
        participant_mention_fraction:otherNames.some(name=>tokens(name).length)?(phraseCount(words,otherNames)>0?1:0):null,
        challenge_fraction:phraseCount(words,CUES.challenge)>0?1:0,cooperation_fraction:phraseCount(words,CUES.cooperation)>0?1:0,
        disengagement_fraction:phraseCount(words,CUES.disengagement)>0?1:0,
        belief_revision_proposal_fraction:operations?(operations.some(revision)?1:0):null,
        accepted_belief_revision_fraction:record.auditTrail?(record.auditTrail.some((event:any)=>event.status==='success'&&revision(event.operation))?1:0):null,
        self_description_similarity:record.stateBefore&&record.stateAfter?similarity(entryText(record.stateBefore,'self_description'),entryText(record.stateAfter,'self_description')):null,
        preference_similarity:record.stateBefore&&record.stateAfter?similarity(entryText(record.stateBefore,'preference'),entryText(record.stateAfter,'preference')):null,
        brier:scored.brier
    };
    return {values,calibration:scored,wordCount:words.length};
}
