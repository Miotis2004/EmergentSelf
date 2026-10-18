import {resolveOperational, prepareOperational} from '../operations/state';
import { hash, id } from '../research/protocol';
import { JsonlStorage } from '../storage/JsonlStorage';
import { snapshotContext } from './context';

function same(a:any,b:any){return hash(a)===hash(b);}
function selected(state:any,entryIds:any){
    if(!Array.isArray(entryIds)||!entryIds.length||entryIds.length>100||new Set(entryIds).size!==entryIds.length)throw new Error('Select 1–100 distinct memory IDs');
    return entryIds.map(entryId=>{const entry=state.entries.find((e:any)=>e.id===entryId&&e.status==='active');if(!entry)throw new Error('Selected active memory does not belong to this agent');return structuredClone(entry);});
}
export async function verifiedBranch(logs:JsonlStorage,branchId:string){
    const record=await logs.loadArtifact('branches',id(branchId));const {manifestHash,...data}=record;
    if(record.snapshot.worldState&&hash(record.snapshot.worldState)!==record.snapshot.worldHash)throw new Error('Branch world hash mismatch');
    if(hash(data)!==manifestHash||hash(record.snapshot.states)!==record.snapshot.stateHash||hash(record.snapshot.context)!==record.snapshot.contextHash)throw new Error('Branch manifest hash mismatch');
    return record;
}
export async function verifiedSnapshot(logs:JsonlStorage,snapshotId:string){
    const snapshot=await logs.loadArtifact('snapshots',id(snapshotId));
    if(snapshot.worldState&&hash(snapshot.worldState)!==snapshot.worldHash)throw new Error('Snapshot world hash mismatch');
    if(hash(snapshot.states)!==snapshot.stateHash)throw new Error('Snapshot state hash mismatch');return snapshot;
}
export async function applyInterventions(logs:JsonlStorage,branchId:string,states:any,context:any[],operations:any[],operationalConfig?:any){
    if(!Array.isArray(operations)||operations.length>20)throw new Error('At most 20 interventions per branch');
    let currentContext=structuredClone(context);const audits:any[]=[];
    const state=(agentId:string)=>{id(agentId);if(!Object.hasOwn(states,agentId))throw new Error('Intervention agent is not a branch participant');return states[agentId];};
    for(const [index,op] of operations.entries()){
        if(!op||typeof op!=='object'||Array.isArray(op))throw new Error('Invalid intervention');
        const allowed:Record<string,string[]>={operational:['kind','agentId','operations'],withhold:['kind','agentId','entryIds'],restore:['kind','agentId','fromBranchId','operationIndex','entryIds'],transplant:['kind','agentId','donorSnapshotId','donorAgentId','entryIds','relationshipMap'],swap:['kind','agentId','otherAgentId','entryIds','otherEntryIds','relationshipMap','otherRelationshipMap'],attributes:['kind','agentId','values'],history:['kind','mode','donorSnapshotId'],reverse:['kind','fromBranchId','operationIndex']};
        if(!allowed[op.kind]||Object.keys(op).some(key=>!allowed[op.kind].includes(key)))throw new Error('Unknown intervention kind or fields');
        const beforeStates:any=Object.create(null),beforeContext=structuredClone(currentContext),details:any={};
        const capture=(agentId:string)=>{const s=state(agentId);if(!Object.hasOwn(beforeStates,agentId))beforeStates[agentId]=structuredClone(s);return s;};
        const insert=(targetId:string,entries:any[],origin:any,relationshipMap:any={})=>{
            if(!relationshipMap||typeof relationshipMap!=='object'||Array.isArray(relationshipMap)||Object.values(relationshipMap).some(subject=>typeof subject!=='string'||!Object.hasOwn(states,subject)))throw new Error('Relationship mapping must name branch participants');
            const target=capture(targetId);
            const imported=entries.map((entry,j)=>{
                const copy=structuredClone(entry);copy.id=`iv-${hash(branchId).slice(0,20)}-${index}-${targetId}-${j}`;
                if(target.entries.some((e:any)=>e.id===copy.id))throw new Error('Imported memory ID collision');
                if(copy.type==='relationship'){
                    copy.relationship_agent_id=relationshipMap[copy.relationship_agent_id]??copy.relationship_agent_id;
                    if(copy.relationship_agent_id===targetId||!Object.hasOwn(states,copy.relationship_agent_id))throw new Error('Imported relationship requires an explicit valid subject mapping');
                }
                copy.interventionProvenance=[...(copy.interventionProvenance??[]),{...origin,entryId:entry.id,branchId,operationIndex:index}];return copy;
            });
            target.entries.push(...imported);return imported;
        };
        if(op.kind==='withhold'){
            const target=capture(op.agentId),removed=selected(target,op.entryIds);details.removed=removed;
            target.entries=target.entries.filter((e:any)=>!op.entryIds.includes(e.id));
        }else if(op.kind==='restore'){
            const previous=await verifiedBranch(logs,op.fromBranchId),audit=previous.interventions[op.operationIndex];
            if(!Number.isSafeInteger(op.operationIndex)||audit?.operation.kind!=='withhold'||audit.operation.agentId!==op.agentId)throw new Error('Restore must reference a withholding operation for this agent');
            const target=capture(op.agentId),entries=selected({entries:audit.details.removed},op.entryIds);
            if(entries.some((entry:any)=>target.entries.some((e:any)=>e.id===entry.id)))throw new Error('Restore would overwrite an existing memory ID');
            target.entries.push(...entries);
            const order=new Map(audit.beforeStates[op.agentId].entries.map((entry:any,index:number)=>[entry.id,index]));
            target.entries.sort((a:any,b:any)=>Number(order.get(a.id)??Infinity)-Number(order.get(b.id)??Infinity));details.restored=entries;
        }else if(op.kind==='transplant'){
            const donor=await verifiedSnapshot(logs,op.donorSnapshotId);
            if(!Object.hasOwn(donor.states,id(op.donorAgentId)))throw new Error('Donor agent not found in snapshot');
            const entries=selected(donor.states[op.donorAgentId],op.entryIds);
            details.donor={snapshotId:op.donorSnapshotId,stateHash:donor.stateHash,agentId:op.donorAgentId,entries};
            details.inserted=insert(op.agentId,entries,{donorSnapshotId:op.donorSnapshotId,donorAgentId:op.donorAgentId},op.relationshipMap);
        }else if(op.kind==='swap'){
            if(op.agentId===op.otherAgentId)throw new Error('Swap requires two different participants');
            const left=capture(op.agentId),right=capture(op.otherAgentId);
            const a=selected(left,op.entryIds),b=selected(right,op.otherEntryIds);details.removed={[op.agentId]:a,[op.otherAgentId]:b};
            left.entries=left.entries.filter((e:any)=>!op.entryIds.includes(e.id));right.entries=right.entries.filter((e:any)=>!op.otherEntryIds.includes(e.id));
            details.inserted={[op.agentId]:insert(op.agentId,b,{donorAgentId:op.otherAgentId},op.relationshipMap),[op.otherAgentId]:insert(op.otherAgentId,a,{donorAgentId:op.agentId},op.otherRelationshipMap)};
        }else if(op.kind==='attributes'){
            const target=capture(op.agentId);
            if(!op.values||typeof op.values!=='object'||Array.isArray(op.values)||!Object.keys(op.values).length)throw new Error('Provide named numeric attributes');
            for(const [key,value] of Object.entries(op.values)){
                if(!Object.hasOwn(target.identity.stats,key)||typeof value!=='number'||!Number.isFinite(value)||value<0||value>10)throw new Error('Attribute must be an existing stat with a finite value 0–10');
                target.identity.stats[key].current=value;
            }
        }else if(op.kind==='operational'){
            const target=capture(op.agentId);
            const result=prepareOperational(target,op.operations,resolveOperational(operationalConfig),{runId:branchId,turnIndex:-1,eventId:`intervention-${index}`});
            if(result.error)throw new Error(result.error);
            states[op.agentId]=result.state;details.operationalAudit=result.audit;
        }else if(op.kind==='history'){
            if(op.mode==='clear')currentContext=[];
            else if(op.mode==='replace'){
                const donor=await verifiedSnapshot(logs,op.donorSnapshotId);
                if(!same(Object.keys(donor.states).sort(),Object.keys(states).sort()))throw new Error('Replacement history must have the same participants');
                currentContext=await snapshotContext(logs,donor);details.donorContextHash=hash(currentContext);
            }else throw new Error('History intervention mode must be clear or replace');
        }else if(op.kind==='reverse'){
            const previous=await verifiedBranch(logs,op.fromBranchId),audit=previous.interventions[op.operationIndex];
            if(!Number.isSafeInteger(op.operationIndex)||!audit)throw new Error('Unknown intervention to reverse');
            for(const agentId of Object.keys(audit.afterStates)){
                const current=capture(agentId);if(!same(current,audit.afterStates[agentId]))throw new Error('Reverse precondition failed: agent state has diverged');
                states[agentId]=structuredClone(audit.beforeStates[agentId]);
            }
            if(audit.contextChanged){if(!same(currentContext,audit.afterContext))throw new Error('Reverse precondition failed: history has diverged');currentContext=structuredClone(audit.beforeContext);}
        }
        const contextChanged=!same(beforeContext,currentContext);
        audits.push({index,operation:structuredClone(op),beforeStates,afterStates:Object.fromEntries(Object.keys(beforeStates).map(agentId=>[agentId,structuredClone(states[agentId])])),
            contextChanged,...(contextChanged?{beforeContext,afterContext:structuredClone(currentContext)}:{}),details});
    }
    return {states,context:currentContext,interventions:audits};
}
