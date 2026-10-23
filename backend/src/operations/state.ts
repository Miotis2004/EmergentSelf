import {MAX_LOCATION_TRANSITIONS,MAX_ACTIVITY_TRANSITIONS} from '../interaction/execution';
import Ajv from 'ajv';
import {randomUUID} from 'crypto';
import type {WorkingState, SourceEvent} from '../memory/types';

export interface Location {id:string; name:string; description?:string;}
export interface OperationalState {
    location:Location;
    action:{type:'idle'|'moving'|'working'|'interacting'|'observing';description:string;status:'planned'|'in_progress'|'completed'|'failed'};
    source?:SourceEvent;
    outcomeVerified:false;
}
export interface OperationalConfig {version:1;enabled:boolean;locations:Location[];observationPolicy:'self_only'|'co_located';}
export type OperationalOperation = {action:'set_location';location_id:string;reason:string} |
    {action:'set_action';activity_type:OperationalState['action']['type'];description:string;status:OperationalState['action']['status'];reason:string};
export class OperationalError extends Error {}
export const DEFAULT_LOCATION:Location={id:'unspecified',name:'Unspecified location'};
export function currentOperational(state:Pick<WorkingState,'operational'>):OperationalState {
    return structuredClone(state.operational ?? {location:DEFAULT_LOCATION,action:{type:'idle',description:'Idle',status:'planned'},outcomeVerified:false});
}
/** Independent-run projection only; never mutates identity, memories or prior provenance. */
export function freshOperationalState(state:WorkingState,location:Location=DEFAULT_LOCATION):WorkingState {
    const projected=structuredClone(state);
    projected.operational={location:structuredClone(location),action:{type:'idle',description:'No current activity.',status:'completed'},outcomeVerified:false};
    return projected;
}
export function resolveOperational(input:any):OperationalConfig {
    if(input===undefined)return {version:1,enabled:false,locations:[{...DEFAULT_LOCATION}],observationPolicy:'self_only'};
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['version','enabled','locations','observationPolicy'].includes(key)))throw new OperationalError('Invalid operational configuration');
    const config={version:1,enabled:false,locations:[],observationPolicy:'self_only',...input};
    if(config.version!==1||typeof config.enabled!=='boolean'||!['self_only','co_located'].includes(config.observationPolicy)||!Array.isArray(config.locations)||config.locations.length>1001)throw new OperationalError('Invalid operational version, switch, observation policy or location list (maximum 1000)');
    const locations:Location[]=[{...DEFAULT_LOCATION}];
    const inputIds=new Set<string>();
    for(const [index,item] of config.locations.entries()){
        if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['id','name','description'].includes(key)))throw new OperationalError(`/locations/${index}: invalid location object or unknown field`);
        if(typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(item.id))throw new OperationalError(`/locations/${index}/id: invalid location identifier`);
        if(typeof item.name!=='string'||!item.name.trim()||item.name.length>200)throw new OperationalError(`/locations/${index}/name: nonempty name up to 200 characters required`);
        if(item.description!==undefined&&(typeof item.description!=='string'||item.description.length>1000))throw new OperationalError(`/locations/${index}/description: expected text up to 1000 characters`);
        if(inputIds.has(item.id))throw new OperationalError(`/locations/${index}/id: duplicate location identifier`);
        inputIds.add(item.id);
        if(item.id==='unspecified'){if(item.name!==DEFAULT_LOCATION.name||item.description!==undefined)throw new OperationalError('The unspecified location is reserved');continue;}
        locations.push(structuredClone(item));
    }
    if(locations.length>1001)throw new OperationalError('Maximum 1000 researcher-defined locations');
    return {...config,locations};
}
const common={reason:{type:'string',minLength:1,maxLength:2000}};
export const operationalOperationsSchema={type:'array',maxItems:MAX_LOCATION_TRANSITIONS+MAX_ACTIVITY_TRANSITIONS,description:'At most one set_location and one set_action per turn; [] preserves current activity. Do not submit an itinerary.',items:{anyOf:[
    {type:'object',additionalProperties:false,properties:{action:{enum:['set_location']},location_id:{type:'string',minLength:1,maxLength:120},...common},required:['action','location_id','reason']},
    {type:'object',additionalProperties:false,properties:{action:{enum:['set_action']},activity_type:{enum:['idle','moving','working','interacting','observing']},description:{type:'string',minLength:1,maxLength:1000},status:{enum:['planned','in_progress','completed','failed']},...common},required:['action','activity_type','description','status','reason']}
]}};
const validate=new Ajv({strict:false}).compile(operationalOperationsSchema);
export function prepareOperational(before:WorkingState,operations:unknown,config:OperationalConfig,source:SourceEvent){
    if(!validate(operations))throw new OperationalError('Invalid operational operation structure, activity type, status or description');
    const proposals=operations as OperationalOperation[],initial=currentOperational(before);
    let candidate=structuredClone(initial);const audits:any[]=[];const seen=new Set<string>();
    let error='';
    for(const [operationIndex,op] of proposals.entries()){
        const previous=structuredClone(candidate);
        const record:any={id:randomUUID(),operationIndex,operation:structuredClone(op),agentId:before.identity.id,...source,timestamp:new Date().toISOString(),before:previous,status:'accepted',outcomeVerified:false};
        try{
            if(!config.enabled)throw new OperationalError('Operational transitions are disabled');
            if(seen.has(op.action))throw new OperationalError('Conflicting transitions: at most one location and one activity change per turn');
            seen.add(op.action);
            if(!op.reason.trim())throw new OperationalError('Operation reason must be nonempty');
            if(op.action==='set_location'){
                const location=config.locations.find(location=>location.id===op.location_id);
                if(!location)throw new OperationalError('Unknown location: use an available destination ID');
                candidate.location=structuredClone(location);
            }else{
                if(!op.description.trim())throw new OperationalError('Activity description must be nonempty');
                candidate.action={type:op.activity_type,description:op.description,status:op.status};
            }
            candidate.source={...source,eventId:record.id};candidate.outcomeVerified=false;record.after=structuredClone(candidate);
        }catch(e){error=(e as Error).message;record.status='rejected';record.error=error;}
        audits.push(record);
    }
    // A rejected batch commits nothing, including earlier otherwise-valid proposals.
    if(error)for(const audit of audits){if(audit.status==='accepted'){audit.status='rejected';audit.error='Operational batch rejected; no transitions committed';}delete audit.after;}
    const state=structuredClone(before);
    if(!error&&proposals.length)state.operational=candidate;
    return {state,audit:audits,error};
}
export function operationalContext(state:WorkingState,config:OperationalConfig,others:WorkingState[]=[]){
    const own=currentOperational(state);
    const observations=config.observationPolicy==='co_located'&&own.location.id!=='unspecified'
        ?others.filter(other=>other.identity.id!==state.identity.id&&currentOperational(other).location.id===own.location.id).map(other=>({agentId:other.identity.id,operational:currentOperational(other)})):[];
    return {own,availableLocations:config.locations,observationPolicy:config.observationPolicy,observations,outcomesVerified:false};
}
export function operationalInstructions(context:ReturnType<typeof operationalContext>):string {
    return `\n\nOperational state and authorized observations (recorded state, not verified physical outcomes):\n${JSON.stringify(context)}
You may speak, act, combine both, or continue silently. Return response "" when choosing no speech. Supply operational_operations [] to continue the current activity or remain idle; this is an intentional no-op, not inference failure. Use set_location with an available location_id, or set_action with activity_type, description, status and reason. At most one of each per turn. Use set_action with activity_type idle to stop; status planned expresses an intention, in_progress records undertaking an activity, completed/failed are agent-reported statuses only. Do not produce filler dialogue merely because it is your turn.
Location registration authorizes a recorded location transition only; it does not establish physical reachability, distances or travel outcomes. Accepted transitions do not establish completed work, resource changes, objective success or another agent's actions. You control only your own operational state. Other agents' dialogue is a report, not a verified observation. Repeated promises are not independent evidence of fulfillment. Memory changes remain optional and must reflect your own proposed information, not invented outcomes. Operational event IDs and source turns are provenance, not proof of external success.`;
}
export function validateOperationalState(value:unknown):void {
    if(value===undefined)return;
    const op=value as OperationalState;
    if(!op||typeof op!=='object'||Object.keys(op).some(key=>!['location','action','source','outcomeVerified'].includes(key))||op.outcomeVerified!==false||!op.location||Object.keys(op.location).some(key=>!['id','name','description'].includes(key))||op.location.description!==undefined&&(typeof op.location.description!=='string'||op.location.description.length>1000)||typeof op.location.id!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(op.location.id)||typeof op.location.name!=='string'||!op.location.name.trim()||op.location.name.length>200||!op.action||Object.keys(op.action).some(key=>!['type','description','status'].includes(key))||op.source!==undefined&&(!op.source||typeof op.source.runId!=='string'||!Number.isSafeInteger(op.source.turnIndex)||typeof op.source.eventId!=='string')||!['idle','moving','working','interacting','observing'].includes(op.action.type)||typeof op.action.description!=='string'||!op.action.description.trim()||op.action.description.length>1000||!['planned','in_progress','completed','failed'].includes(op.action.status))throw new OperationalError('Invalid persisted operational state');
}

/** JSON-editor adapter only; persisted operational payloads keep their original shape. */
export function validateLocationDocument(input:any){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['version','locations'].includes(k)))throw new OperationalError('/: expected version and locations only');
 if(input.version!==1)throw new OperationalError('/version: required value 1');
 if(!Array.isArray(input.locations))throw new OperationalError('/locations: required array');
 resolveOperational({enabled:true,...input});return structuredClone(input);
}
