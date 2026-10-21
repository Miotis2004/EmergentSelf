import {hash} from '../research/protocol';
import {advanceWorld,WorldState,WorldConfig} from '../world/simulation';
import {currentOperational} from '../operations/state';
import type {RecoveryConfig,RecoveryFailure} from './recovery';
export const AUTO_FORFEIT='record_idle_incomplete_and_advance';
export function shouldForfeit(failure:RecoveryFailure,config:RecoveryConfig,pending:any):boolean {
    // A zero retry budget must not forfeit the first rejected proposal.
    return config.onCorrectiveExhaustion===AUTO_FORFEIT&&failure.retry==='correct'&&['invalid_action','schema_validation'].includes(failure.category)&&!!pending&&pending.correctiveRetries>0&&pending.correctiveRetries>=config.correctiveRetries;
}
export function forfeitedRecord(config:any,configHash:string,pending:any,world:WorldState|undefined,events:any[]){
    const eventId=pending.logicalTurnId,agentId=pending.agentId,index=pending.turnIndex;
    const attempts=events.filter(e=>e.type==='recovery_attempt'&&e.logicalTurnIndex===index&&e.agentId===agentId&&e.id===`${eventId}:attempt:${e.attemptNumber}`);
    const rejected=attempts.filter(e=>e.stateCommitted===false&&['invalid_action','schema_validation'].includes(e.category));
    if(!rejected.length||rejected.at(-1).attemptNumber!==pending.attemptNumber)throw new Error('Forfeiture requires durable final rejection evidence');
    const failureCodes=[...new Set(rejected.flatMap(e=>[e.code,...(e.violations??[]).map((v:any)=>v.code)]))];
    const state=structuredClone(pending.context.prompt.state);
    const time=world?advanceWorld(world,config.worldConfig as WorldConfig,world.minute+config.worldConfig.minutesPerTurn,config.agentIds,eventId):undefined;
    if(time)time.state.lastAgentId=agentId; // Scheduler bookkeeping; no activity, movement or wait operation.
    const timestamp=new Date().toISOString();
    const outcome={turnOutcome:'incomplete',completionSource:'system_fallback',displayAction:'IDLE',displayStatus:'INCOMPLETE',forfeitureReason:'corrective_retries_exhausted'};
    const event={schemaVersion:2,id:eventId,type:'turn_forfeited',runId:config.runId,turnIndex:index,agentId,...outcome,reason:outcome.forfeitureReason,
        attemptCount:pending.attemptNumber,correctiveAttempts:pending.totalCorrections,failureCodes,attemptEventIds:attempts.map(e=>e.id),rejectedAttemptEventIds:rejected.map(e=>e.id),
        stateBeforeHash:hash(state),stateAfterHash:hash(state),canonicalTurnId:eventId,simulationMinute:world?.minute??null,simulationMinuteAfter:time?.state.minute??null,elapsedSimulationMinutes:world?time!.state.minute-world.minute:0,
        ...(world?{worldBeforeHash:hash(world),worldAfterHash:hash(time!.state)}:{}),timestamp};
    return {schemaVersion:2,eventId,runId:config.runId,turnIndex:index,agentId,agentName:state.identity.name,configHash,stateScope:config.protocol?.stateScope??'shared',...outcome,forfeitureEvent:event,attemptCount:event.attemptCount,failureCodes,attemptEventIds:event.attemptEventIds,rejectedAttemptEventIds:event.rejectedAttemptEventIds,
        response:'',message:null,messageRecipients:[],communication:null,turnKind:'system_incomplete',stateBefore:state,stateAfter:structuredClone(state),auditTrail:[],operationalAudit:[],operationalState:currentOperational(state),worldOperations:[],memoryMode:config.memoryConfig.mode,retrieval:pending.context.prompt.retrieval,originalPrompt:{system:pending.context.prompt.system,messages:pending.context.prompt.messages},
        ...(!pending.context.selection&&pending.context.schedulerDecision?{schedulerDecision:pending.context.schedulerDecision}:{}),
        ...(pending.context.selection?{schedulerDecision:pending.context.selection.evidence,schedulerStateAfter:pending.context.selection.stateAfter}:{}),
        environmentEvents:[...(pending.context.selection?[{id:eventId+':scheduler',type:'scheduler_decision',source:'backend_scheduler',...pending.context.selection.evidence}]:[]),...(time?.events??[])],
        ...(world?{worldBefore:world,worldAfter:time!.state,simulationMinute:world.minute}:{}),
        inferenceAttempts:attempts.map(e=>({attemptEventId:e.id,attemptNumber:e.attemptNumber,diagnostics:e.diagnostics??e.attempt?.diagnostics,elapsedMs:e.attempt?.elapsedMs,llmValidation:e.attempt?.llmValidation})),
        recoveryPolicy:structuredClone(config.recoveryConfig),recoverySummary:{attempts:pending.attemptNumber,correctiveAttempts:pending.totalCorrections,technicalFailures:pending.totalTechnicalFailures,correctionSucceeded:false,systemForfeiture:true},startedAt:pending.startedAt,elapsedMs:Date.now()-Date.parse(pending.startedAt),timestamp};
}
/** Derived from persisted scheduled records and attempts, never transient UI state. */
export function recoveryMetrics(turns:any[],events:any[]){
    const scheduled=[...new Map(turns.map(t=>[t.eventId??t.turnIndex,t])).values()].sort((a,b)=>a.turnIndex-b.turnIndex),successful=scheduled.filter(t=>t.completionSource!=='system_fallback'),incomplete=scheduled.filter(t=>t.completionSource==='system_fallback'),corrected=scheduled.filter(t=>(t.recoverySummary?.correctiveAttempts??0)>0);
    const validation=events.filter(e=>e.type==='recovery_attempt'&&['invalid_action','schema_validation'].includes(e.category));
    const validationFailures=Object.fromEntries([...new Set(validation.flatMap(e=>[e.code,...(e.violations??[]).map((v:any)=>v.code)]))].map(code=>[code,validation.filter(e=>e.code===code||e.violations?.some((v:any)=>v.code===code)).length]));
    const rate=(owned:any[])=>({scheduledTurns:owned.length,incompleteTurns:owned.filter(t=>t.completionSource==='system_fallback').length,forfeitureRate:owned.length?owned.filter(t=>t.completionSource==='system_fallback').length/owned.length:null});
    return {totalScheduledTurns:scheduled.length,successfulAgentTurns:successful.length,explicitAgentIdleTurns:successful.filter(t=>t.decision?.mode==='idle').length,validFirstAttemptTurns:successful.filter(t=>t.recoverySummary?.attempts===1).length,turnsRequiringCorrections:corrected.length,incompleteForfeitedTurns:incomplete.length,correctiveRecoverySuccessRate:corrected.length?corrected.filter(t=>t.completionSource!=='system_fallback').length/corrected.length:null,validationFailures,byAgent:Object.fromEntries([...new Set(scheduled.map(t=>t.agentId))].map(id=>[id,rate(scheduled.filter(t=>t.agentId===id))])),progression:scheduled.map(t=>({turnIndex:t.turnIndex,agentId:t.agentId,turnOutcome:t.turnOutcome??'complete',completionSource:t.completionSource??'agent'}))};
}
