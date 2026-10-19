import type {WorldConfig,WorldState} from './simulation';
import {WorldError} from './simulation';
import Ajv from 'ajv';
import {hash} from '../research/protocol';

// Optional versioned extension. No normalization or rewriting of legacy worlds.
type Scalar=string|number|boolean;
type Requirement={itemId:string;quantity:number;consumeAt?:'start'|'completion'};
export interface Recipe {
 id:string;name:string;description:string;requiredLocation?:string;requiredCapabilities?:string[];
 inputs:Requirement[];requiredTools:Requirement[];catalysts:Requirement[];outputs:Requirement[];
 requiredEnvironment:Record<string,string>;environmentChanges:Record<string,string>;
 itemRequirements:Record<string,Record<string,Scalar>>;itemChanges:Record<string,Record<string,Scalar>>;
 durationMinutes:number;minParticipants:number;consumption:'completion'|'start';
 interruption:'continue'|'fail_if_participant_leaves';failurePolicy:'return_unconsumed';
}
export interface TransformationConfig {
 version:1;recipes:Recipe[];workspaces:{id:string;inventoryId:string;locationId:string;authorizedAgentIds:string[]}[];
 initialEnvironment:Record<string,string>;locationCapabilities:Record<string,string[]>;
 knowledgePolicy:'all'|'discover'|'verified';initialKnowledge:Record<string,string[]>;
}
interface Lot {id:string;quantity:number;origin:string;producerTaskId?:string;parents?:string[];}
interface Contribution {id:string;agentId:string;inventoryId:string;itemId:string;quantity:number;role:'input'|'tool'|'catalyst'|'target';consumed:boolean;released:boolean;consumedLots?:Lot[];}
export interface TransformationTask {
 id:string;recipeId:string;workspaceId:string;creatorId:string;participants:string[];
 status:'proposed'|'ready'|'in_progress'|'completed'|'failed'|'cancelled';
 contributions:Contribution[];createdMinute:number;startedMinute?:number;completionMinute?:number;finishedMinute?:number;failureReason?:string;
}
export interface TransformationState {version:1;tasks:TransformationTask[];knowledge:Record<string,string[]>;itemProperties:Record<string,Record<string,Scalar>>;ledger:any[];lots:Record<string,Record<string,Lot[]>>;}
const id={type:'string',pattern:'^[A-Za-z0-9_-]{1,120}$'};
const text={type:'string',minLength:1,maxLength:2000};
const integer={type:'integer',minimum:0,maximum:1000000000};
const object=(properties:any,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const list=(items:any,maxItems=100)=>({type:'array',maxItems,items});
const ids={...list(id),uniqueItems:true};
const scalar={anyOf:[{type:'string',maxLength:2000},{type:'number',minimum:-1000000000,maximum:1000000000},{type:'boolean'}]};
const map=(values:any)=>({type:'object',propertyNames:id,additionalProperties:values});
const properties=map(scalar),environment=map({type:'string',maxLength:1000});
export const itemPropertiesSchema={description:text,category:text,durability:integer,condition:text,properties,usageRoles:ids,provenance:text};
const requirements=list(object({itemId:id,quantity:{...integer,minimum:1}}));
export const recipeSchema=object({id,name:text,description:text,requiredLocation:id,requiredCapabilities:ids,
 inputs:list(object({itemId:id,quantity:{...integer,minimum:1},consumeAt:{enum:['start','completion']}},['itemId','quantity'])),requiredTools:requirements,catalysts:requirements,outputs:requirements,requiredEnvironment:environment,environmentChanges:environment,
 itemRequirements:map(properties),itemChanges:map(properties),durationMinutes:integer,minParticipants:{...integer,minimum:1,maximum:100},
 consumption:{enum:['completion','start']},interruption:{enum:['continue','fail_if_participant_leaves']},failurePolicy:{const:'return_unconsumed'}
},['id','name','description','inputs','requiredTools','catalysts','outputs','requiredEnvironment','environmentChanges','itemRequirements','itemChanges','durationMinutes','minParticipants','consumption','interruption','failurePolicy']);
export const configSchema=object({version:{const:1},recipes:list(recipeSchema),workspaces:list(object({id,inventoryId:id,locationId:id,authorizedAgentIds:ids})),initialEnvironment:environment,locationCapabilities:map(ids),knowledgePolicy:{enum:['all','discover','verified']},initialKnowledge:map(ids)});
const reason=text;
export const operationSchemas=[
 object({action:{enum:['discover_transformations']},reason}),
 object({action:{enum:['inspect_transformation']},transformation_id:id,reason}),
 object({action:{enum:['propose_transformation']},transformation_id:id,task_id:id,workspace_id:id,reason}),
 object({action:{enum:['join_transformation','start_transformation','cancel_transformation','inspect_task']},task_id:id,reason}),
 object({action:{enum:['contribute_transformation']},task_id:id,inventory_id:id,item_id:id,quantity:{...integer,minimum:1},role:{enum:['input','tool','catalyst','target']},reason}),
 object({action:{enum:['teach_transformation']},transformation_id:id,recipient_id:id,reason})
];
export const isOperation=(action:string)=>operationSchemas.some(s=>s.properties.action.enum.includes(action));
function fail(code:string,message:string):never {throw new WorldError(message,code);}
function definition(config:WorldConfig){if(!config.transformations)fail('TRANSFORMATION_NOT_FOUND','No transformation extension configured');return config.transformations;}
function extension(state:WorldState){if(!state.transformations)fail('INVALID_TASK_STATE','Transformation state missing');return state.transformations;}
function recipe(config:WorldConfig,id:string){const r=definition(config).recipes.find(r=>r.id===id);if(!r)fail('TRANSFORMATION_NOT_FOUND',`Unknown transformation ${id}`);return r;}
function workspace(config:WorldConfig,id:string){const w=definition(config).workspaces.find(w=>w.id===id);if(!w)fail('INVALID_TASK_STATE',`Unknown workspace ${id}`);return w;}
function task(state:WorldState,id:string){const t=extension(state).tasks.find(t=>t.id===id);if(!t)fail('INVALID_TASK_STATE',`Unknown task ${id}`);return t;}
function inventory(state:WorldState,id:string){const i=state.inventories.find(i=>i.id===id);if(!i)fail('UNAUTHORIZED_RESOURCE_ACCESS',`Unknown inventory ${id}`);return i;}
function unique(entries:{id:string}[],label:string){if(new Set(entries.map(x=>x.id)).size!==entries.length)fail('INVALID_TASK_STATE',`Duplicate ${label} ID`);}
export function validateConfig(config:WorldConfig,agents:string[],locations:string[]){
 const c=definition(config),items=new Map(config.items.map(i=>[i.id,i]));unique(c.recipes,'recipe');unique(c.workspaces,'workspace');
 const envKeys=new Set([...Object.keys(c.initialEnvironment),...config.events.flatMap(e=>e.environmentKey?[e.environmentKey]:[]),...c.recipes.flatMap(r=>Object.keys(r.environmentChanges))]);
 for(const [loc,caps] of Object.entries(c.locationCapabilities))if(!locations.includes(loc)||new Set(caps).size!==caps.length)fail('WRONG_LOCATION','Invalid capability location');
 for(const w of c.workspaces){const inv=config.inventories.find(i=>i.id===w.inventoryId);if(!inv||inv.ownerType!=='location'||inv.ownerId!==w.locationId||!locations.includes(w.locationId)||w.authorizedAgentIds.length===0||w.authorizedAgentIds.some(a=>!agents.includes(a)))fail('UNAUTHORIZED_RESOURCE_ACCESS','Workspace requires a local inventory and valid authorized participants');}
 if(new Set(c.workspaces.map(w=>w.inventoryId)).size!==c.workspaces.length)fail('INVALID_TASK_STATE','Workspace inventory must be unique');
 // Stable item identity is represented by a nonstackable catalog entry, not cloned objects.
 for(const item of config.items)if(!item.stackable&&config.inventories.reduce((n,i)=>n+(i.quantities[item.id]??0),0)>1&&c.recipes.some(r=>Object.hasOwn(r.itemChanges,item.id)))fail('INVALID_TASK_STATE','Modified targets require globally unique nonstackable item IDs');
 for(const r of c.recipes){
  if(r.requiredLocation&&!locations.includes(r.requiredLocation)||r.minParticipants>agents.length)fail('WRONG_LOCATION','Invalid recipe location or participant count');
  if(r.requiredCapabilities?.some(cap=>!Object.values(c.locationCapabilities).some(caps=>caps.includes(cap))))fail('WRONG_LOCATION','Unknown required capability');
  for(const group of [r.inputs,r.requiredTools,r.catalysts,r.outputs]){if(new Set(group.map(x=>x.itemId)).size!==group.length)fail('INVALID_TASK_STATE','Duplicate recipe resource');for(const q of group){const item=items.get(q.itemId);if(!item||!Number.isSafeInteger(q.quantity)||q.quantity<=0||!item.stackable&&q.quantity!==1)fail('MISSING_REQUIRED_INPUT','Invalid item reference or quantity');}}
  const consumed=new Set(r.inputs.map(x=>x.itemId)),reused=[...r.requiredTools,...r.catalysts];
  if(reused.some(x=>consumed.has(x.itemId))||new Set(reused.map(x=>x.itemId)).size!==reused.length)fail('INVALID_TASK_STATE','Input, tool and catalyst roles must be disjoint');
  for(const key of Object.keys(r.requiredEnvironment))if(!envKeys.has(key))fail('ENVIRONMENT_REQUIREMENT_NOT_MET',`Undefined environmental key ${key}`);
  for(const key of new Set([...Object.keys(r.itemRequirements),...Object.keys(r.itemChanges)])){
   const item=items.get(key);if(!item||item.stackable||consumed.has(key)||r.outputs.some(x=>x.itemId===key))fail('INVALID_TASK_STATE','Property targets require existing unique reusable nonstackable items');
   for(const [prop,value] of Object.entries({...r.itemRequirements[key],...r.itemChanges[key]})){const initial=initialProperties(item)[prop];if(prop==='durability'&&(!Number.isSafeInteger(value)||Number(value)<0)||prop==='condition'&&(typeof value!=='string'||!value.trim())||initial===undefined||typeof initial!==typeof value)fail('INVALID_TASK_STATE',`Unknown or incompatible typed property ${key}.${prop}`);}
  }
  if(config.initialMinute+r.durationMinutes>1000000000)fail('INVALID_TASK_STATE','Recipe duration exceeds clock');
 }
 for(const [agent,known] of Object.entries(c.initialKnowledge))if(!agents.includes(agent)||known.some(id=>!c.recipes.some(r=>r.id===id)))fail('TRANSFORMATION_NOT_FOUND','Invalid initial recipe knowledge');
}
function initialProperties(item:WorldConfig['items'][number]):Record<string,Scalar>{return {...(item.properties??{}),...(item.durability===undefined?{}:{durability:item.durability}),...(item.condition===undefined?{}:{condition:item.condition})};}
export function initialState(config:WorldConfig,agents:string[]):TransformationState {
 const c=definition(config);return {version:1,tasks:[],knowledge:Object.fromEntries(agents.map(a=>[a,c.knowledgePolicy==='all'?c.recipes.map(r=>r.id):[...(c.initialKnowledge[a]??[])]])),itemProperties:Object.fromEntries(config.items.map(i=>[i.id,{...(i.properties??{}),...(i.durability===undefined?{}:{durability:i.durability}),...(i.condition===undefined?{}:{condition:i.condition})}])),ledger:[],lots:Object.fromEntries(config.inventories.map(inv=>[inv.id,Object.fromEntries(Object.entries(inv.quantities).map(([item,quantity])=>[item,quantity?[{id:`initial:${inv.id}:${item}`,quantity,origin:`initial inventory ${inv.id} owned by ${inv.ownerId}`}]:[]]))]))};
}
const active=(t:TransformationTask)=>['proposed','ready','in_progress'].includes(t.status);
export function reserved(state:WorldState,inventoryId:string,itemId:string){return (state.transformations?.tasks??[]).filter(active).flatMap(t=>t.contributions).filter(c=>!c.released&&!c.consumed&&c.inventoryId===inventoryId&&c.itemId===itemId).reduce((n,c)=>n+c.quantity,0);}
export function ensureAvailable(state:WorldState,inventoryId:string,itemId:string,quantity:number){
 if(!state.transformations)return;
 const total=inventory(state,inventoryId).quantities[itemId]??0;
 if(total<quantity)fail('INSUFFICIENT_ITEM_QUANTITY',`Insufficient quantity: inventory ${inventoryId} has ${total} ${itemId}, needs ${quantity}`);
 if(total-reserved(state,inventoryId,itemId)<quantity)fail('RESOURCE_ALREADY_RESERVED',`${itemId} in ${inventoryId} is reserved for another task`);
}
function emit(state:WorldState,id:string,type:string,minute:number,task:TransformationTask|undefined,agentId:string|undefined,data:any){
 const e={id,type,simulationMinute:minute,...(task?{taskId:task.id,recipeId:task.recipeId}:{}),...(agentId?{agentId}:{}),source:'authoritative_world',...structuredClone(data)};
 extension(state).ledger.push(e);return e;
}
function observe(state:WorldState,event:any,recipients:string[]){state.observations.push({id:event.id+':observation',simulationMinute:event.simulationMinute,recipients:[...recipients],kind:event.type,source:'authoritative_world',data:structuredClone(event)});}
function authorize(state:WorldState,config:WorldConfig,t:TransformationTask,agent:string){const w=workspace(config,t.workspaceId);if(!w.authorizedAgentIds.includes(agent))fail('UNAUTHORIZED_RESOURCE_ACCESS','Agent is not authorized for this workspace');if(state.positions[agent]!==w.locationId)fail('WRONG_LOCATION',`Task requires location ${w.locationId}`);return w;}
function mutable(t:TransformationTask){if(t.status==='completed')fail('TASK_ALREADY_COMPLETED','Task is already completed');if(!active(t))fail('INVALID_TASK_STATE',`Task is ${t.status}`);}
function required(r:Recipe,role:Contribution['role']):Requirement[]{return role==='input'?r.inputs:role==='tool'?r.requiredTools:role==='catalyst'?r.catalysts:Object.keys({...r.itemRequirements,...r.itemChanges}).filter(id=>![...r.requiredTools,...r.catalysts].some(q=>q.itemId===id)).map(itemId=>({itemId,quantity:1}));}
function resourcesReady(t:TransformationTask,r:Recipe){return (['input','tool','catalyst','target'] as const).every(role=>required(r,role).every(q=>t.contributions.filter(c=>c.role===role&&c.itemId===q.itemId&&!c.released).reduce((n,c)=>n+c.quantity,0)===q.quantity));}
function prerequisites(state:WorldState,config:WorldConfig,t:TransformationTask,r:Recipe){
 const w=workspace(config,t.workspaceId);
 for(const contribution of t.contributions){const inv=inventory(state,contribution.inventoryId);if(inv.ownerType==='agent'&&state.positions[inv.ownerId]!==w.locationId)fail('REQUIRED_TOOL_UNAVAILABLE','Contributed resource is not at the workspace');}
 if(r.requiredLocation&&w.locationId!==r.requiredLocation||r.requiredCapabilities?.some(cap=>!definition(config).locationCapabilities[w.locationId]?.includes(cap)))fail('WRONG_LOCATION','Workspace lacks required recipe location or capabilities');
 for(const target of Object.keys({...r.itemRequirements,...r.itemChanges}))if(state.inventories.reduce((n,i)=>n+(i.quantities[target]??0),0)!==1)fail('REQUIRED_TOOL_UNAVAILABLE',`Target ${target} must exist exactly once`);
 if(t.participants.length<r.minParticipants)fail('MISSING_REQUIRED_INPUT',`Requires ${r.minParticipants} explicit participants`);
 for(const a of t.participants)authorize(state,config,t,a);
 for(const [key,value] of Object.entries(r.requiredEnvironment))if(state.environment[key]!==value)fail('ENVIRONMENT_REQUIREMENT_NOT_MET',`Requires environment ${key}=${value}`);
 for(const [item,props] of Object.entries(r.itemRequirements))for(const [key,value] of Object.entries(props))if(extension(state).itemProperties[item]?.[key]!==value)fail('ENVIRONMENT_REQUIREMENT_NOT_MET',`Requires ${item}.${key}=${value}`);
 for(const q of [...r.requiredTools,...r.catalysts])if(t.contributions.filter(c=>c.itemId===q.itemId&&!c.released).reduce((n,c)=>n+c.quantity,0)!==q.quantity)fail('REQUIRED_TOOL_UNAVAILABLE',`Contribute reusable tool or catalyst ${q.itemId} (${q.quantity})`);
 if(!resourcesReady(t,r))fail('MISSING_REQUIRED_INPUT','Contribute exact required inputs, reusable tools, catalysts and modification targets before starting');
}
export function applyOperation(state:WorldState,config:WorldConfig,agent:string,op:any,id:string){
 const c=definition(config),s=extension(state),events:any[]=[];
 const learn=(who:string,r:string)=>{if(!s.knowledge[who].includes(r))s.knowledge[who].push(r);};
 if(op.action==='discover_transformations'){
  const available=c.knowledgePolicy==='verified'?c.recipes.filter(r=>s.knowledge[agent].includes(r.id)):c.recipes;
  if(c.knowledgePolicy==='discover')for(const r of available)learn(agent,r.id);
  const e=emit(state,id,'transformation_discovery',state.minute,undefined,agent,{recipes:available});observe(state,e,[agent]);return [e];
 }
 if(op.action==='inspect_transformation'||op.action==='teach_transformation'||op.action==='propose_transformation'){
  const r=recipe(config,op.transformation_id);
  if(!s.knowledge[agent].includes(r.id)){if(c.knowledgePolicy==='discover'&&op.action==='inspect_transformation')learn(agent,r.id);else fail('TRANSFORMATION_NOT_FOUND','Recipe not known: inspect/discover or learn through a verified operation first');}
  if(op.action==='inspect_transformation'){const e=emit(state,id,'transformation_inspected',state.minute,undefined,agent,{recipe:r});observe(state,e,[agent]);return [e];}
  if(op.action==='teach_transformation'){
   if(!s.knowledge[op.recipient_id]||state.positions[agent]==='unspecified'||state.positions[op.recipient_id]!==state.positions[agent])fail('UNAUTHORIZED_RESOURCE_ACCESS','Teaching requires a known colocated recipient');
   learn(op.recipient_id,r.id);const e=emit(state,id,'transformation_taught',state.minute,undefined,agent,{recipe:r,recipientId:op.recipient_id});observe(state,e,[agent,op.recipient_id]);return [e];
  }
  if(s.tasks.length>=10000)fail('INVALID_TASK_STATE','Maximum 10,000 transformation tasks per run');
  if(s.tasks.some(t=>t.id===op.task_id))fail('INVALID_TASK_STATE','Task ID already exists; inspect existing task');
  const t:TransformationTask={id:op.task_id,recipeId:r.id,workspaceId:op.workspace_id,creatorId:agent,participants:[agent],status:'proposed',contributions:[],createdMinute:state.minute};authorize(state,config,t,agent);s.tasks.push(t);
  const e=emit(state,id,'transformation_proposed',state.minute,t,agent,{after:t});observe(state,e,[agent]);return [e];
 }
 const t=task(state,op.task_id),r=recipe(config,t.recipeId),w=authorize(state,config,t,agent);
 if(op.action==='inspect_task'){const e=emit(state,id,'transformation_inspected',state.minute,t,agent,{task:t});observe(state,e,[agent]);return [e];}
 mutable(t);const before=structuredClone(t);
 if(op.action==='join_transformation'){
  if(t.status==='in_progress')fail('INVALID_TASK_STATE','Cannot join a running task');if(!t.participants.includes(agent))t.participants.push(agent);
 }else{
  if(!t.participants.includes(agent))fail('UNAUTHORIZED_RESOURCE_ACCESS','Join task explicitly before contributing or starting');
  if(op.action==='contribute_transformation'){
   if(t.status==='in_progress')fail('INVALID_TASK_STATE','Task resources are frozen after starting');
   checkWorkspaceAccess(config,op.inventory_id,agent);const inv=inventory(state,op.inventory_id);
   if(!(inv.ownerType==='agent'?inv.ownerId===agent:inv.ownerId===state.positions[agent]&&inv.visibility!=='private' || inv.ownerType==='location'&&inv.ownerId===state.positions[agent]&&inv.authorizedAgentIds.includes(agent)))fail('UNAUTHORIZED_RESOURCE_ACCESS','Contribute only your own inventory or authorized local shared resources');
   const q=required(r,op.role).find(q=>q.itemId===op.item_id),already=t.contributions.filter(x=>x.itemId===op.item_id&&x.role===op.role).reduce((n,x)=>n+x.quantity,0);
   if(!q||already+op.quantity>q.quantity)fail('MISSING_REQUIRED_INPUT','Contribution is not required or exceeds exact recipe quantity');
   ensureAvailable(state,inv.id,op.item_id,op.quantity);
   t.contributions.push({id,agentId:agent,inventoryId:inv.id,itemId:op.item_id,quantity:op.quantity,role:op.role,consumed:false,released:false});
   events.push(emit(state,id+':reservation','resource_reserved',state.minute,t,agent,{inventoryId:inv.id,itemId:op.item_id,quantity:op.quantity,ownerId:inv.ownerId}));
  }else if(op.action==='start_transformation'){
   if(t.status==='in_progress')fail('INVALID_TASK_STATE','Task already running');prerequisites(state,config,t,r);
   if(state.minute+r.durationMinutes>1000000000)fail('INVALID_TASK_STATE','Completion time exceeds clock range');
   t.status='in_progress';t.startedMinute=state.minute;t.completionMinute=state.minute+r.durationMinutes;
   events.push(...consumeInputs(state,t,state.minute,id,r,'start'));
  }else if(op.action==='cancel_transformation'){
   if(agent!==t.creatorId)fail('UNAUTHORIZED_RESOURCE_ACCESS','Only the task creator may cancel');
   t.status='cancelled';t.finishedMinute=state.minute;events.push(...release(state,t,state.minute,id));
  }
 }
 if(t.status==='proposed'||t.status==='ready')t.status=resourcesReady(t,r)&&t.participants.length>=r.minParticipants?'ready':'proposed';
 const e=emit(state,id,'transformation_'+op.action.replace('_transformation',''),state.minute,t,agent,{requestedOperation:op,before,after:t});events.push(e);observe(state,e,t.participants);
 // Immediate recipes commit inside the same transaction.
 events.push(...completeDue(state,config,state.minute,Object.keys(state.positions),id));return events;
}
function consumeInputs(state:WorldState,t:TransformationTask,minute:number,id:string,r:Recipe,phase:'start'|'completion'){
 const events:any[]=[];for(const c of t.contributions.filter(c=>c.role==='input'&&!c.consumed&&(phase==='completion'||(r.inputs.find(q=>q.itemId===c.itemId)?.consumeAt??r.consumption)==='start'))){
  const inv=inventory(state,c.inventoryId),before=inv.quantities[c.itemId]??0;if(before<c.quantity)fail('INSUFFICIENT_ITEM_QUANTITY','Reserved input is missing');inv.quantities[c.itemId]=before-c.quantity;c.consumed=true;c.consumedLots=withdrawLots(state,inv.id,c.itemId,c.quantity);
  events.push(emit(state,id+':consume:'+c.id,'transformation_input_consumed',minute,t,c.agentId,{contributionId:c.id,inventoryId:inv.id,itemId:c.itemId,before,after:inv.quantities[c.itemId],quantity:c.quantity,lots:c.consumedLots}));
 }return events;
}
function release(state:WorldState,t:TransformationTask,minute:number,id:string){return t.contributions.filter(c=>!c.released).map(c=>{c.released=true;return emit(state,id+':release:'+c.id,'resource_released',minute,t,c.agentId,{contributionId:c.id,inventoryId:c.inventoryId,itemId:c.itemId,quantity:c.quantity,consumed:c.consumed});});}
export function checkWorkspaceAccess(config:WorldConfig,inventoryId:string,agent:string){
 const w=config.transformations?.workspaces.find(w=>w.inventoryId===inventoryId);if(w&&!w.authorizedAgentIds.includes(agent))fail('UNAUTHORIZED_RESOURCE_ACCESS','Workspace inventory is not authorized for this agent');
}
export function interruptDepartures(state:WorldState,config:WorldConfig,agents:string[],commitId:string){
 if(!state.transformations)return [];const events:any[]=[];
 for(const t of state.transformations.tasks.filter(t=>t.status==='in_progress')){
  const r=recipe(config,t.recipeId),w=workspace(config,t.workspaceId);
  const missingParticipant=r.interruption==='fail_if_participant_leaves'&&t.participants.some(a=>state.positions[a]!==w.locationId);
  const missingResource=t.contributions.some(c=>!c.consumed&&inventory(state,c.inventoryId).ownerType==='agent'&&state.positions[inventory(state,c.inventoryId).ownerId]!==w.locationId);
  if(!missingParticipant&&!missingResource)continue;
  const before=structuredClone(t);t.status='failed';t.failureReason=missingResource?'Reserved resource owner left the workspace':'Required participant left the workspace';t.finishedMinute=state.minute;
  const id=commitId+':task:'+t.id+':interrupted';events.push(...release(state,t,state.minute,id));
  const e=emit(state,id,'transformation_failed',state.minute,t,undefined,{before,after:t,failureReason:t.failureReason});events.push(e);observe(state,e,t.participants);
  for(const a of t.participants){delete state.waits[a];(state.wakeReasons[a]??=[]).push('task:'+t.id+':failed');}
 }
 return events;
}
export function deadlines(state:WorldState){return (state.transformations?.tasks??[]).filter(t=>t.status==='in_progress').map(t=>t.completionMinute!);}
export function completeDue(state:WorldState,config:WorldConfig,toMinute:number,agents:string[],commitId:string){
 if(!state.transformations)return [];const events:any[]=[];
 for(const t of [...state.transformations.tasks].filter(t=>t.status==='in_progress'&&t.completionMinute!<=toMinute).sort((a,b)=>a.completionMinute!-b.completionMinute!||(a.id<b.id?-1:1))){
  const r=recipe(config,t.recipeId),w=workspace(config,t.workspaceId),minute=t.completionMinute!,id=`${commitId}:task:${t.id}:finish`,before=structuredClone(t);
  let failure:string|undefined;
  // Tools/targets stay physically available and participants can be required to remain.
  if(r.interruption==='fail_if_participant_leaves'&&t.participants.some(a=>state.positions[a]!==w.locationId))failure='Required participant left the workspace';
  for(const [key,value] of Object.entries(r.requiredEnvironment))if(state.environment[key]!==value)failure=`Environment changed: ${key}`;
  for(const [item,props] of Object.entries(r.itemRequirements))for(const [key,value] of Object.entries(props))if(extension(state).itemProperties[item]?.[key]!==value)failure=`Target changed: ${item}.${key}`;
  for(const c of t.contributions)if(!c.consumed){const inv=inventory(state,c.inventoryId);if((inv.quantities[c.itemId]??0)<c.quantity)failure='Reserved resource no longer available';if(inv.ownerType==='agent'&&state.positions[inv.ownerId]!==w.locationId)failure='Reserved resource owner left the workspace';}
  const out=inventory(state,w.inventoryId);
  for(const q of r.outputs){const item=config.items.find(i=>i.id===q.itemId)!;const next=(out.quantities[q.itemId]??0)+q.quantity;if(next>1000000000||!item.stackable&&state.inventories.reduce((n,i)=>n+(i.quantities[q.itemId]??0),0)+q.quantity>1)failure='Output capacity exceeded';}
  if(failure){t.status='failed';t.failureReason=failure;}else{
   events.push(...consumeInputs(state,t,minute,id,r,'completion'));
   for(const q of r.outputs){const old=out.quantities[q.itemId]??0;out.quantities[q.itemId]=old+q.quantity;const lot:Lot={id:id+':lot:'+q.itemId,quantity:q.quantity,origin:'transformation',producerTaskId:t.id,parents:t.contributions.flatMap(c=>(c.consumedLots??[]).map(l=>l.id))};addLots(state,out.id,q.itemId,[lot]);events.push(emit(state,id+':output:'+q.itemId,'transformation_output_produced',minute,t,undefined,{inventoryId:out.id,itemId:q.itemId,before:old,after:out.quantities[q.itemId],quantity:q.quantity,lot,contributions:t.contributions}));}
   for(const [item,props] of Object.entries(r.itemChanges)){const old=structuredClone(extension(state).itemProperties[item]);Object.assign(extension(state).itemProperties[item],props);events.push(emit(state,id+':item:'+item,'transformation_item_modified',minute,t,undefined,{itemId:item,before:old,after:extension(state).itemProperties[item]}));}
   for(const [key,value] of Object.entries(r.environmentChanges)){const old=state.environment[key]??null;state.environment[key]=value;events.push(emit(state,id+':environment:'+key,'transformation_environment_modified',minute,t,undefined,{key,before:old,after:value}));}
   t.status='completed';
  }
  t.finishedMinute=minute;events.push(...release(state,t,minute,id));
  const recipients=agents.filter(a=>t.participants.includes(a)||config.observationPolicy==='local'&&state.positions[a]===w.locationId);
  const e=emit(state,id,'transformation_'+t.status,minute,t,undefined,{before,after:t,...(failure?{failureReason:failure}:{outputs:r.outputs,itemChanges:r.itemChanges,environmentChanges:r.environmentChanges})});events.push(e);observe(state,e,recipients);
  for(const a of recipients){if(t.status==='completed'&&!extension(state).knowledge[a].includes(r.id))extension(state).knowledge[a].push(r.id);delete state.waits[a];(state.wakeReasons[a]??=[]).push(`task:${t.id}:${t.status}`);}
 }
 return events;
}
function addLots(state:WorldState,inventoryId:string,itemId:string,lots:Lot[]){
 const items=extension(state).lots[inventoryId]??={};const existing=items[itemId]??=[];
 for(const lot of lots){const same=existing.find(l=>l.id===lot.id);if(same)same.quantity+=lot.quantity;else existing.push(structuredClone(lot));}
}
function withdrawLots(state:WorldState,inventoryId:string,itemId:string,quantity:number):Lot[]{
 const lots=extension(state).lots[inventoryId]?.[itemId]??[];
 if(lots.reduce((n,l)=>n+l.quantity,0)<quantity)fail('INVALID_TASK_STATE','Inventory provenance does not match authoritative quantity');
 let remaining=quantity;const taken:Lot[]=[];
 for(const lot of lots){const amount=Math.min(lot.quantity,remaining);if(amount){taken.push({...structuredClone(lot),quantity:amount});lot.quantity-=amount;remaining-=amount;}if(!remaining)break;}
 extension(state).lots[inventoryId][itemId]=lots.filter(l=>l.quantity>0);return taken;
}
export function validateScheduledStock(state:WorldState,config:WorldConfig,inventoryId:string,itemId:string,delta:number){
 if(!state.transformations)return;
 const old=inventory(state,inventoryId).quantities[itemId]??0;
 const lots=extension(state).lots[inventoryId]?.[itemId]??[];
 if(lots.reduce((n,l)=>n+l.quantity,0)!==old)fail('INVALID_TASK_STATE','Scheduled inventory provenance does not match quantity');
 if(definition(config).recipes.some(r=>Object.hasOwn(r.itemChanges,itemId))&&state.inventories.reduce((n,i)=>n+(i.quantities[itemId]??0),0)+delta>1)fail('INVALID_TASK_STATE','Scheduled effect would duplicate a stable modification target');
}
export function recordScheduledChange(state:WorldState,eventId:string,minute:number,inventoryId:string,itemId:string,delta:number){
 if(!state.transformations)return;
 const lots=delta<0?withdrawLots(state,inventoryId,itemId,-delta):delta>0?[{id:eventId+':lot',quantity:delta,origin:'scheduled event '+eventId}]:[];
 if(delta>0)addLots(state,inventoryId,itemId,lots);
 emit(state,eventId+':provenance','scheduled_inventory_change',minute,undefined,undefined,{inventoryId,itemId,delta,lots});
}
export function recordMovement(state:WorldState,event:any){
 if(!state.transformations)return;const op=event.operation;
 const lots=withdrawLots(state,op.action==='consume_item'?op.inventory_id:op.source_inventory_id,op.item_id,op.quantity);
 if(op.action!=='consume_item')addLots(state,op.destination_inventory_id,op.item_id,lots);
 const record={...structuredClone(event),id:event.id+':provenance',type:op.action==='consume_item'?'item_consumed':'inventory_movement',source:'authoritative_world',lots};state.transformations.ledger.push(record);return record;
}
export function context(state:WorldState,config:WorldConfig,agent:string){
 if(!config.transformations||!state.transformations)return undefined;
 const c=config.transformations,s=state.transformations,known=s.knowledge[agent]??[],workspaces=c.workspaces.filter(w=>w.authorizedAgentIds.includes(agent)&&w.locationId===state.positions[agent]);
 const accessibleTasks=s.tasks.filter(t=>workspaces.some(w=>w.id===t.workspaceId)||t.participants.includes(agent));
 const visibleItems=new Set(state.inventories.filter(i=>i.ownerType==='agent'?i.ownerId===agent||i.authorizedAgentIds.includes(agent):i.ownerId===state.positions[agent]&&i.visibility!=='private'||i.authorizedAgentIds.includes(agent)).flatMap(i=>Object.keys(i.quantities)));
 return {knownRecipes:c.recipes.filter(r=>known.includes(r.id)),discoverableRecipeIds:c.knowledgePolicy==='verified'?known:c.recipes.map(r=>r.id),workspaces,tasks:accessibleTasks,itemProperties:Object.fromEntries(Object.entries(s.itemProperties).filter(([id])=>visibleItems.has(id)))};
}
export const instructions=`Transformation transport guide (not conversational content or memory): recipes are immutable backend rules; describing work does not execute it. Use discover_transformations (reason) or inspect_transformation (transformation_id, reason). propose_transformation requires a new stable task_id, known transformation_id and workspace_id. join_transformation explicitly consents to participation. contribute_transformation reserves inventory_id/item_id/quantity with role input, tool, catalyst or target; only your own or authorized local shared resources may be contributed. Never invent resources or take another agent's private supplies. start_transformation uses task_id after all exact contributions and participants are ready. inspect_task and cancel_transformation use task_id; only creator can cancel. teach_transformation uses a known transformation_id and colocated recipient_id. All operations require reason. Completion follows simulation time, not dialogue. Tools and catalysts are released, inputs are consumed according to the recipe; cancelling cannot restore already consumed inputs. Task outputs enter the configured shared workspace inventory; use ordinary inventory operations to receive and consume them. No recipe rules may be created through speech.`;
const persistedArray=(items:any)=>({type:'array',items});
const lotSchema=object({id:text,quantity:{...integer,minimum:1},origin:text,producerTaskId:id,parents:persistedArray(text)},['id','quantity','origin']);
const contributionSchema=object({id:text,agentId:id,inventoryId:id,itemId:id,quantity:{...integer,minimum:1},role:{enum:['input','tool','catalyst','target']},consumed:{type:'boolean'},released:{type:'boolean'},consumedLots:persistedArray(lotSchema)},['id','agentId','inventoryId','itemId','quantity','role','consumed','released']);
export const taskStateSchema=object({version:{const:1},tasks:list(object({id,recipeId:id,workspaceId:id,creatorId:id,participants:ids,status:{enum:['proposed','ready','in_progress','completed','failed','cancelled']},contributions:persistedArray(contributionSchema),createdMinute:integer,startedMinute:integer,completionMinute:integer,finishedMinute:integer,failureReason:text},['id','recipeId','workspaceId','creatorId','participants','status','contributions','createdMinute']),10000),knowledge:map(ids),itemProperties:map(properties),ledger:{type:'array',items:{type:'object'}},lots:map(map(persistedArray(lotSchema)))});
const checkState=new Ajv({strict:false}).compile(taskStateSchema);
export function assertCompatible(state:WorldState,config:WorldConfig,agents:string[]){
 if(!config.transformations){if(state.transformations)fail('INVALID_TASK_STATE','Unexpected transformation state');return;}
 const s=extension(state);if(!checkState(s))fail('INVALID_TASK_STATE','Restored transformation extension fails version-1 schema');if(s.version!==1||!Array.isArray(s.tasks)||!Array.isArray(s.ledger)||new Set(s.tasks.map(t=>t.id)).size!==s.tasks.length)fail('INVALID_TASK_STATE','Invalid restored transformation state');
 if(hash(Object.keys(s.knowledge).sort())!==hash([...agents].sort()))fail('INVALID_TASK_STATE','Restored knowledge participants differ');
 for(const known of Object.values(s.knowledge))if(!Array.isArray(known)||new Set(known).size!==known.length||known.some(id=>!config.transformations!.recipes.some(r=>r.id===id)))fail('INVALID_TASK_STATE','Invalid restored knowledge');
 for(const t of s.tasks){const r=recipe(config,t.recipeId);workspace(config,t.workspaceId);if(!['proposed','ready','in_progress','completed','failed','cancelled'].includes(t.status)||!agents.includes(t.creatorId)||!Array.isArray(t.participants)||new Set(t.participants).size!==t.participants.length||t.participants.some(a=>!agents.includes(a))||!Number.isSafeInteger(t.createdMinute)||t.createdMinute>state.minute)fail('INVALID_TASK_STATE','Invalid restored task');
  if(t.status==='in_progress'&&(!Number.isSafeInteger(t.completionMinute)||t.completionMinute!==t.startedMinute!+r.durationMinutes))fail('INVALID_TASK_STATE','Invalid restored completion deadline');
  if(!t.participants.includes(t.creatorId)||t.participants.some(a=>!workspace(config,t.workspaceId).authorizedAgentIds.includes(a)))fail('INVALID_TASK_STATE','Restored task authorization differs');
  if(t.status==='in_progress'&&!resourcesReady(t,r))fail('INVALID_TASK_STATE','Running task lacks required resources');
  if(!active(t)&&t.contributions.some(c=>!c.released))fail('INVALID_TASK_STATE','Terminal task has unreleased resources');
  for(const c of t.contributions)if(!agents.includes(c.agentId)||!t.participants.includes(c.agentId)||!Number.isSafeInteger(c.quantity)||c.quantity<=0||!required(r,c.role).some(q=>q.itemId===c.itemId)||!state.inventories.some(i=>i.id===c.inventoryId))fail('INVALID_TASK_STATE','Invalid restored contribution');
 }
 if(hash(Object.keys(s.itemProperties).sort())!==hash(config.items.map(i=>i.id).sort()))fail('INVALID_TASK_STATE','Restored item property catalog differs');
 if(Object.keys(s.lots).some(id=>!state.inventories.some(i=>i.id===id))||Object.values(s.lots).some(items=>Object.keys(items).some(id=>!config.items.some(i=>i.id===id))))fail('INVALID_TASK_STATE','Unknown restored provenance inventory or item');
 for(const inv of state.inventories)for(const item of config.items){const lots=s.lots[inv.id]?.[item.id]??[];if(lots.reduce((n,l)=>n+l.quantity,0)!==(inv.quantities[item.id]??0)||new Set(lots.map(l=>l.id)).size!==lots.length)fail('INVALID_TASK_STATE','Restored provenance quantities differ');}
 for(const inv of state.inventories)for(const item of config.items)if(reserved(state,inv.id,item.id)>(inv.quantities[item.id]??0))fail('RESOURCE_ALREADY_RESERVED','Restored reservations exceed inventory');
 for(const [item,props] of Object.entries(s.itemProperties)){const original=config.items.find(i=>i.id===item);if(!original||!props||hash(Object.keys(props).sort())!==hash(Object.keys(initialProperties(original)).sort())||Object.entries(props).some(([k,v])=>typeof v!==typeof initialProperties(original)[k]||k==='durability'&&(!Number.isSafeInteger(v)||Number(v)<0)||k==='condition'&&(typeof v!=='string'||!v.trim())))fail('INVALID_TASK_STATE','Invalid restored typed item properties');}
}
