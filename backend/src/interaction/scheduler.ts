import {SchedulingConfig} from './policy';
export interface SchedulerState {version:1;roundRobinCursor:number;cycle:number;remaining:string[];teamCursor:number;memberCursors:Record<string,number>}
export function initialScheduler():SchedulerState{return {version:1,roundRobinCursor:0,cycle:0,remaining:[],teamCursor:0,memberCursors:{}};}
/** Mulberry32, unsigned 32-bit arithmetic; Fisher-Yates over sorted eligible IDs. */
export function shuffle(ids:string[],seed:number,cycle:number){let a=(seed+Math.imul(cycle,0x9e3779b9))>>>0;const result=[...ids].sort();const random=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
export function selectAgent(config:SchedulingConfig,participants:string[],eligible:string[],turnIndex:number,before=initialScheduler()){
 const state=structuredClone(before);let agentId:string|undefined,teamId:string|undefined;
 if(config.mode==='randomized'){
  state.remaining=state.remaining.filter(id=>eligible.includes(id));
  if(!state.remaining.length){state.remaining=shuffle(eligible,config.seed,state.cycle);if(state.remaining.length)state.cycle++;}
  const index=state.remaining.findIndex(id=>eligible.includes(id));
  if(index>=0)[agentId]=state.remaining.splice(index,1);
 }else if(config.mode==='team_round_robin'){
  for(let offset=0;offset<config.teams.length;offset++){
   const ti=(state.teamCursor+offset)%config.teams.length,t=config.teams[ti],cursor=state.memberCursors[t.id]??0;
   for(let j=0;j<t.agentIds.length;j++){const index=(cursor+j)%t.agentIds.length,id=t.agentIds[index];if(eligible.includes(id)){agentId=id;teamId=t.id;state.teamCursor=(ti+1)%config.teams.length;state.memberCursors[t.id]=(index+1)%t.agentIds.length;break;}}
   if(agentId)break;
  }
 }else {for(let j=0;j<participants.length;j++){const id=participants[((state.roundRobinCursor??turnIndex)+j)%participants.length];if(eligible.includes(id)){agentId=id;state.roundRobinCursor=(participants.indexOf(id)+1)%participants.length;break;}}}
 return {agentId,stateAfter:state,evidence:{version:1,mode:config.mode,algorithm:config.algorithm,seed:config.seed,eligibleAgentIds:[...eligible].sort(),agentId:agentId??null,teamId:teamId??null,stateBefore:before,stateAfter:state}};
}
