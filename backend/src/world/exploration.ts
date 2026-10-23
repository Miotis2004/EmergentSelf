import type {WorldConfig,WorldState} from './simulation';
import {WorldError} from './simulation';
const id={type:'string',pattern:'^[A-Za-z0-9_-]{1,120}$'};
export interface Connection {from:string;to:string;bidirectional:boolean;requiredEnvironment?:Record<string,string>;authorizedAgentIds?:string[];}
export interface ExplorationConfig {version:1;connections:Connection[];}
export const explorationSchema={type:'object',additionalProperties:false,required:['version','connections'],properties:{version:{const:1},connections:{type:'array',maxItems:10000,items:{type:'object',additionalProperties:false,required:['from','to','bidirectional'],properties:{from:id,to:id,bidirectional:{type:'boolean'},requiredEnvironment:{type:'object',propertyNames:id,additionalProperties:{type:'string',maxLength:1000}},authorizedAgentIds:{type:'array',uniqueItems:true,maxItems:100,items:id}}}}}};
export function validateExploration(config:WorldConfig,agents:string[],locations:Set<string>){
 if(!config.exploration)return;
 const edges=new Set<string>();
const keys=new Set([...Object.keys(config.transformations?.initialEnvironment??{}),...config.events.flatMap(e=>e.environmentKey?[e.environmentKey]:[]),...(config.transformations?.recipes??[]).flatMap(r=>Object.keys(r.environmentChanges))]);

 for(const c of config.exploration.connections){
  if(!locations.has(c.from)||!locations.has(c.to)||c.from===c.to||c.authorizedAgentIds?.some(a=>!agents.includes(a)))throw new WorldError('Invalid connection location or authorized participant','INVALID_MOVEMENT_CONFIGURATION');
  for(const [from,to] of [[c.from,c.to],...(c.bidirectional?[[c.to,c.from]]:[])]){const key=from+'\0'+to;if(edges.has(key))throw new WorldError('Duplicate directed connection','INVALID_MOVEMENT_CONFIGURATION');edges.add(key);}
  if(Object.keys(c.requiredEnvironment??{}).some(k=>!keys.has(k)))throw new WorldError('Connection requires an undefined environmental key','INVALID_MOVEMENT_CONFIGURATION');
 }
}
export function exits(state:WorldState,config:WorldConfig,agent:string){
 return (config.exploration?.connections??[]).flatMap(c=>c.from===state.positions[agent]?[{...c,destinationId:c.to}]:c.bidirectional&&c.to===state.positions[agent]?[{...c,destinationId:c.from}]:[]).map(c=>({destinationId:c.destinationId,authorized:c.authorizedAgentIds===undefined||c.authorizedAgentIds.includes(agent),unlocked:Object.entries(c.requiredEnvironment??{}).every(([k,v])=>state.environment[k]===v),requiredEnvironment:c.requiredEnvironment??{}}));
}
export function validateMovement(state:WorldState,config:WorldConfig,agent:string,to:string){
 if(!config.exploration||to===state.positions[agent])return;
 const exit=exits(state,config,agent).find(e=>e.destinationId===to);
 if(!exit)throw new WorldError('Destination is not connected to the current room','LOCATION_NOT_REACHABLE');
 if(!exit.authorized)throw new WorldError('Connection is not authorized for this participant','MOVEMENT_NOT_AUTHORIZED');
 if(!exit.unlocked)throw new WorldError('Connection is locked by its required environmental state','CONNECTION_LOCKED');
}
