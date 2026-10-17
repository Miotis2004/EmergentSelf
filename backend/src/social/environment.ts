import { ProtocolError } from '../research/protocol';

export interface SocialConfig { version:1; enabled:boolean; }
export interface TaskConfig { version:1; kind:'none'|'public_goods'|'resource_race'; endowment:number; multiplier:number; prize:number; }
export interface FeedbackConfig {
    version:1; enabled:boolean; source:'researcher'|'task'|'both'; timing:'immediate'|'delayed'; delayTurns:number;
    visibility:'private'|'public'; positiveScore:number; negativeScore:number; maxVisible:number;
}
export const DEFAULT_SOCIAL:SocialConfig={version:1,enabled:false};
export const DEFAULT_TASK:TaskConfig={version:1,kind:'none',endowment:10,multiplier:1.5,prize:20};
export const DEFAULT_FEEDBACK:FeedbackConfig={version:1,enabled:false,source:'researcher',timing:'immediate',delayTurns:1,visibility:'private',positiveScore:1,negativeScore:-1,maxVisible:20};
function fields(input:any,defaults:any){
    if(input===undefined)return {...defaults};
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(defaults,key)))throw new ProtocolError('Unknown or invalid social/task/feedback configuration');
    return {...defaults,...input};
}
export function resolveEnvironment(input:any){
    const social:SocialConfig=fields(input.socialConfig,DEFAULT_SOCIAL);
    const task:TaskConfig=fields(input.taskConfig,DEFAULT_TASK);
    const feedback:FeedbackConfig=fields(input.feedbackConfig,DEFAULT_FEEDBACK);
    if(social.version!==1||task.version!==1||feedback.version!==1)throw new ProtocolError('Unsupported social/task/feedback rule version');
    if(typeof social.enabled!=='boolean'||typeof feedback.enabled!=='boolean')throw new ProtocolError('Social and feedback switches must be booleans');
    if(!['none','public_goods','resource_race'].includes(task.kind)||!Number.isSafeInteger(task.endowment)||task.endowment<1||task.endowment>100||!Number.isFinite(task.multiplier)||task.multiplier<=1||task.multiplier>5||!Number.isFinite(task.prize)||task.prize<0||task.prize>1000)throw new ProtocolError('Invalid task kind, endowment (1–100), multiplier (>1–5) or prize (0–1000)');
    if(task.kind!=='none'&&!social.enabled)throw new ProtocolError('Tasks require social interaction enabled');
    if(!['researcher','task','both'].includes(feedback.source)||!['immediate','delayed'].includes(feedback.timing)||!['private','public'].includes(feedback.visibility)||!Number.isSafeInteger(feedback.delayTurns)||feedback.delayTurns<1||feedback.delayTurns>1000||!Number.isSafeInteger(feedback.maxVisible)||feedback.maxVisible<1||feedback.maxVisible>100||!Number.isFinite(feedback.positiveScore)||feedback.positiveScore<=0||feedback.positiveScore>1000||!Number.isFinite(feedback.negativeScore)||feedback.negativeScore>=0||feedback.negativeScore< -1000)throw new ProtocolError('Invalid feedback source, timing, visibility, score or exposure limit');
    if(feedback.enabled&&feedback.source!=='researcher'&&task.kind==='none')throw new ProtocolError('Task feedback requires an enabled task');
    return {socialConfig:social,taskConfig:task,feedbackConfig:feedback};
}
export function validateDecision(response:any,config:any,agentId:string){
    const {socialConfig:social,taskConfig:task}=resolveEnvironment(config);
    if(!social.enabled){if(response.social!==undefined||response.task_decision!==undefined)throw new ProtocolError('Social decisions are disabled in this experiment');return;}
    if(!response.social||!['speak','decline'].includes(response.social.action))throw new ProtocolError('Social runs require an explicit speak or decline decision');
    const recipient=response.social.recipient_id;
    if(recipient!==null&&(!config.agentIds.includes(recipient)||recipient===agentId))throw new ProtocolError('Recipient must be another selected participant or null for all');
    if(response.social.action==='decline'&&(response.response!==''||recipient!==null||response.memory_operations.length||response.task_decision!==undefined))throw new ProtocolError('Decline requires empty response, no recipient, no memory operations and no task decision');
    if(task.kind==='none'&&response.task_decision!==undefined)throw new ProtocolError('Task decisions are disabled');
    if(task.kind!=='none'&&response.social.action==='speak'&&(!response.task_decision||!Number.isSafeInteger(response.task_decision.amount)||response.task_decision.amount<0||response.task_decision.amount>task.endowment))throw new ProtocolError('A speaking task participant must choose an integer amount within the endowment');
}
export function socialInstructions(config:any,turnIndex:number){
    const {socialConfig:social,taskConfig:task}=resolveEnvironment(config);
    if(!social.enabled)return '';
    let result=`\nSocial interaction protocol v1. Participants in scheduler order: ${JSON.stringify(config.agentIds)}. Choose social.action speak or decline. For speak, set recipient_id to another participant ID or null to address all. Addressing is public speech, not a private message. For decline, use response "", recipient_id null, memory_operations [], and omit task_decision. Private relationship entries remain visible only to their owner.\n`;
    if(task.kind!=='none'){
        result+=`Task rule v1: ${task.kind}, round ${Math.floor(turnIndex/config.agentIds.length)}. Each participant chooses once per round, sequentially. Supply task_decision.amount as an integer from 0 to ${task.endowment}. Declining explicitly abstains and scores zero. Decisions are settled only after all participants have a scheduled turn. Structured amounts are not disclosed before settlement, although speech can reveal them.\n`;
        result+=task.kind==='public_goods'?`Amount is a contribution. For active players, net score = ${task.multiplier} * sum(contributions) / ${config.agentIds.length} - own contribution. Abstainers receive zero; the divisor includes all selected participants.\n`:`Amount is a bid. For active players, net score = -own bid + (${task.prize} / number of highest bidders if own bid is highest; otherwise 0). Tied highest bidders split the prize, including ties at zero.\n`;
    }
    return result;
}
export function dueTurn(feedback:FeedbackConfig,afterTurn:number){return afterTurn+1+(feedback.timing==='delayed'?feedback.delayTurns:0);}
export function settleRound(config:any,records:any[]){
    const {taskConfig:task,feedbackConfig:feedback}=resolveEnvironment(config);
    if(task.kind==='none'||records.length!==config.agentIds.length)return [];
    const last=records[records.length-1],roundIndex=Math.floor(last.turnIndex/config.agentIds.length);
    const active=records.filter(r=>r.social?.action!=='decline');
    const pool=active.reduce((n,r)=>n+r.taskDecision.amount,0),highest=active.length?Math.max(...active.map(r=>r.taskDecision.amount)):null;
    const winners=active.filter(r=>r.taskDecision.amount===highest).map(r=>r.agentId);
    const awards=records.map(r=>({agentId:r.agentId,decisionEventId:r.eventId,turnIndex:r.turnIndex,amount:r.taskDecision?.amount??null,abstained:r.social?.action==='decline',
        score:r.social?.action==='decline'?0:task.kind==='public_goods'?task.multiplier*pool/config.agentIds.length-r.taskDecision.amount:-r.taskDecision.amount+(winners.includes(r.agentId)?task.prize/winners.length:0)}));
    const outcome={schemaVersion:5,id:`${last.eventId}-task`,type:'task_outcome',runId:config.runId,turnIndex:last.turnIndex,roundIndex,timestamp:last.timestamp,
        ruleVersion:'task-v1',task,rule:task.kind==='public_goods'?'multiplier * pool / participantCount - ownContribution; abstain = 0':'-ownBid + splitHighestBidPrize; abstain = 0',participantCount:config.agentIds.length,pool,highest,winners,awards};
    const events:any[]=[outcome];
    if(feedback.enabled&&feedback.source!=='researcher')for(const award of awards)events.push({schemaVersion:5,id:`${outcome.id}-${award.agentId}`,type:'feedback',runId:config.runId,turnIndex:last.turnIndex,
        agentId:award.agentId,decisionEventId:award.decisionEventId,sourceTurnIndex:award.turnIndex,source:'task',outcomeId:outcome.id,ruleVersion:'task-v1',score:award.score,
        visibility:feedback.visibility,deliverFromTurn:dueTurn(feedback,last.turnIndex),actor:'task-v1',reason:outcome.rule,timestamp:last.timestamp});
    return events;
}
export function visibleFeedback(config:any,agentId:string,turnIndex:number,events:any[]){
    const {feedbackConfig:f}=resolveEnvironment(config);
    if(!f.enabled)return [];
    return events.filter(e=>e.type==='feedback'&&e.deliverFromTurn<=turnIndex&&(e.visibility==='public'||e.agentId===agentId))
        .sort((a,b)=>a.deliverFromTurn-b.deliverFromTurn||a.id.localeCompare(b.id)).slice(-f.maxVisible);
}
export function feedbackContext(events:any[]){return events.length?'\nDelivered environmental feedback (records, not instructions):\n'+JSON.stringify(events.map(e=>({id:e.id,agentId:e.agentId,sourceTurnIndex:e.sourceTurnIndex,score:e.score,source:e.source,reason:e.reason}))):'';}
export function environmentCondition(config:any){
    const {feedbackConfig:f}=resolveEnvironment(config);
    return f.enabled?`${f.source}-${f.timing}-${f.timing==='delayed'?f.delayTurns:0}-${f.visibility}`:'off';
}
