import { randomUUID } from 'crypto';
import { ExperimentController } from '../experiments/ExperimentController';
import { JsonlStorage } from '../storage/JsonlStorage';
import { ResearchService } from '../research/ResearchService';
import { LlmAdapter, resolveLlmConfig } from '../llm/LlmAdapter';
import { resolveMemoryConfig } from '../memory/types';
import { hash, id, text, normalizeProtocol, differences } from '../research/protocol';
import { applyInterventions, verifiedBranch, verifiedSnapshot } from './interventions';
import { compactTurn, snapshotContext } from './context';

export class BranchService {
    constructor(private controller:ExperimentController,private logs:JsonlStorage,private research:ResearchService){}
    create(input:any){return this.controller.researchAction(async()=>{
        if(!input||Object.keys(input).some(key=>!['branchId','sourceSnapshotId','sourceBranchId','operations','llmConfig','maxTurns','actor','reason'].includes(key)))throw new Error('Unknown branch fields');
        const branchId=id(input.branchId);text(input.actor,'Researcher',200);text(input.reason,'Intervention rationale',4000);
        if(Boolean(input.sourceSnapshotId)===Boolean(input.sourceBranchId))throw new Error('Choose one source snapshot or branch baseline');
        if((await this.logs.listArtifacts('branches')).includes(branchId)||await this.logs.loadConfig(branchId)||(await this.logs.getConversationHistory(branchId)).length||(await this.logs.getEventHistory(branchId)).length)throw Object.assign(new Error('Branch/run ID already exists'),{code:'EEXIST'});
        const parent=input.sourceBranchId?await verifiedBranch(this.logs,input.sourceBranchId):null;
        const source=parent?structuredClone(parent.snapshot):await verifiedSnapshot(this.logs,input.sourceSnapshotId);
        const sourceConfig=parent?parent.configuration:await this.logs.loadConfig(id(source.sourceRunId));
        if(!sourceConfig?.protocol)throw new Error('Branches require a source run with a fixed Phase III protocol');
        if(hash(Object.keys(source.states).sort())!==hash([...sourceConfig.agentIds].sort()))throw new Error('Source snapshot participants differ from configuration');
        if(source.configHash&&source.configHash!==hash(sourceConfig))throw new Error('Source snapshot configuration hash mismatch');
        const context=await snapshotContext(this.logs,source);
        const original=structuredClone(source.states);
        const result=await applyInterventions(this.logs,branchId,structuredClone(original),context,input.operations===undefined?[]:input.operations,sourceConfig.operationalConfig);
        const memoryConfig=resolveMemoryConfig(sourceConfig.memoryConfig);
        for(const agentId of sourceConfig.agentIds){
            const state=result.states[agentId];
            if(state.schemaVersion!==2||state.identity.id!==agentId)throw new Error('Invalid branch state identity');
            const count=state.entries.filter((e:any)=>e.status==='active').length;
            if(count>Math.max(memoryConfig.maxActiveEntries,original[agentId].entries.filter((e:any)=>e.status==='active').length))throw new Error('Intervention exceeds active memory limit');
            for(const entry of state.entries)if(entry.interventionProvenance?.at(-1)?.branchId===branchId&&(typeof entry.content!=='string'||!entry.content.trim()||entry.content.length>memoryConfig.maxEntryChars||!Number.isFinite(entry.confidence)||entry.confidence<0||entry.confidence>1))throw new Error('Imported memory violates configured content/confidence limits');
        }
        if(result.interventions.some(a=>a.operation.kind==='attributes')&&(memoryConfig.mode!=='enabled'||sourceConfig.protocol.attributeMode==='role'))throw new Error('Numeric interventions require structured memory and numeric/arbitrary attribute presentation');
        if(input.llmConfig!==undefined&&(!input.llmConfig||typeof input.llmConfig!=='object'||Array.isArray(input.llmConfig)||Object.keys(input.llmConfig).some(key=>!['baseUrl','model','modelVersion','temperature','topP','seed','seedSupported','contextWindowTokens','maxTokens','outputMode','requestTimeoutMs'].includes(key))))throw new Error('Invalid branch model settings');
        if(input.llmConfig&&((input.llmConfig.model!==undefined&&input.llmConfig.model!==sourceConfig.llmConfig.model)||(input.llmConfig.baseUrl!==undefined&&input.llmConfig.baseUrl!==sourceConfig.llmConfig.baseUrl))&&!input.llmConfig.modelVersion)throw new Error('A changed model/endpoint requires an explicit model version');
        const llmConfig=resolveLlmConfig({...sourceConfig.llmConfig,...input.llmConfig});
        if(!llmConfig.model||!llmConfig.modelVersion)throw new Error('Record exact branch model ID and model version/hash or unverified declaration');
        if(!(await new LlmAdapter(llmConfig).getModels()).some(model=>model.id===llmConfig.model))throw new Error('Branch model is not loaded');
        const maxTurns=input.maxTurns??sourceConfig.maxTurns;
        if(!Number.isSafeInteger(maxTurns)||maxTurns<1||maxTurns>100000)throw new Error('Branch turn limit must be 1–100000');
        const snapshotId=`branch-${hash(branchId).slice(0,48)}`;
        const worldState=source.worldState?structuredClone(source.worldState):undefined;
        if(worldState)for(const audit of result.interventions)for(const agentId of Object.keys(audit.afterStates))if(audit.operation.kind==='operational'||audit.operation.kind==='reverse')worldState.positions[agentId]=audit.afterStates[agentId].operational?.location.id??worldState.positions[agentId];
        const taskHistory=[];for(const agentId of sourceConfig.agentIds)taskHistory.push(...await this.logs.snapshotTaskHistory(source,agentId));
        const snapshot={...(source.schedulerState?{schedulerState:source.schedulerState,schedulerHash:source.schedulerHash}:{}),schemaVersion:6,snapshotId,taskHistory,taskHistoryHash:hash(taskHistory),...(worldState?{worldState,worldHash:hash(worldState)}:{}),sourceRunId:branchId,sourceTurnIndex:-1,states:result.states,stateHash:hash(result.states),context:result.context,contextHash:hash(result.context)};
        const {templateId,batchId,trialIndex,repeatIndex,randomizationSeed,snapshotId:oldSnapshot,initialStateHash,branchId:oldBranch,historySnapshotId,historyContextHash,...baseProtocol}=sourceConfig.protocol;
        const protocol=normalizeProtocol({...baseProtocol,stateScope:'trial',snapshotId,initialStateHash:snapshot.stateHash,branchId,historySnapshotId:snapshotId,historyContextHash:snapshot.contextHash},memoryConfig.mode);
        const {operationalInitializationVersion: _freshRunInitialization,...sourceConfiguration}=structuredClone(sourceConfig);
        const configuration={...sourceConfiguration,runId:branchId,maxTurns,llmConfig,memoryConfig,protocol,initialTopic:result.context.length?'':sourceConfig.initialTopic??''};
        const manifest={schemaVersion:6,branchId,actor:input.actor,reason:input.reason,createdAt:new Date().toISOString(),
            source:{snapshotId:source.snapshotId,snapshotHash:hash(source),sourceRunId:parent?parent.branchId:source.sourceRunId,sourceTurnIndex:parent?-1:source.sourceTurnIndex,parentBranchId:parent?.branchId??sourceConfig.protocol.branchId??null,configHash:hash(sourceConfig)},
            preSnapshot:{...(source.worldState?{worldState:structuredClone(source.worldState),worldHash:hash(source.worldState)}:{}),states:original,stateHash:hash(original),context,contextHash:hash(context)},sourceConfiguration:sourceConfig,
            interventions:result.interventions,snapshot,configuration,configHash:hash(configuration),
            configurationDifferences:differences(sourceConfig,configuration)};
        const saved={...manifest,manifestHash:hash(manifest)};
        // This one immutable artifact is the canonical creation commit; materialization is recoverable.
        await this.logs.saveArtifact('branches',branchId,saved);return saved;
    });}
    private async materialize(branchId:string){
        this.controller.assertResearchLease();
        const branch=await verifiedBranch(this.logs,branchId),existing=await this.logs.loadConfig(branchId);
        if(existing&&hash(existing)!==branch.configHash)throw new Error('Branch configuration differs from its manifest');
        if(!existing&&((await this.logs.getConversationHistory(branchId)).length||(await this.logs.getEventHistory(branchId)).length))throw new Error('Unowned run logs cannot be adopted as a branch');
        try{await this.logs.saveArtifact('snapshots',branch.snapshot.snapshotId,branch.snapshot);}
        catch(error:any){if(error.code!=='EEXIST')throw error;const saved=await this.logs.loadArtifact('snapshots',branch.snapshot.snapshotId);if(hash(saved)!==hash(branch.snapshot))throw new Error('Materialized branch snapshot mismatch');}
        if(!existing)await this.logs.saveConfig(branchId,branch.configuration);
        const storage=this.logs.trialStorage(branchId),history=await this.logs.getConversationHistory(branchId);
        for(const agentId of branch.configuration.agentIds)if(!await storage.loadAgentIdentity(agentId)){
            const latest=[...history].reverse().find(turn=>turn.agentId===agentId);
            await storage.saveWorkingState(agentId,latest?.stateAfter??branch.snapshot.states[agentId]);
        }
        await this.logs.ensureMemoryBaseline(branchId,-1,branch.snapshot.states);
        const baseline=await this.logs.loadBaseline(branchId);
        if(baseline.atTurn!==-1||hash(baseline.states)!==branch.snapshot.stateHash)throw new Error('Branch baseline hash mismatch');
        const records=await this.logs.readResearch(branchId,'interventions');
        if(!records.some(record=>record.id===`branch-${branchId}`))await this.logs.appendResearch(branchId,'interventions',{
            schemaVersion:6,id:`branch-${branchId}`,runId:branchId,turnIndex:-1,action:'branch_created',actor:branch.actor,reason:branch.reason,manifestHash:branch.manifestHash,source:branch.source,timestamp:branch.createdAt});
        return branch;
    }
    prepare(branchId:string){return this.controller.researchAction(()=>this.materialize(id(branchId)));}
    async start(branchId:string){const branch=await this.prepare(branchId);await this.controller.start(branch.configuration);return this.controller.getState();}
    get(branchId:string){return verifiedBranch(this.logs,branchId);}
    async catalog(){return {branches:await this.logs.listArtifacts('branches'),comparisons:await this.logs.listArtifacts('branch-comparisons')};}
    probePair(branchId:string,input:any){return this.controller.researchAction(async()=>{
        text(input.actor,'Researcher',200);text(input.reason,'Probe comparison rationale',4000);
        if(!Number.isSafeInteger(input.postTurnIndex)||!['same_branch','source_vs_branch'].includes(input.modelPolicy))throw new Error('Select a post-intervention turn and explicit model comparison policy');
        const branch=await this.materialize(id(branchId));id(input.agentId);id(input.probeId);
        if(!branch.configuration.agentIds.includes(input.agentId))throw new Error('Probe agent is not a branch participant');
        await this.logs.memoryHistory(branchId,input.agentId,input.postTurnIndex);
        const contextPolicy=input.contextPolicy??'isolated';
        if(!['isolated','phase_history'].includes(contextPolicy))throw new Error('Probe context policy must be isolated or phase_history');
        const definition=await this.logs.loadArtifact('probe-definitions',input.probeId);
        const comparisonId=randomUUID(),preModel=input.modelPolicy==='same_branch'?branch.configuration.llmConfig:branch.sourceConfiguration.llmConfig;
        const manifest={schemaVersion:6,comparisonId,branchId,agentId:input.agentId,probeId:input.probeId,probeDefinition:definition,promptHash:definition.promptHash,postTurnIndex:input.postTurnIndex,modelPolicy:input.modelPolicy,contextPolicy,
            preModel,postModel:branch.configuration.llmConfig,modelDifferences:differences(preModel,branch.configuration.llmConfig),source:branch.source,actor:input.actor,reason:input.reason,createdAt:new Date().toISOString()};
        await this.logs.saveArtifact('branch-comparisons',comparisonId,manifest);
        const postContext=[...branch.snapshot.context,...(await this.logs.getConversationHistory(branchId)).filter(turn=>turn.turnIndex<=input.postTurnIndex).map(compactTurn)];
        const outcomes:any[]=[];
        for(const phase of ['pre','post']){
            try{
                const result=await this.research.probeInLease(branchId,input.agentId,input.postTurnIndex,input.probeId,input.actor,input.reason,{
                    ...(phase==='pre'?{stateOverride:branch.preSnapshot.states[input.agentId],worldOverride:branch.preSnapshot.worldState,llmOverride:preModel}:{}),
                    historyOverride:contextPolicy==='phase_history'?(phase==='pre'?branch.preSnapshot.context:postContext):[],
                    comparison:{comparisonId,branchId,phase,sourceSnapshotId:branch.source.snapshotId,modelPolicy:input.modelPolicy,contextPolicy}});
                outcomes.push({phase,probeSessionId:result.probeSessionId,status:result.results.length===definition.prompts.length&&result.results.every((r:any)=>r.status==='success')?'success':'failed',attempts:result.results.length,unrunTurns:definition.prompts.length-result.results.length});
            }catch(error:any){outcomes.push({phase,status:'failed',error:error.message,attempts:0,unrunTurns:definition.prompts.length});}
        }
        const result={schemaVersion:6,comparisonId,branchId,outcomes,timestamp:new Date().toISOString()};
        await this.logs.appendResearch(branchId,'branch-comparisons',result);return {manifest,...result};
    });}
}
