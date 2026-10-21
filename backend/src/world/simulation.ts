import Ajv from 'ajv';
import {hash} from '../research/protocol';
import * as transformations from './transformations';
import {OperationalConfig} from '../operations/state';

// All time is an integer minute on a day-zero simulation calendar, never a Date.
export interface ItemDefinition {id:string;name:string;unit:string;stackable:boolean;consumable:boolean;description?:string;category?:string;durability?:number;condition?:string;properties?:Record<string,string|number|boolean>;usageRoles?:string[];provenance?:string;}
export interface Inventory {id:string;ownerType:'location'|'agent';ownerId:string;visibility:'private'|'local'|'public';authorizedAgentIds:string[];quantities:Record<string,number>;}
export interface ScheduledEvent {id:string;atMinute:number;intervalMinutes?:number;occurrences:number;inventoryId?:string;itemId?:string;quantityDelta?:number;environmentKey?:string;value?:string;affectedAgentIds:string[];locationId?:string;observation:string;wake:boolean;}
export interface WorldConfig {version:1;enabled:boolean;initialMinute:number;minutesPerTurn:number;initialPositions:Record<string,string>;items:ItemDefinition[];inventories:Inventory[];events:ScheduledEvent[];observationPolicy:'local'|'self_only';communicationPolicy:'local'|'global';schedulingMode:'round_robin'|'event_driven';transformations?:transformations.TransformationConfig;}
export interface WorldState {version:1;revision:number;minute:number;positions:Record<string,string>;inventories:Inventory[];environment:Record<string,string>;executed:string[];waits:Record<string,{untilMinute?:number;eventId?:string}>;wakeReasons:Record<string,string[]>;observations:any[];lastAgentId?:string;transformations?:transformations.TransformationState;}
export class WorldError extends Error {constructor(message:string,public code?:string){super(message);}}
const identifier={type:'string',pattern:'^[A-Za-z0-9_-]{1,120}$'};
const integer={type:'integer',minimum:0,maximum:1000000000};
const object=(properties:any,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const ids={type:'array',maxItems:100,uniqueItems:true,items:identifier};
const configSchema=object({version:{const:1},enabled:{type:'boolean'},initialMinute:integer,minutesPerTurn:{...integer,minimum:1,maximum:10080},
 initialPositions:{type:'object',propertyNames:identifier,additionalProperties:identifier},items:{type:'array',maxItems:100,items:object({id:identifier,name:{type:'string',minLength:1,maxLength:200},unit:{type:'string',minLength:1,maxLength:80},stackable:{type:'boolean'},consumable:{type:'boolean'},...transformations.itemPropertiesSchema},['id','name','unit','stackable','consumable'])},
 inventories:{type:'array',maxItems:200,items:object({id:identifier,ownerType:{enum:['location','agent']},ownerId:identifier,visibility:{enum:['private','local','public']},authorizedAgentIds:ids,quantities:{type:'object',propertyNames:identifier,additionalProperties:integer}})},
 events:{type:'array',maxItems:100,items:object({id:identifier,atMinute:integer,intervalMinutes:{...integer,minimum:1},occurrences:{...integer,minimum:1,maximum:1000},inventoryId:identifier,itemId:identifier,quantityDelta:{type:'integer',minimum:-1000000000,maximum:1000000000},environmentKey:identifier,value:{type:'string',maxLength:1000},affectedAgentIds:ids,locationId:identifier,observation:{type:'string',minLength:1,maxLength:2000},wake:{type:'boolean'}},['id','atMinute','occurrences','affectedAgentIds','observation','wake'])},
 observationPolicy:{enum:['local','self_only']},communicationPolicy:{enum:['local','global']},schedulingMode:{enum:['round_robin','event_driven']},transformations:transformations.configSchema},['version','enabled','initialMinute','minutesPerTurn','initialPositions','items','inventories','events','observationPolicy','communicationPolicy','schedulingMode']);
const checkConfig=new Ajv({strict:false}).compile<WorldConfig>(configSchema);
export function resolveWorld(input:any,agents:string[],operational:OperationalConfig):WorldConfig|undefined {
 if(input===undefined)return undefined;
 if(!input||typeof input!=='object'||Array.isArray(input))throw new WorldError('World configuration must be an object');
 const config={version:1,enabled:false,initialMinute:0,minutesPerTurn:15,initialPositions:{},items:[],inventories:[],events:[],observationPolicy:'local',communicationPolicy:'local',schedulingMode:'round_robin',...structuredClone(input)};
 if(!checkConfig(config))throw new WorldError(`Invalid world configuration: ${checkConfig.errors?.map(e=>e.instancePath+' '+e.keyword).join(', ')}`);
 if(config.enabled&&!operational.enabled)throw new WorldError('World simulation requires operational turns');
 const locations=new Set(operational.locations.map(l=>l.id));
 const unique=(entries:any[],label:string)=>{if(new Set(entries.map(e=>e.id)).size!==entries.length)throw new WorldError(`Duplicate ${label} ID`);};
 unique(config.items,'item');unique(config.inventories,'inventory');unique(config.events,'scheduled event');
 const catalog=new Set(config.items.map((i:ItemDefinition)=>i.id));
 for(const [id,location] of Object.entries(config.initialPositions))if(!agents.includes(id)||!locations.has(location as string))throw new WorldError('Invalid initial position participant or location');
 for(const inv of config.inventories){
  if(!(inv.ownerType==='agent'?agents.includes(inv.ownerId):locations.has(inv.ownerId))||inv.authorizedAgentIds.some((id:string)=>!agents.includes(id))||Object.keys(inv.quantities).some(item=>!catalog.has(item)||config.items.find(i=>i.id===item)?.stackable===false&&inv.quantities[item]>1))throw new WorldError('Unknown inventory owner, authorization or item');
 }
 let total=0;
 for(const event of config.events){
  total+=event.occurrences;
  if(event.atMinute<config.initialMinute||event.occurrences>1&&!event.intervalMinutes||event.affectedAgentIds.some((id:string)=>!agents.includes(id))||event.locationId&&!locations.has(event.locationId))throw new WorldError('Invalid schedule time, recurrence or recipients');
  if(event.inventoryId!==undefined||event.itemId!==undefined||event.quantityDelta!==undefined){if(!config.inventories.some((i:Inventory)=>i.id===event.inventoryId)||!catalog.has(event.itemId!)||event.quantityDelta===undefined)throw new WorldError('Scheduled inventory effect requires valid inventory, item and delta');}
  if((event.environmentKey===undefined)!==(event.value===undefined))throw new WorldError('Environmental effect requires key and value');
  if(event.atMinute+(event.occurrences-1)*(event.intervalMinutes??0)>1000000000)throw new WorldError('Scheduled time exceeds clock range');
 }
 if(total>10000)throw new WorldError('Maximum 10,000 scheduled occurrences per run');
 if(config.transformations)transformations.validateConfig(config,agents,[...locations]);
 return config;
}
export function formatSimulationTime(minute:number){return `Day ${Math.floor(minute/1440)+1} ${String(Math.floor(minute%1440/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;}
export function initialWorld(config:WorldConfig,agents:string[]):WorldState {
 return {version:1,revision:0,minute:config.initialMinute,positions:Object.fromEntries(agents.map(id=>[id,config.initialPositions[id]??'unspecified'])),inventories:structuredClone(config.inventories),environment:{},executed:[],waits:{},wakeReasons:{},observations:[],...(config.transformations?{transformations:transformations.initialState(config,agents),environment:structuredClone(config.transformations.initialEnvironment)}:{})};
}
export function schedule(config:WorldConfig){
 return config.events.flatMap(event=>Array.from({length:event.occurrences},(_,index)=>({event,index,minute:event.atMinute+index*(event.intervalMinutes??0),id:`${event.id}:${index}`}))).sort((a,b)=>a.minute-b.minute||(a.event.id<b.event.id?-1:a.event.id>b.event.id?1:0)||a.index-b.index);
}
function wake(state:WorldState,id:string,reason:string){delete state.waits[id];(state.wakeReasons[id]??=[]).push(reason);}
function observe(state:WorldState,id:string,minute:number,recipients:string[],kind:string,data:any){
 const observation={id,simulationMinute:minute,recipients:[...recipients],kind,data:structuredClone(data),source:kind==='agent_report'?'agent_report':'authoritative_world'};
 state.observations.push(observation);return observation;
}
function checkedQuantity(inv:Inventory,item:string,delta:number){
 const quantity=(inv.quantities[item]??0)+delta;
 if(!Number.isSafeInteger(quantity)||quantity<0||quantity>1000000000)throw new WorldError('Insufficient quantity or inventory capacity exceeded');
 inv.quantities[item]=quantity;
}
export function advanceWorld(before:WorldState,config:WorldConfig,toMinute:number,agents:string[],commitId:string){
 if(!Number.isSafeInteger(toMinute)||toMinute<before.minute||toMinute>1000000000)throw new WorldError('Invalid deterministic clock advancement');
 const state=structuredClone(before),events:any[]=[];
 for(const occurrence of schedule(config).filter(o=>o.minute<=toMinute&&!state.executed.includes(o.id))){
  events.push(...transformations.completeDue(state,config,occurrence.minute,agents,commitId));
  const {event,minute,id}=occurrence, recipients=agents.filter(id=>event.affectedAgentIds.includes(id)||event.locationId!==undefined&&state.positions[id]===event.locationId);
  // An invalid scheduled effect is recorded once without partially changing state.
  let status='committed',error:string|undefined;
  const effects:any[]=[];
  if(event.inventoryId){const inv=state.inventories.find(i=>i.id===event.inventoryId)!;const old=inv.quantities[event.itemId!]??0;try{if(event.quantityDelta!<0)transformations.ensureAvailable(state,inv.id,event.itemId!,-event.quantityDelta!);const next=old+event.quantityDelta!;if(config.items.find(i=>i.id===event.itemId)?.stackable===false&&next>1)throw new WorldError('Nonstackable inventory quantity exceeds one');if(!Number.isSafeInteger(next)||next<0||next>1000000000)throw new WorldError('Insufficient quantity or inventory capacity exceeded');transformations.validateScheduledStock(state,config,inv.id,event.itemId!,event.quantityDelta!);transformations.recordScheduledChange(state,`${commitId}:schedule:${id}`,minute,inv.id,event.itemId!,event.quantityDelta!);inv.quantities[event.itemId!]=next;effects.push({inventoryId:inv.id,itemId:event.itemId,before:old,after:inv.quantities[event.itemId!]});}catch(e){status='rejected';error=(e as Error).message;}}
  if(status==='committed'&&event.environmentKey){effects.push({environmentKey:event.environmentKey,before:state.environment[event.environmentKey]??null,after:event.value});state.environment[event.environmentKey]=event.value!;}
  state.executed.push(id);
  const record={id:`${commitId}:schedule:${id}`,type:'world_scheduled_event',occurrenceId:id,eventId:event.id,simulationMinute:minute,status,effects,...(error?{error}:{}),recipients};
  events.push(record);
  for(const agent of agents)if(recipients.includes(agent)){
   observe(state,`${record.id}:observation:${agent}`,minute,[agent],'scheduled_event',{eventId:event.id,status,text:status==='committed'?event.observation:'Scheduled effect rejected',effects,...(status==='committed'&&event.environmentKey?{environmentKey:event.environmentKey,value:event.value}:{})});
   if(event.wake||state.waits[agent]?.eventId===event.id)wake(state,agent,`event:${id}`);
  }
 }
 events.push(...transformations.completeDue(state,config,toMinute,agents,commitId));
 state.minute=toMinute;
 for(const id of agents)if(state.waits[id]?.untilMinute!==undefined&&state.waits[id].untilMinute!<=toMinute)wake(state,id,'scheduled_activity');
 state.revision++;
 events.push({id:`${commitId}:clock`,type:'world_clock_advanced',simulationMinute:toMinute,fromMinute:before.minute});
 return {state,events};
}
const reason={type:'string',minLength:1,maxLength:2000};
export const worldOperationsSchema={type:'array',maxItems:8,items:{anyOf:[
 ...transformations.operationSchemas,
 object({action:{enum:['inspect_inventory']},inventory_id:identifier,reason}),
 object({action:{enum:['take_item','deposit_item','transfer_item']},source_inventory_id:identifier,destination_inventory_id:identifier,item_id:identifier,quantity:{...integer,minimum:1},reason}),
 object({action:{enum:['consume_item']},inventory_id:identifier,item_id:identifier,quantity:{...integer,minimum:1},reason}),
 object({action:{enum:['wait']},reason}),
 object({action:{enum:['wait_until']},until_minute:integer,reason}),
 object({action:{enum:['wait_for_event']},event_id:identifier,reason})
]}};
export function configuredWorldActions(config?:Partial<WorldConfig>):string[]{
 if(!config?.enabled)return [];
 return worldOperationsSchema.items.anyOf.flatMap(schema=>schema.properties.action.enum).filter(action=>!!config.transformations||!transformations.isOperation(action));
}
const validateOperations=new Ajv({strict:false}).compile(worldOperationsSchema);
function canAccess(state:WorldState,inventory:Inventory,agent:string){return inventory.ownerType==='agent'?inventory.ownerId===agent:inventory.ownerId===state.positions[agent]&&state.positions[agent]!=='unspecified';}
function visible(state:WorldState,inventory:Inventory,agent:string){return inventory.visibility==='public'||inventory.authorizedAgentIds.includes(agent)||inventory.ownerType==='agent'&&inventory.ownerId===agent||inventory.visibility==='local'&&canAccess(state,inventory,agent);}
function withoutReasons(value:any):any {if(Array.isArray(value))return value.map(withoutReasons);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='reason').map(([key,v])=>[key,withoutReasons(v)]));return value;}
export function worldContext(state:WorldState,config:WorldConfig,agent:string,privateChannels=false){
 const location=state.positions[agent];
 return {simulationMinute:state.minute,simulationTime:formatSimulationTime(state.minute),locationId:location,
  colocatedAgents:config.observationPolicy==='local'&&location!=='unspecified'?Object.keys(state.positions).filter(id=>id!==agent&&state.positions[id]===location):[],
  transformationContext:transformations.context(state,config,agent),
  inventories:state.inventories.filter(i=>visible(state,i,agent)),items:config.items,
  observations:state.observations.filter(o=>o.recipients.includes(agent)).slice(-50).map(o=>privateChannels?withoutReasons(o):o),
  upcomingEvents:schedule(config).filter(o=>!state.executed.includes(o.id)&&(o.event.affectedAgentIds.includes(agent)||o.event.locationId===location)).slice(0,20).map(o=>({id:o.event.id,atMinute:o.minute})),wakeReasons:state.wakeReasons[agent]??[]};
}
function configInstructions(context:ReturnType<typeof worldContext>){return context.transformationContext?transformations.instructions+'\n':'';}
export function worldInstructions(context:ReturnType<typeof worldContext>){return `\n\nAuthoritative world observations (world facts, separate from beliefs or conversational reports):\n${JSON.stringify(context)}\n${configInstructions(context)}World interactions use world_operations, never claims in speech. Return [] for no interaction. inspect_inventory uses inventory_id. take_item moves from an accessible location inventory to your inventory; deposit_item reverses this; transfer_item moves between accessible inventories. Transfers require source_inventory_id, destination_inventory_id, item_id, positive integer quantity and reason. consume_item requires your inventory_id, a consumable item_id, quantity and reason. Private inventories require ownership or explicit authorization to inspect; physical transfers require colocation and access, even if publicly visible. Operational location changes precede inventory actions in the same transaction. wait requires only reason and waits for an addressed message, waking event, or researcher request. wait_until uses a future absolute until_minute; wait_for_event uses a known future event_id. In event_driven scheduling waiting suppresses inference until a deterministic wake; round_robin retains its original turns. Active social tasks require their original per-participant decision rounds even while waiting. Observations are evidence of committed effects; activity descriptions and claims alone do not prove work. Do not store formatting instructions as memory.`;}
export function prepareWorld(before:WorldState,config:WorldConfig,agent:string,operations:unknown,newLocation:string,agents:string[],commitId:string,speech:string,recipient:string|null,message?:any){
 if(!validateOperations(operations))throw new WorldError('Invalid world operation structure');
 const state=structuredClone(before),events:any[]=[];state.positions[agent]=newLocation;
 events.push(...transformations.interruptDepartures(state,config,agents,commitId));
 const inv=(id:string)=>{const result=state.inventories.find(i=>i.id===id);if(!result)throw new WorldError('Unknown inventory ID');transformations.checkWorkspaceAccess(config,id,agent);return result;};
 const proposals=operations as any[];
 for(const [index,op] of proposals.entries()){
  const id=`${commitId}:operation:${index}`,changes:any[]=[];
  if(!op.reason.trim())throw new WorldError('World operation reason must be nonempty');
  if(transformations.isOperation(op.action)){
   events.push(...transformations.applyOperation(state,config,agent,op,id));
  }else if(op.action==='inspect_inventory'){
   const inventory=inv(op.inventory_id);if(!visible(state,inventory,agent))throw new WorldError('Unauthorized inventory inspection');
   observe(state,`${id}:observation`,state.minute,[agent],'inventory_inspection',inventory);
  }else if(op.action==='wait'){
   state.waits[agent]={};
  }else if(op.action==='wait_until'){
   if(op.until_minute<=state.minute)throw new WorldError('Wait time must be in the future');state.waits[agent]={untilMinute:op.until_minute};
  }else if(op.action==='wait_for_event'){
   if(!schedule(config).some(o=>o.event.id===op.event_id&&!state.executed.includes(o.id)&&(o.event.affectedAgentIds.includes(agent)||o.event.locationId===state.positions[agent])))throw new WorldError('No eligible future event for this wait');state.waits[agent]={eventId:op.event_id};
  }else{
   const item=config.items.find(i=>i.id===op.item_id);if(!item)throw new WorldError('Unknown item ID');
   if(op.action==='consume_item'){
    const inventory=inv(op.inventory_id);if(inventory.ownerType!=='agent'||inventory.ownerId!==agent||!item.consumable)throw new WorldError('Consumption requires own inventory and a consumable item');
    transformations.ensureAvailable(state,inventory.id,item.id,op.quantity);const old=inventory.quantities[item.id]??0;checkedQuantity(inventory,item.id,-op.quantity);changes.push({inventoryId:inventory.id,itemId:item.id,before:old,after:inventory.quantities[item.id]});
   }else{
    const from=inv(op.source_inventory_id),to=inv(op.destination_inventory_id);
    const access=(i:Inventory)=>canAccess(state,i,agent)||i.ownerType==='agent'&&state.positions[agent]!=='unspecified'&&state.positions[i.ownerId]===state.positions[agent]&&i.authorizedAgentIds.includes(agent);
    if(from.id===to.id||!access(from)||!access(to)||!visible(state,from,agent)||!visible(state,to,agent))throw new WorldError('Transfer requires authorized accessible inventories at the current location');
    if(op.action==='take_item'&&(from.ownerType!=='location'||to.ownerType!=='agent'||to.ownerId!==agent)||op.action==='deposit_item'&&(from.ownerType!=='agent'||from.ownerId!==agent||to.ownerType!=='location'))throw new WorldError('Invalid take/deposit inventory ownership');
    transformations.ensureAvailable(state,from.id,item.id,op.quantity);const a=from.quantities[item.id]??0,b=to.quantities[item.id]??0;if(!item.stackable&&b+op.quantity>1)throw new WorldError('Nonstackable inventory quantity exceeds one');checkedQuantity(from,item.id,-op.quantity);checkedQuantity(to,item.id,op.quantity);
    changes.push({inventoryId:from.id,itemId:item.id,before:a,after:from.quantities[item.id]},{inventoryId:to.id,itemId:item.id,before:b,after:to.quantities[item.id]});
   }
   observe(state,`${id}:observation`,state.minute,[agent],'inventory_transaction',{transactionId:id,changes});
  }
  if(changes.length){const movement=transformations.recordMovement(state,{id,simulationMinute:state.minute,agentId:agent,operation:structuredClone(op),changes});if(movement)events.push(movement);}
  events.push({id,type:'world_operation',simulationMinute:state.minute,agentId:agent,requestedOperation:structuredClone(op),validation:'passed',status:'committed',changes});
 }
 delete state.wakeReasons[agent];state.lastAgentId=agent;
 const recipients=message!==undefined?(message?.recipientAgentIds??[]):agents.filter(id=>id!==agent&&(config.communicationPolicy==='global'||state.positions[id]===state.positions[agent]&&state.positions[agent]!=='unspecified')&&(!recipient||id===recipient));
 if(message===undefined&&speech&&recipient&&!recipients.includes(recipient))throw new WorldError('Communication recipient is not authorized by location policy');
 if(speech)for(const id of recipients){observe(state,`${commitId}:speech:${id}`,state.minute,[id],'agent_report',{agentId:agent,text:speech,verified:false,...(message?{messageId:message.messageId,channelId:message.channelId,scope:message.scope,recipientAgentIds:message.recipientAgentIds}:{})});if(recipient===id)wake(state,id,`addressed:${commitId}`);}
 const advanced=advanceWorld(state,config,state.minute+config.minutesPerTurn,agents,commitId);
 return {state:advanced.state,events:[...events,...advanced.events],recipients:speech?recipients:[]};
}
export function nextAgent(state:WorldState,config:WorldConfig,agents:string[],turnIndex:number,taskDecisionRequired=false){
 if(config.schedulingMode==='round_robin'||taskDecisionRequired)return agents[turnIndex%agents.length];
 const start=state.lastAgentId?agents.indexOf(state.lastAgentId)+1:0;
 return Array.from({length:agents.length},(_,i)=>agents[(start+i)%agents.length]).find(id=>!state.waits[id]);
}
export function nextWakeMinute(state:WorldState,config:WorldConfig){
 const future=[...transformations.deadlines(state),...Object.values(state.waits).flatMap(w=>w.untilMinute===undefined?[]:[w.untilMinute]),...schedule(config).filter(o=>!state.executed.includes(o.id)).map(o=>o.minute)];
 return future.length?Math.max(state.minute,Math.min(...future)):undefined;
}
export function visibleHistory(history:any[],agent:string,config?:WorldConfig){return history.filter(t=>t.completionSource!=='system_fallback').filter(t=>Object.hasOwn(t,'message') ? t.agentId===agent||t.message?.recipientAgentIds?.includes(agent) : !(config?.enabled&&config.communicationPolicy==='local')||t.agentId===agent||Array.isArray(t.messageRecipients)&&t.messageRecipients.includes(agent));}
export function worldHash(state:WorldState){return hash(state);}

/** Validate restored state against the chosen immutable world definition. Never coerce or repair it. */
export function assertWorldCompatible(state:WorldState,config:WorldConfig,agents:string[],locations:string[]){
 const validInteger=(value:number)=>Number.isSafeInteger(value)&&value>=0&&value<=1000000000;
 if(state.version!==1||!validInteger(state.minute)||!Number.isSafeInteger(state.revision)||state.revision<0||state.minute<config.initialMinute||hash(Object.keys(state.positions).sort())!==hash([...agents].sort())||Object.values(state.positions).some(id=>!locations.includes(id)))throw new WorldError('Restored world clock or participant positions are incompatible');
 if(!Array.isArray(state.inventories)||state.inventories.length!==config.inventories.length||new Set(state.inventories.map(i=>i.id)).size!==state.inventories.length)throw new WorldError('Restored world inventories differ from configuration');
 for(const inventory of state.inventories){
  const definition=config.inventories.find(i=>i.id===inventory.id);
  const {quantities,...metadata}=inventory;
  if(!definition||hash(metadata)!==hash((({quantities,...rest})=>rest)(definition))||Object.entries(quantities).some(([id,value])=>{const item=config.items.find(i=>i.id===id);return !item||!validInteger(value)||!item.stackable&&value>1;}))throw new WorldError('Restored inventory definitions or quantities are incompatible');
 }
 transformations.assertCompatible(state,config,agents);
 const occurrences=new Set(schedule(config).map(o=>o.id));
 if(!Array.isArray(state.executed)||new Set(state.executed).size!==state.executed.length||state.executed.some(id=>!occurrences.has(id)))throw new WorldError('Restored schedule execution history is incompatible');
 if(!state.waits||!state.wakeReasons||!Array.isArray(state.observations)||Object.keys(state.waits).some(id=>!agents.includes(id))||state.observations.some(o=>!Array.isArray(o.recipients)||o.recipients.some((id:string)=>!agents.includes(id))))throw new WorldError('Restored world observations or wait participants are incompatible');
}
