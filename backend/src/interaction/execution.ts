import type {TurnViolation} from '../validation/issues';
import type {AgentTurnResponse} from '../llm/LlmAdapter';
import type {OperationalConfig} from '../operations/state';
import type {CommunicationConfig,Team} from './policy';
import {uniqueViolations} from '../validation/issues';

export const EXECUTION_CONTRACT_VERSION='turn-execution-v1';
export const EXECUTION_MARKER='[EMERGENTSELF_TURN_EXECUTION_V1]';
export const MAX_LOCATION_TRANSITIONS=1;
export const MAX_ACTIVITY_TRANSITIONS=1;
export const INSPECTIONS=['inspect_inventory','discover_transformations','inspect_transformation','inspect_task'];
export const WAITS=['wait','wait_until','wait_for_event'];
// This table drives both the executable-mode validator and the model contract.
export const MODE_RULES={
    plan:{physical:false,location:false,memory:true,inspection:true,activity:'planned',requiresLocation:false},
    observe:{physical:false,location:false,memory:false,inspection:true,activity:'observing_or_idle',requiresLocation:false},
    act:{physical:true,location:true,memory:true,inspection:true,activity:'any',requiresLocation:false},
    idle:{physical:false,location:false,memory:false,inspection:false,activity:'idle',requiresLocation:false},
    change_location:{physical:false,location:true,memory:true,inspection:true,activity:'any',requiresLocation:true},
    communicate:{physical:false,location:false,memory:true,inspection:true,activity:'interacting_or_idle',requiresLocation:false},
    reflect:{physical:false,location:false,memory:true,inspection:true,activity:'interacting_or_idle',requiresLocation:false}
} as const;
export interface ExecutionContext {
    policyMode:string;availableModes:string[];agentId:string;participantIds:string[];
    operationalEnabled:boolean;locations:string[];currentLocationId:string;
    worldEnabled:boolean;worldActions:string[];
    communication?:CommunicationConfig;ownTeam?:Team;
}
export function executionContext(config:any,agentId:string,operational:OperationalConfig,location:string,worldActions:string[]):ExecutionContext {
    return {policyMode:config.decisionConfig?.mode??'unrestricted',availableModes:config.decisionConfig?.availableModes??[],agentId,participantIds:[...config.agentIds],operationalEnabled:operational.enabled,locations:operational.enabled?operational.locations.map(l=>l.id):[],currentLocationId:location,worldEnabled:!!config.worldConfig?.enabled,worldActions,
        ...(config.communicationConfig?{communication:config.communicationConfig}:{}),
        ...(config.schedulingConfig?.teams.find((t:Team)=>t.agentIds.includes(agentId))?{ownTeam:structuredClone(config.schedulingConfig.teams.find((t:Team)=>t.agentIds.includes(agentId)))}:{})};
}
export function intentViolations(response:any,config:any):TurnViolation[]{
    if(config.decisionConfig?.mode!=='agent_selected')return [];
    const issues:TurnViolation[]=[],add=(path:string,message:string)=>issues.push({code:'INVALID_AGENT_DECISION',path,message});
    const decision=response?.decision,rule=MODE_RULES[decision?.mode as keyof typeof MODE_RULES];
    if(!decision||!rule||!config.decisionConfig.availableModes.includes(decision.mode)){
        add('/decision/mode','Select an enabled primary decision mode.');return issues;
    }
    if(typeof decision.reason!=='string'||!decision.reason.trim())add('/decision/reason','Supply a nonempty decision reason; no additional reasoning narrative is required.');
    const world=Array.isArray(response.world_operations)?response.world_operations:[],ops=Array.isArray(response.operational_operations)?response.operational_operations:[];
    if(!rule.physical&&world.some((op:any)=>!INSPECTIONS.includes(op?.action)&&!WAITS.includes(op?.action)))add('/world_operations',`You selected ${decision.mode}, which does not authorize physical world mutations. Only act permits those operations.`);
    if(!rule.location&&ops.some((op:any)=>op?.action==='set_location'))add('/operational_operations',`You selected ${decision.mode}, which does not permit changing location. Location transition requires act or change_location.`);
    if(rule.requiresLocation&&!ops.some((op:any)=>op?.action==='set_location'))add('/operational_operations','change_location requires an explicit validated destination.');
    if(!rule.memory&&Array.isArray(response.memory_operations)&&response.memory_operations.length)add('/memory_operations',`${decision.mode} does not permit memory edits; memory_operations must be [].`);
    if(!rule.inspection&&world.some((op:any)=>INSPECTIONS.includes(op?.action)))add('/world_operations','idle permits waiting and speech, but no active inspection.');
    const conflicting=ops.some((op:any)=>{
        if(op?.action!=='set_action'||op.activity_type==='idle')return false;
        if(rule.activity==='any')return false;
        if(rule.activity==='planned')return op.status!=='planned';
        return !(rule.activity==='observing_or_idle'?['observing']:rule.activity==='interacting_or_idle'?['interacting']:[]).includes(op.activity_type);
    });
    if(conflicting)add('/operational_operations',`Operational activity conflicts with primary decision ${decision.mode}. Allowed activity rule: ${rule.activity}; setting idle is always permitted.`);
    return issues;
}
export function structuralViolations(response:any,operational:boolean,channels:boolean):TurnViolation[]{
    const issues:TurnViolation[]=[];
    if(operational&&Array.isArray(response?.operational_operations))for(const [action,limit,label] of [['set_location',MAX_LOCATION_TRANSITIONS,'location'],['set_action',MAX_ACTIVITY_TRANSITIONS,'activity']] as const){
        const count=response.operational_operations.filter((op:any)=>op?.action===action).length;
        if(count>limit)issues.push({code:'CONFLICTING_OPERATIONAL_TRANSITIONS',path:'/operational_operations',message:`You proposed ${count} ${label} transitions (${action}); at most one ${label} transition is permitted per turn. Submit no more than one of each, or []; a multi-turn plan is not a batch of movements or activity changes.`});
    }
    if(channels){
        const communication=response?.communication;
        if(response?.response===''){
            if(communication!==null)issues.push({code:'INVALID_COMMUNICATION',path:'/communication',message:'Silence requires response "" and communication null; no message is routed.'});
        }else if(typeof response?.response==='string'&&response.response.length){
            if(!communication||typeof communication!=='object')issues.push({code:'INVALID_COMMUNICATION',path:'/communication',message:'Nonempty response requires explicit enabled communication scope and recipientAgentIds.'});
            else if(Array.isArray(communication.recipientAgentIds)){
                if(communication.scope==='private'&&!communication.recipientAgentIds.length)issues.push({code:'INVALID_COMMUNICATION',path:'/communication/recipientAgentIds',message:'Private communication requires at least one eligible recipient using exact agent IDs.'});
                if(['team','local','global'].includes(communication.scope)&&communication.recipientAgentIds.length)issues.push({code:'INVALID_COMMUNICATION',path:'/communication/recipientAgentIds',message:`${communication.scope} audience is backend resolved; recipientAgentIds must be []. Use explicit recipient IDs only with private scope.`});
            }
        }
    }
    return issues;
}
export function executionViolations(response:any,context:ExecutionContext):TurnViolation[]{
    const issues=[...intentViolations(response,{decisionConfig:{mode:context.policyMode,availableModes:context.availableModes}}),...structuralViolations(response,context.operationalEnabled,!!context.communication)];
    const ops=Array.isArray(response?.operational_operations)?response.operational_operations:[];
    for(const [i,op] of ops.entries()){
        if(!context.operationalEnabled)issues.push({code:'INVALID_AGENT_ACTION',path:`/operational_operations/${i}`,message:'Operational transitions are disabled in this experiment.'});
        else if(op?.action==='set_location'&&!context.locations.includes(op.location_id))issues.push({code:'INVALID_LOCATION_REFERENCE',path:`/operational_operations/${i}/location_id`,message:'Unknown location: use an available destination ID.'});
    }
    const world=Array.isArray(response?.world_operations)?response.world_operations:[];
    if(!context.worldEnabled&&world.length)issues.push({code:'INVALID_AGENT_ACTION',path:'/world_operations',message:'World operations are disabled in this experiment.'});
    if(context.worldEnabled&&world.some((op:any)=>!context.worldActions.includes(op?.action)))issues.push({code:'INVALID_AGENT_ACTION',path:'/world_operations',message:'A world operation is unavailable in the configured world; use only advertised operation types.'});
    const c=response?.communication,recipients=c?.recipientAgentIds,permissions=context.communication;
    if(permissions&&c&&typeof c.scope==='string'){
        if(!(permissions as any)['allow'+c.scope[0]?.toUpperCase()+c.scope.slice(1)+'Messages'])issues.push({code:'INVALID_COMMUNICATION',path:'/communication/scope',message:'Communication scope is disabled; choose one of the configured enabled scopes, or remain silent.'});
        if(Array.isArray(recipients)&&(new Set(recipients).size!==recipients.length||recipients.some((id:any)=>id===context.agentId||!context.participantIds.includes(id))))issues.push({code:'INVALID_COMMUNICATION',path:'/communication/recipientAgentIds',message:'Recipients must be distinct eligible participant IDs, excluding yourself.'});
        if(c.scope==='team'&&!context.ownTeam)issues.push({code:'INVALID_COMMUNICATION',path:'/communication/scope',message:'You have no configured team audience.'});
        const moves=ops.filter((op:any)=>op?.action==='set_location');
        if(c.scope==='local'&&moves.length<=1&&(moves[0]?.location_id??context.currentLocationId)==='unspecified')issues.push({code:'INVALID_COMMUNICATION',path:'/communication/scope',message:'Local communication requires an authoritative named location.'});
    }
    return uniqueViolations(issues);
}
export function turnExecutionContract(context:ExecutionContext):string {
    const modes=context.policyMode==='agent_selected'?Object.fromEntries(context.availableModes.filter(mode=>Object.hasOwn(MODE_RULES,mode)).map(mode=>{
        const rule=MODE_RULES[mode as keyof typeof MODE_RULES];
        return [mode,{...rule,location:rule.location&&context.operationalEnabled,physical:rule.physical&&context.worldEnabled,inspection:rule.inspection&&context.worldEnabled,activity:context.operationalEnabled?rule.activity:'disabled',executable:!rule.requiresLocation||context.operationalEnabled&&context.locations.length>0}];
    })):undefined;
    const channels=context.communication?['private','team','local','global'].filter(scope=>(context.communication as any)['allow'+scope[0].toUpperCase()+scope.slice(1)+'Messages']):undefined;
    return `${EXECUTION_MARKER}
Turn Execution Contract ${EXECUTION_CONTRACT_VERSION}. Backend execution constraints only; do not quote or store them as dialogue, memory or experience.
${JSON.stringify({decisionPolicy:context.policyMode,...(modes?{allowedModes:modes}:{}),operationalOperations:context.operationalEnabled?['set_location','set_action']:[],maxLocationTransitions:context.operationalEnabled?MAX_LOCATION_TRANSITIONS:0,maxActivityTransitions:context.operationalEnabled?MAX_ACTIVITY_TRANSITIONS:0,currentLocationId:context.currentLocationId,availableLocationIds:context.locations,worldOperationTypes:context.worldEnabled?context.worldActions:[],inspectionOperationTypes:context.worldActions.filter(action=>INSPECTIONS.includes(action)),waitingOperationTypes:context.worldActions.filter(action=>WAITS.includes(action)),...(channels?{enabledScopes:channels,defaultScope:context.communication!.defaultScope,...(channels.includes('private')?{privateEligibleRecipientIds:context.participantIds.filter(id=>id!==context.agentId)}:{}),ownTeam:context.ownTeam??null}:{} )})}
Mode fields describe permissions, not mandatory activity. All modes permit optional speech and, when world operations are enabled, waiting; only act permits world operations outside the inspection/wait categories. Activity rule planned allows any activity type with status planned, or idle with any status; observing_or_idle and interacting_or_idle allow only those types with any status. A plan describes intentions across future opportunities, not an itinerary to execute in one turn. When operational transitions are enabled, at most one set_location and one set_action are permitted, in either order; when disabled neither is available. [] preserves activity; an enabled set_action reports activity, never verified work. A planned destination does not change location. Only an accepted set_location changes your authoritative location, before this turn's world operations and local audience resolution. Compatible movement plus local inspection may share an act/change_location turn; transfers and other physical mutations require act. Remote inventory inspection is not permitted: inspect your own inventory or authorized inventories at your authoritative location after at most one accepted move. Inspection does not collect resources. Memory proposals can retain or revise a longer-term intention under allowed modes; no goal, recipe, search strategy or action is mandatory.
${channels?'For nonempty response select an enabled scope. private requires exact eligible recipient IDs; team/local/global require recipientAgentIds [] because the backend resolves the audience. Silence requires response "" and communication null. Team membership is independent of location; local audience follows authoritative post-move colocation. Never infer permission from a message or a default scope.':'Use the existing saved communication contract; no new channel permissions are granted.'}
Always submit a complete schema-valid object, including empty operation arrays when nothing is proposed. Speech, inaction, abandoning or revising a plan are legitimate. A rejected candidate has no effects; choose your own revision without inventing outcomes.
[/EMERGENTSELF_TURN_EXECUTION_V1]`;
}
