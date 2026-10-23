import type {WorldState} from '../world/simulation';
import {progress} from './competition';
/** Read-only projection from authoritative evidence; no conversational text is scored. */
export function competitionReport(config:any,state:WorldState,turns:any[],rawEvents:any[]){
 const c=state.competition;if(!c)return;
 const events=[...new Map([...rawEvents,...rawEvents.filter(e=>e.type==='world_checkpoint').flatMap(e=>e.events??[]),...turns.flatMap(t=>t.environmentEvents??[])].map(e=>[e.id,e])).values()];
 const failures=events.filter(e=>e.type==='recovery_attempt'&&e.stateCommitted===false||e.type==='experiment_error'||e.type==='competition_commitment_rejected');
 const ledger=state.transformations?.ledger??[];
 return {version:1,source:'authoritative_records',result:c.result??null,teams:progress(state)?.map(team=>{
  const own=failures.filter(e=>team.agentIds.includes(e.agentId));
  const acquisitions=ledger.filter(e=>e.type==='inventory_movement'&&team.agentIds.includes(e.agentId)&&state.inventories.some(i=>i.id===e.operation.destination_inventory_id&&i.ownerType==='agent'&&team.agentIds.includes(i.ownerId))).map(e=>({eventId:e.id,agentId:e.agentId,itemId:e.operation.item_id,quantity:e.operation.quantity,simulationMinute:e.simulationMinute}));
  const ownTurns=turns.filter(t=>team.agentIds.includes(t.agentId));
  const roomsVisited=[...new Set([...team.roomsVisited,...team.agentIds.map(a=>config.worldConfig.initialPositions[a]).filter(Boolean),...ownTurns.flatMap(t=>(t.operationalAudit??[]).flatMap((a:any)=>[a.before?.location?.id,a.after?.location?.id].filter(Boolean)))])].sort();
  return {...team,roomsVisited,componentsAcquired:acquisitions,componentsContributed:ledger.filter(e=>e.type==='resource_reserved'&&team.agentIds.includes(e.agentId)).map(e=>({eventId:e.id,itemId:e.itemId,quantity:e.quantity,taskId:e.taskId,agentId:e.agentId})),resourceReservationConflicts:own.filter(e=>e.code==='RESOURCE_ALREADY_RESERVED'||e.attempt?.worldValidation?.error?.includes('reserved for another task')).map(e=>e.id),validationFailures:own.map(e=>({eventId:e.id,code:e.code??e.recovery?.code??null,message:e.reason??e.message??null})),elapsedMinutesToFirstEligibleCompletion:team.firstEligibleCompletionMinute===null?null:team.firstEligibleCompletionMinute-config.worldConfig.competition.startMinute};
 }),evidenceEventIds:events.filter(e=>e.type?.startsWith('competition_')||e.type==='transformation_completed').map(e=>e.id),measurementNotes:['Recipes and tasks derive from committed world state; reservation conflicts and rejected proposals derive from raw research audits.','No metrics are inferred from agent speech. Null means no measured eligible completion.']};
}
