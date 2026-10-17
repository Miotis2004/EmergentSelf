import { resolveEnvironment } from '../social/environment';
import { randomUUID } from 'crypto';
import type { ExperimentConfig, ExperimentController } from '../experiments/ExperimentController';
import { normalizeInitialTopic } from '../experiments/ExperimentController';
import { JsonStorage } from '../storage/JsonStorage';
import { JsonlStorage } from '../storage/JsonlStorage';
import { LlmAdapter, LlmError, resolveLlmConfig } from '../llm/LlmAdapter';
import { resolveMemoryConfig, WorkingState } from '../memory/types';
import { CONDITIONS, differences, hash, id, normalizeProtocol, renderProtocol, seed, shuffled, text } from './protocol';

export class ResearchService {
    constructor(private controller: ExperimentController, private logs: JsonlStorage, private storage: JsonStorage) {}
    private async note(runId: string, actor: string, reason: string, action: string, details: any = {}) {
        if (!await this.logs.loadConfig(id(runId))) throw new Error('Unknown run');
        const history = await this.logs.getConversationHistory(runId);
        const record = { schemaVersion: 3, id: randomUUID(), runId, turnIndex: history.length - 1,
            actor: text(actor, 'Researcher', 200), reason: text(reason, 'Reason'), action, details, timestamp: new Date().toISOString() };
        await this.logs.appendResearch(runId, 'interventions', record); return record;
    }
    intervene(runId: string, actor: string, reason: string) {
        return this.controller.researchAction(() => this.note(runId, actor, reason, 'note'));
    }
    private async saveSnapshot(snapshotId: string, states: Record<string, WorkingState>, source: any) {
        const record = { schemaVersion: 3, snapshotId: id(snapshotId), capturedAt: new Date().toISOString(), ...source, stateHash: hash(states), states };
        await this.logs.saveArtifact('snapshots', snapshotId, record); return record;
    }
    snapshot(snapshotId: string, runId: string, turnIndex: number, actor: string, reason: string) {
        return this.controller.researchAction(async () => {
            if (!Number.isSafeInteger(turnIndex)) throw new Error('Select an integer source turn');
            const config = await this.logs.loadConfig(id(runId));
            if (!config) throw new Error('Unknown run');
            const states: Record<string, WorkingState> = Object.create(null);
            for (const agentId of config.agentIds) states[agentId] = (await this.logs.memoryHistory(runId, agentId, turnIndex)).state;
            // Validate attribution before creating the artifact.
            text(actor, 'Researcher', 200); text(reason, 'Reason');
            const result = await this.saveSnapshot(snapshotId, states, {sourceRunId:runId, sourceTurnIndex:turnIndex});
            await this.note(runId, actor, reason, 'snapshot', {snapshotId,sourceTurnIndex:turnIndex}); return result;
        });
    }
    clone(snapshotId: string, sourceAgentId: string, targetAgentId: string, actor: string, reason: string) {
        return this.controller.researchAction(async () => {
            const snapshot = await this.logs.loadArtifact('snapshots', id(snapshotId));
            if (hash(snapshot.states) !== snapshot.stateHash || !Object.hasOwn(snapshot.states, id(sourceAgentId))) throw new Error('Invalid snapshot or source agent');
            id(targetAgentId); text(actor,'Researcher',200); text(reason,'Reason');
            const state = structuredClone(snapshot.states[sourceAgentId]); state.identity.id = targetAgentId;
            const provenance = {snapshotId, sourceAgentId, targetAgentId, sourceRunId:snapshot.sourceRunId, sourceTurnIndex:snapshot.sourceTurnIndex, actor, reason};
            state.provenance = provenance;
            await this.storage.createClone(targetAgentId, state);
            // Provenance is in the atomic clone state even if the secondary note fails.
            if (snapshot.sourceRunId) await this.note(snapshot.sourceRunId, actor, reason, 'clone', provenance);
            return provenance;
        });
    }
    template(templateId: string, input: ExperimentConfig) {
        return this.controller.researchAction(async () => {
            id(templateId);
            if (!input || typeof input !== 'object') throw new Error('Template configuration is required');
            if (!Array.isArray(input.agentIds) || input.agentIds.length < 2 || new Set(input.agentIds).size !== input.agentIds.length) throw new Error('Select at least two distinct agents');
            if (!Number.isSafeInteger(input.maxTurns) || input.maxTurns < 1 || input.maxTurns > 100000) throw new Error('Invalid maximum turns');
            const llmConfig = resolveLlmConfig(input.llmConfig);
            if (!llmConfig.model) throw new Error('Templates require an exact selected model ID');
            if (!llmConfig.modelVersion) throw new Error('Record model version/hash, or explicitly mark it unverified');
            const models = await new LlmAdapter(llmConfig).getModels();
            if (!models.some(model => model.id === llmConfig.model)) throw new Error('Selected model is not loaded');
            const memoryConfig = resolveMemoryConfig(input.memoryConfig);
            const environment = resolveEnvironment(input);
            const states: Record<string, WorkingState> = Object.create(null);
            let source: any = {sourceRunId:null,sourceTurnIndex:null};
            if (input.protocol?.snapshotId) {
                const snapshot=await this.logs.loadArtifact('snapshots',id(input.protocol.snapshotId));
                if (hash(snapshot.states)!==snapshot.stateHash || hash(Object.keys(snapshot.states).sort())!==hash([...input.agentIds].sort())) throw new Error('Snapshot state/participant mismatch');
                Object.assign(states,snapshot.states);
                source={sourceRunId:snapshot.sourceRunId,sourceTurnIndex:snapshot.sourceTurnIndex,parentSnapshotId:snapshot.snapshotId};
            } else for (const agentId of input.agentIds) states[id(agentId)] = await this.storage.loadWorkingState(agentId);
            const snapshotId = `${templateId}-start`; id(snapshotId);
            const protocol = normalizeProtocol({...input.protocol, stateScope:'trial', snapshotId, initialStateHash:hash(states),templateId},memoryConfig.mode);
            if (protocol.attributeMode === 'role' && input.agentIds.some(agentId => !Object.hasOwn(protocol.roles, agentId))) throw new Error('Each participant requires a role description');
            const { runId, ...configuration } = { ...input, agentIds:[...input.agentIds], initialTopic:normalizeInitialTopic(input.initialTopic), llmConfig, memoryConfig, ...((input.socialConfig || input.taskConfig || input.feedbackConfig) ? environment : {}), protocol };
            const template = {schemaVersion:3,templateId,createdAt:new Date().toISOString(),configuration,configurationHash:hash(configuration)};
            // Snapshot-first failures leave an explicit artifact, never overwrite data.
            await this.saveSnapshot(snapshotId,states,source);
            await this.logs.saveArtifact('templates',templateId,template); return template;
        });
    }
    batch(batchId: string, templateId: string, repeats: number, conditions: string[], randomizationSeed: number, randomizeParticipants = false, feedbackConditions?: ('off'|'configured')[]) {
        return this.controller.researchAction(async () => {
            id(batchId); seed(randomizationSeed);
            if ((await this.logs.listArtifacts('batches')).includes(batchId)) throw Object.assign(new Error('EEXIST: batch ID already exists'),{code:'EEXIST'});
            if (!Number.isSafeInteger(repeats) || repeats < 1 || !Array.isArray(conditions) || !conditions.length || repeats * conditions.length > 100 || new Set(conditions).size !== conditions.length || conditions.some(c=>!CONDITIONS.includes(c as any))) throw new Error('Choose distinct conditions and 1–100 total trials');
            if (typeof randomizeParticipants !== 'boolean') throw new Error('Participant randomization must be a boolean');
            const template = await this.logs.loadArtifact('templates',id(templateId));
            if (hash(template.configuration) !== template.configurationHash) throw new Error('Template hash mismatch');
            const feedbackArms = feedbackConditions ?? ['configured'];
            if(!Array.isArray(feedbackArms)||!feedbackArms.length||new Set(feedbackArms).size!==feedbackArms.length||feedbackArms.some(arm=>!['off','configured'].includes(arm))||repeats*conditions.length*feedbackArms.length>100)throw new Error('Select distinct feedback arms and at most 100 total trials');
            if(feedbackConditions?.includes('configured')&&!resolveEnvironment(template.configuration).feedbackConfig.enabled)throw new Error('Configured feedback arm requires a feedback-enabled template');
            const assignments = shuffled(Array.from({length:repeats},(_,repeatIndex)=>conditions.flatMap(condition=>feedbackArms.map(feedbackArm=>({condition,repeatIndex,feedbackArm})))).flat(),randomizationSeed);
            const trials = assignments.map(({condition,repeatIndex,feedbackArm},trialIndex)=> {
                const configuration = structuredClone(template.configuration);
                const runId = id(`${batchId}-${trialIndex+1}`);
                configuration.memoryConfig.mode = condition;
                if(feedbackConditions)configuration.feedbackConfig={...resolveEnvironment(configuration).feedbackConfig,enabled:feedbackArm==='configured'};
                configuration.agentIds = randomizeParticipants ? shuffled(configuration.agentIds,(randomizationSeed+repeatIndex)>>>0) : configuration.agentIds;
                configuration.protocol = normalizeProtocol({...configuration.protocol, condition, batchId,trialIndex,repeatIndex,randomizationSeed},condition as any);
                return {runId,...configuration};
            });
            // Preflight all IDs before making the immutable manifest.
            for (const trial of trials) if (await this.logs.loadConfig(trial.runId) || (await this.logs.getConversationHistory(trial.runId)).length || (await this.logs.getEventHistory(trial.runId)).length) throw new Error(`Run ID already exists: ${trial.runId}`);
            const manifest = {schemaVersion:3,batchId,templateId,randomizationSeed,randomizeParticipants,...(feedbackConditions?{feedbackConditions}:{}),createdAt:new Date().toISOString(),trials};
            await this.logs.saveArtifact('batches',batchId,manifest);
            return manifest;
        });
    }
    async startTrial(batchId: string, runId: string) {
        const manifest = await this.logs.loadArtifact('batches',id(batchId));
        const config = manifest.trials.find((trial: any)=>trial.runId===id(runId));
        if (!config) throw new Error('Run is not a member of this batch');
        await this.controller.start(config); return this.controller.getState();
    }
    defineProbe(probeId: string, prompts: string[]) {
        return this.controller.researchAction(async()=> {
            id(probeId);
            if (!Array.isArray(prompts) || !prompts.length || prompts.length>20) throw new Error('Probe requires 1–20 prompts');
            prompts.forEach(prompt=>text(prompt,'Probe prompt',2000));
            const definition={schemaVersion:3,probeId,prompts:[...prompts],promptHash:hash(prompts)};
            await this.logs.saveArtifact('probe-definitions',probeId,definition); return definition;
        });
    }
    probe(runId: string, agentId: string, turnIndex: number, probeId: string, actor: string, reason: string) {
        return this.controller.researchAction(()=>this.probeInLease(runId,agentId,turnIndex,probeId,actor,reason));
    }
    async probeInLease(runId: string, agentId: string, turnIndex: number, probeId: string, actor: string, reason: string,
        options: {withholdEntryIds?: string[]; benchmark?: any} = {}) {
            this.controller.assertResearchLease();
            if (!Number.isSafeInteger(turnIndex)) throw new Error('Select an integer source turn');
            const config = await this.logs.loadConfig(id(runId));
            if (!config?.protocol) throw new Error('Probes require a Phase III run with recorded prompting');
            text(actor,'Researcher',200); text(reason,'Reason');
            const definition=await this.logs.loadArtifact('probe-definitions',id(probeId));
            if (hash(definition.prompts)!==definition.promptHash) throw new Error('Probe definition hash mismatch');
            const sourceState=(await this.logs.memoryHistory(runId,id(agentId),turnIndex)).state;
            const state=structuredClone(sourceState);
            if(options.withholdEntryIds?.length) {
                if(config.memoryConfig.mode!=='enabled') throw new Error('Memory withholding requires structured editable memory');
                if(new Set(options.withholdEntryIds).size!==options.withholdEntryIds.length || options.withholdEntryIds.some(entryId=>!state.entries.some(entry=>entry.id===entryId&&entry.status==='active'))) throw new Error('Withheld IDs must be distinct active entries belonging to this agent');
                state.entries=state.entries.filter(entry=>!options.withholdEntryIds!.includes(entry.id));
            }
            const protocol=normalizeProtocol(config.protocol,config.memoryConfig.mode);
            const adapter=new LlmAdapter(config.llmConfig);
            const probeSessionId=randomUUID();
            const messages: {role:string;content:string}[]=[];
            const results:any[]=[];
            for (const [probeTurn,prompt] of definition.prompts.entries()) {
                // Dedicated probe conversation: no main transcript and no state writes.
                const rendered=renderProtocol(state,resolveMemoryConfig(config.memoryConfig),protocol,[],prompt);
                messages.push({role:'user',content:prompt});
                const record:any={schemaVersion:3,id:randomUUID(),probeSessionId,probeId,probeHash:definition.promptHash,runId,agentId,
                    turnIndex,probeTurn,actor,reason,configHash:hash(config),timestamp:new Date().toISOString(),
                    prompt:{system:rendered.system,messages:structuredClone(messages)},retrieval:rendered.retrieval,sourceStateHash:hash(sourceState),stateHash:hash(state),memoryPolicy:'read-only',
                    ...(options.benchmark?{benchmark:{...options.benchmark,final:probeTurn===definition.prompts.length-1}}:{})};
                adapter.lastRequest=undefined; adapter.lastRawContent=undefined; adapter.lastDiagnostics=undefined;
                try {
                    if(rendered.system.length+messages.reduce((n,m)=>n+m.content.length,0)>protocol.inputCharLimit) throw new Error('Probe exceeds the recorded input character limit');
                    const response=await adapter.generateTurn(rendered.system,messages,protocol.inputCharLimit);
                    Object.assign(record,{status:'success',request:adapter.lastRequest,rawResponse:adapter.lastRawContent,response,diagnostics:adapter.lastDiagnostics});
                    messages.push({role:'assistant',content:response.response});
                } catch(error) {
                    Object.assign(record,{status:'error',request:adapter.lastRequest,rawResponse:adapter.lastRawContent,
                        error:error instanceof LlmError ? error.message : 'Probe failed its input budget or connection check',diagnostics:adapter.lastDiagnostics});
                }
                await this.logs.appendResearch(runId,'probes',record); results.push(record);
                if(record.status==='error') break;
            }
            await this.note(runId,actor,reason,'probe',{probeId,probeSessionId,agentId,sourceTurnIndex:turnIndex});
            return {probeSessionId,results};
    }
    exportRun(runId: string) { return this.controller.researchAction(()=>this.exportInLease(runId)); }
    async exportInLease(runId: string) {
        this.controller.assertResearchLease();
        const config=await this.logs.loadConfig(id(runId)); if(!config) throw new Error('Unknown run');
        const bundle:any={schemaVersion:3,runId,config,configHash:hash(config),
            turns:await this.logs.getConversationHistory(runId),events:await this.logs.getEventHistory(runId),
            interventions:await this.logs.readResearch(runId,'interventions'),probes:await this.logs.readResearch(runId,'probes')};
        try { bundle.baseline=await this.logs.loadBaseline(runId); } catch(error:any) { if(error.code!=='ENOENT') throw error; bundle.baseline=null; }
        if(config.protocol?.snapshotId) bundle.startingSnapshot=await this.logs.loadArtifact('snapshots',config.protocol.snapshotId);
        if(config.protocol?.templateId) bundle.template=await this.logs.loadArtifact('templates',config.protocol.templateId);
        if(config.protocol?.batchId) bundle.batch=await this.logs.loadArtifact('batches',config.protocol.batchId);
        bundle.probeDefinitions=await Promise.all([...new Set(bundle.probes.map((p:any)=>p.probeId))].map(probeId=>this.logs.loadArtifact('probe-definitions',String(probeId))));
        bundle.feedback=await this.logs.readResearch(runId,'feedback');
        bundle.benchmarkOutcomes=await this.logs.readResearch(runId,'benchmarks');
        bundle.benchmarkSessions=(await Promise.all((await this.logs.listArtifacts('benchmark-sessions')).map(sessionId=>this.logs.loadArtifact('benchmark-sessions',sessionId)))).filter(session=>session.runId===runId);
        bundle.benchmarkDefinitions=await Promise.all([...new Set(bundle.benchmarkSessions.map((record:any)=>record.benchmarkId))].map(benchmarkId=>this.logs.loadArtifact('benchmarks',String(benchmarkId))));
        const ratings=await Promise.all((await this.logs.listArtifacts('ratings')).map(ratingId=>this.logs.loadArtifact('ratings',ratingId)));
        bundle.evaluations=ratings.filter(record=>record.source.runId===runId);
        bundle.integrityHash=hash(bundle);return bundle;
    }
    async compare(leftId: string,rightId: string) {
        const left=await this.logs.loadConfig(id(leftId)),right=await this.logs.loadConfig(id(rightId));
        if(!left||!right) throw new Error('Both runs must exist');
        return {leftId,rightId,leftHash:hash(left),rightHash:hash(right),differences:differences(left,right),
            promptingRecorded:Boolean(left.protocol&&right.protocol)};
    }
    async catalog() { return {runs:await this.logs.listRuns(),templates:await this.logs.listArtifacts('templates'),snapshots:await this.logs.listArtifacts('snapshots'),batches:await this.logs.listArtifacts('batches'),probes:await this.logs.listArtifacts('probe-definitions')}; }
    batchManifest(batchId:string) {return this.logs.loadArtifact('batches',id(batchId));}
}
