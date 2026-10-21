import {shouldForfeit,forfeitedRecord} from '../recovery/forfeiture';
import {executionContext,executionViolations} from '../interaction/execution';
import type {TurnViolation} from '../validation/issues';
import {DecisionConfig,SchedulingConfig,CommunicationConfig,resolveInteraction,validateIntent,routeMessage,interactionInstructions} from '../interaction/policy';
import {selectAgent,initialScheduler} from '../interaction/scheduler';
import {HistoryConfig,resolveHistoryConfig,retrieveTaskHistory} from '../taskHistory/history';
import {RecoveryConfig, resolveRecovery, classifyFailure, correctionMessage, RecoveryCancelled, ProposalError} from '../recovery/recovery';
import {WorldConfig, WorldState, WorldError, configuredWorldActions, assertWorldCompatible, schedule, resolveWorld, advanceWorld, nextAgent, nextWakeMinute, prepareWorld, worldContext, worldInstructions, visibleHistory} from '../world/simulation';
import {OperationalConfig, OperationalError, freshOperationalState, resolveOperational, prepareOperational, operationalContext, operationalInstructions, currentOperational} from '../operations/state';
import { memoryOperationGuide, participantDirectory, ParticipantIdentity } from '../memory/operationGuide';
import { demeanorContext } from '../agents/startingDemeanor';
import { inheritedContext } from '../branches/context';
import { verifiedBranch } from '../branches/interventions';
import { JsonStorage } from '../storage/JsonStorage';
import { JsonlStorage, TurnProjectionError } from '../storage/JsonlStorage';
import { LlmAdapter, LlmConfig, LlmError, resolveLlmConfig } from '../llm/LlmAdapter';
import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { MemoryManager, MemoryValidationError } from '../agents/MemoryManager';
import { MemoryConfig, resolveMemoryConfig } from '../memory/types';
import { Protocol, ProtocolError, normalizeProtocol, renderProtocol, hash } from '../research/protocol';
import { SocialConfig, TaskConfig, FeedbackConfig, resolveEnvironment, validateDecision, socialInstructions, settleRound, visibleFeedback, feedbackContext } from '../social/environment';
import { retrieveMemory, boundedTranscript } from '../memory/retrieval';

export type RunStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'completed';

export interface ExperimentConfig {
    decisionConfig?: DecisionConfig;
    schedulingConfig?: SchedulingConfig;
    communicationConfig?: CommunicationConfig;
    runId: string;
    operationalInitializationVersion?: 1; // Backend-owned marker; legacy runs omit it.
    agentIds: string[]; // Immutable participant order for the sequential scheduler.
    memoryConfig?: Partial<MemoryConfig>;
    protocol?: Partial<Protocol>;
    operationalConfig?: Partial<OperationalConfig>;
    worldConfig?: Partial<WorldConfig>;
    recoveryConfig?: Partial<RecoveryConfig>;
    taskHistoryConfig?: Partial<HistoryConfig>;
    initialTopic?: string; // Legacy configurations omit this field.
    socialConfig?: Partial<SocialConfig>;
    taskConfig?: Partial<TaskConfig>;
    feedbackConfig?: Partial<FeedbackConfig>;
    maxTurns: number;
    llmConfig: LlmConfig;
}

export function normalizeInitialTopic(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new Error('Conversation topic must be text');
    const topic = value.trim();
    if (topic.length > 8000) throw new Error('Conversation topic must be at most 8,000 characters');
    return topic;
}

export class ExperimentController {
    private jsonStorage: JsonStorage;
    private jsonlStorage: JsonlStorage;
    private llmAdapter: LlmAdapter;
    private memoryManager: MemoryManager;

    private status: RunStatus = 'idle';
    private config: ExperimentConfig | null = null;
    private currentTurnIndex: number = 0;
    private shouldPause: boolean = false;
    private shouldStop: boolean = false;
    private activePromise: Promise<void> | null = null;

    private subscribers = new Set<(eventType: string, data: any) => void>();
    private commands: Promise<unknown> = Promise.resolve();
    private activeAgentId: string | null = null;
    private lastError: any = null;
    private readonly writerId = randomUUID();
    private currentAttempt: any = null;
    private activeStorage: JsonStorage;
    private researchLease = false;
    private configHash = '';
    private world:WorldState|undefined;
    private pending:any=null;
    private recovery:any={phase:'idle'};
    private retryWake:(()=>void)|undefined;
    private inferenceAbort:AbortController|undefined;
    private get recoveryConfig(){return resolveRecovery(this.config?.recoveryConfig,true);}
    private checkpoint(){return {runId:this.config!.runId,lifecycle:this.shouldStop?'stopped':this.shouldPause?'paused':this.status,pending:structuredClone(this.pending),recovery:structuredClone(this.recovery),error:this.lastError,recoveryPolicy:this.recoveryConfig,timestamp:new Date().toISOString()};}
    private async saveExecution(overrides?:Record<string,unknown>){
        if(!this.config||!this.recoveryConfig.enabled)return;
        const owned=this.jsonlStorage.ownsWriter(this.writerId);
        if(!owned)await this.jsonlStorage.acquireWriter(this.writerId);
        try{await this.jsonlStorage.appendEvent(this.config.runId,{id:randomUUID(),type:'execution_checkpoint',checkpoint:{...this.checkpoint(),...overrides}});}
        finally{if(!owned)await this.jsonlStorage.releaseWriter(this.writerId);}
    }
    private interruptRecovery(){this.retryWake?.();this.inferenceAbort?.abort();}
    private async waitForRetry(ms:number){
        if(this.shouldPause||this.shouldStop)return;
        await new Promise<void>(resolve=>{const timer=setTimeout(done,ms);const self=this;function done(){clearTimeout(timer);self.retryWake=undefined;resolve();}this.retryWake=done;});
    }
    // Only persisted recovery-aware runs are restored; legacy historical files are untouched.
    async restore(){
        const candidates:any[]=[];
        for(const runId of await this.jsonlStorage.listRuns()){const saved=await this.jsonlStorage.latestExecution(runId);if(saved)candidates.push(saved);}
        candidates.sort((a,b)=>a.timestamp<b.timestamp?-1:a.timestamp>b.timestamp?1:0);
        const active=candidates.filter(c=>c.lifecycle==='running');
        if(active.length>1)throw new Error('Multiple unfinished recovery-aware runs found; select a run explicitly before continuing');
        const saved=active[0]??candidates.at(-1);if(!saved||saved.lifecycle==='reset')return;
        const config=await this.jsonlStorage.loadConfig(saved.runId);if(!config)throw new Error('Recovery configuration is missing');
        await this.start(config,saved);
    }


    constructor(jsonStorage: JsonStorage, jsonlStorage: JsonlStorage, llmAdapter: LlmAdapter) {
        this.jsonStorage = jsonStorage;
        this.activeStorage = jsonStorage;
        this.jsonlStorage = jsonlStorage;
        this.llmAdapter = llmAdapter;
        this.memoryManager = new MemoryManager(this.jsonStorage);
    }

    reportRestoreFailure(error:any){this.status='paused';this.shouldPause=true;this.recovery={phase:'suspended',category:'storage_failure',code:'RESTORE_SAFETY_UNVERIFIED',reason:'Automatic restart could not establish a safe configuration/commit history. Inspect backend storage and select the run explicitly.'};this.lastError={type:'experiment_error',message:this.recovery.reason};this.publishStatus();}

    onEvent(cb: (eventType: string, data: any) => void): () => void {
        this.subscribers.add(cb);
        return () => { this.subscribers.delete(cb); };
    }
    private emit(eventType: string, data: any) {
        for (const cb of this.subscribers) {
            try { cb(eventType, data); } catch { /* One disconnected client cannot fail a turn. */ }
        }
    }
    getStatus() { return this.status; }
    getConfig() { return this.config ? structuredClone(this.config) : null; }
    getTurnIndex() { return this.currentTurnIndex; }
    getState() {
        return { status: this.status, config: this.getConfig(), currentTurnIndex: this.currentTurnIndex,
            activeAgentId: this.activeAgentId, error: this.lastError, recovery:structuredClone(this.recovery), ...(this.world?{worldState:structuredClone(this.world)}:{}) };
    }
    async getSnapshot() {
        const runId = this.config?.runId;
        const state = this.getState();
        const turns = runId ? await this.jsonlStorage.getConversationHistory(runId) : [];
        const events = runId ? [...await this.jsonlStorage.getEventHistory(runId), ...await this.jsonlStorage.readResearch(runId, 'feedback')] : [];
        const operationalStates:Record<string,any>={};
        let baseline:any;
        if(runId)try{baseline=await this.jsonlStorage.loadBaseline(runId);}catch(error:any){if(error.code!=='ENOENT')throw error;}
        for(const id of this.config?.agentIds??[]){
            const last=[...turns].reverse().find(turn=>turn.agentId===id);
            const saved=last ? (last.stateAfter ?? {}) : (baseline?.states[id] ?? await this.activeStorage.loadWorkingState(id));
            operationalStates[id]=currentOperational(saved);
            if(this.world){const location=this.config!.operationalConfig!.locations!.find(l=>l.id===this.world!.positions[id]);if(location)operationalStates[id].location=structuredClone(location);}
        }
        return { ...state, turns, events:events.filter(event=>event.type!=='execution_checkpoint').map(({checkpoint,...event})=>event), operationalStates };
    }
    notifyEnvironmentEvent(event:any) {
        this.assertResearchLease();
        if(event.runId === this.config?.runId)this.emit('environment_event',event);
    }
    private publishStatus() { this.emit('status_changed', this.getState()); }
    // Lifecycle commands are serialized, including discovery and disk I/O in start().
    private command(work: () => Promise<void>): Promise<void> {
        const result = this.commands.then(work);
        this.commands = result.catch(() => {});
        return result;
    }
    researchAction<T>(work: () => Promise<T>): Promise<T> {
        const result = this.commands.then(async () => {
            if (this.status === 'running') throw new Error('Pause or stop the experiment before researcher operations');
            await this.activePromise;
            const alreadyOwned = this.jsonlStorage.ownsWriter(this.writerId);
            await this.jsonlStorage.acquireWriter(this.writerId);
            try {
                await this.jsonlStorage.recoverPendingTurns(this.jsonStorage);
                this.researchLease = true;
                return await work();
            } finally { this.researchLease = false; if (!alreadyOwned) await this.jsonlStorage.releaseWriter(this.writerId); }
        });
        this.commands = result.catch(() => {});
        return result;
    }

    archiveAgent(agentId:string) {return this.command(async()=>{
        if((this.status==='running'||this.status==='paused')&&this.config?.agentIds.includes(agentId))throw Object.assign(new Error('Cannot remove an agent participating in an active experiment. Stop the experiment first.'),{status:409});
        const owned=this.jsonlStorage.ownsWriter(this.writerId);
        await this.jsonlStorage.acquireWriter(this.writerId);
        try {await this.jsonStorage.setArchived(agentId,true);}
        finally {if(!owned)await this.jsonlStorage.releaseWriter(this.writerId);}
    });}

    assertResearchLease() {
        if (!this.researchLease || !this.jsonlStorage.ownsWriter(this.writerId)) throw new Error('Research operation requires the shared inference/write lease');
    }

    private async recordControl(action: string) {
        if (!this.config?.protocol || !this.jsonlStorage.ownsWriter(this.writerId)) return;
        await this.jsonlStorage.appendResearch(this.config.runId, 'interventions', {
            schemaVersion:3,id:randomUUID(),runId:this.config.runId,turnIndex:this.currentTurnIndex-1,
            actor:'unspecified',action,reason:`Explicit ${action} control`,timestamp:new Date().toISOString(),activeAgentId:this.activeAgentId
        });
    }

    private async recordHistoryControl(action:string){
        if(!this.config?.worldConfig?.enabled)return;
        const owned=this.jsonlStorage.ownsWriter(this.writerId);
        if(!owned)await this.jsonlStorage.acquireWriter(this.writerId);
        try{await this.jsonlStorage.appendEvent(this.config.runId,{id:randomUUID(),type:'task_history_control',runId:this.config.runId,action,turnIndex:this.currentTurnIndex,simulationMinute:this.world?.minute??null,timestamp:new Date().toISOString()});}
        finally{if(!owned)await this.jsonlStorage.releaseWriter(this.writerId);}
    }

    private launchLoop() {
        if (this.activePromise) throw new Error('A turn loop is still active');
        this.activePromise = this.runLoop().finally(() => { this.activePromise = null; });
    }
    start(input: ExperimentConfig, restored?:any) {
        // Snapshot caller-owned objects before asynchronous discovery or disk reads.
        const config = structuredClone(input);
        return this.command(async () => {
            if(this.activePromise&&this.status!=='running'&&this.status!=='paused')await this.activePromise;
            if (this.activePromise || this.status === 'running' || this.status === 'paused') throw new Error('Stop or reset the current experiment before starting another');
            if (!/^[A-Za-z0-9_-]+$/.test(config.runId) || !Number.isSafeInteger(config.maxTurns) || config.maxTurns < 1 ||
                !Array.isArray(config.agentIds) || config.agentIds.length < 2 || new Set(config.agentIds).size !== config.agentIds.length ||
                !config.agentIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id))) throw new Error('Invalid run ID, agent IDs or turn limit');
            const operational = resolveOperational(config.operationalConfig);
            const worldConfig=resolveWorld(config.worldConfig,config.agentIds,operational);
            const environment = resolveEnvironment(config);
            const initialTopic = normalizeInitialTopic(config.initialTopic);
            const memoryConfig = resolveMemoryConfig(config.memoryConfig);
            resolveHistoryConfig(config.taskHistoryConfig);
            const protocol = config.protocol === undefined ? undefined : normalizeProtocol(config.protocol, memoryConfig.mode);
            await this.jsonlStorage.acquireWriter(this.writerId);
            try {
                await this.jsonlStorage.recoverPendingTurns(this.jsonStorage);
                this.activeStorage = protocol?.stateScope === 'trial' ? this.jsonlStorage.trialStorage(config.runId) : this.jsonStorage;
                if(protocol?.branchId){
                    const branch=await verifiedBranch(this.jsonlStorage,protocol.branchId);
                    if(hash(config)!==branch.configHash)throw new Error('Start branches with their exact saved configuration');
                    if(hash(await this.jsonlStorage.loadArtifact('snapshots',branch.snapshot.snapshotId))!==hash(branch.snapshot))throw new Error('Branch snapshot differs from its manifest');
                }
                await inheritedContext(this.jsonlStorage,config);
                let startingStates: any;
                if (protocol?.stateScope === 'trial') {
                    const snapshot = await this.jsonlStorage.loadArtifact('snapshots', protocol.snapshotId!);
                    if (hash(snapshot.states) !== snapshot.stateHash || protocol.initialStateHash !== snapshot.stateHash) throw new Error('Frozen starting snapshot hash mismatch');
                    if (!isDeepStrictEqual(Object.keys(snapshot.states).sort(), [...config.agentIds].sort())) throw new Error('Snapshot participant IDs differ from the run');
                    if(snapshot.worldState&&worldConfig?.enabled)assertWorldCompatible(snapshot.worldState,worldConfig,config.agentIds,operational.locations.map(l=>l.id));
                    startingStates = snapshot.states;
                }
                if (protocol?.attributeMode === 'role' && config.agentIds.some(id => !Object.hasOwn(protocol.roles, id))) throw new Error('Each participant requires an explicit role description');
                for (const id of config.agentIds) {
                    if (!startingStates && !await this.activeStorage.loadAgentIdentity(id)) throw new Error(`Agent ${id} missing`);
                }
                const llmConfig = resolveLlmConfig(config.llmConfig);
                if (protocol && !llmConfig.modelVersion) throw new Error('Phase III runs require a model version/hash or an explicit unverified declaration');
                const existing = await this.jsonlStorage.loadConfig(config.runId);
                let interaction:any = !existing&&!protocol?.snapshotId ? resolveInteraction(config) : (config.decisionConfig||config.schedulingConfig||config.communicationConfig ? resolveInteraction(config) : {});
                if(existing)interaction=Object.fromEntries(['decisionConfig','schedulingConfig','communicationConfig'].filter(k=>(config as any)[k]!==undefined||(existing as any)[k]!==undefined).map(k=>[k,(config as any)[k]??(existing as any)[k]]));
                if(config.decisionConfig?.mode==='unrestricted'){if(!config.communicationConfig)delete interaction.communicationConfig;if(!config.schedulingConfig)delete interaction.schedulingConfig;}
                let freshBaseline:any;
                const initializeOperational=!protocol?.snapshotId&&(existing?.operationalInitializationVersion===1||!existing&&operational.enabled);
                if(initializeOperational){
                    try {freshBaseline=await this.jsonlStorage.loadBaseline(config.runId);}
                    catch(error:any){if(error.code!=='ENOENT')throw error;}
                    if(freshBaseline){
                        if(freshBaseline.operationalInitialization?.version!==1||hash(freshBaseline.states)!==freshBaseline.operationalInitialization.stateHash)throw new Error('Invalid fresh-run operational baseline');
                    }else{
                        const states:any=Object.create(null),prior:any=Object.create(null),after:any=Object.create(null);
                        for(const agentId of config.agentIds){
                            const persisted=await this.activeStorage.loadWorkingState(agentId);
                            prior[agentId]=currentOperational(persisted);
                            const locationId=worldConfig?.enabled?worldConfig.initialPositions[agentId]??'unspecified':'unspecified';
                            states[agentId]=freshOperationalState(persisted,operational.locations.find(l=>l.id===locationId)!);
                            after[agentId]=states[agentId].operational;
                        }
                        freshBaseline={states,operationalInitialization:{version:1,id:`${config.runId}:operational-initialization`,type:'operational_initialization',source:'backend_initialization',runId:config.runId,agentIds:[...config.agentIds],before:prior,after,stateHash:hash(states),outcomeVerified:false}};
                    }
                }
                if(!existing)for(const agentId of config.agentIds)if((await this.jsonStorage.loadAgentIdentity(agentId))?.archived)throw new Error(`Archived agent ${agentId} cannot participate in a new experiment`);
                const previousExecution=restored??(existing?await this.jsonlStorage.latestExecution(config.runId):undefined);
                const recoveryConfig=resolveRecovery(config.recoveryConfig??existing?.recoveryConfig??previousExecution?.recoveryPolicy);
                const discovery = new LlmAdapter(llmConfig);
                let models:{id:string}[];
                try{models=restored?[{id:llmConfig.model}]:await discovery.getModels();}
                catch(error){if(!recoveryConfig.enabled||!llmConfig.model)throw error;models=[{id:llmConfig.model}];}
                if (!llmConfig.model) {
                    if (models.length !== 1) throw new Error('Select a loaded model from model discovery');
                    llmConfig.model = models[0].id;
                }
                if (!models.some(model => model.id === llmConfig.model)) throw new Error('Selected model is not in the loaded model list');
                if (protocol?.stateScope === 'shared') {
                    if (protocol.snapshotId) throw new Error('Snapshot-backed protocols must use isolated trial state');
                    let baseline: any;
                    try { baseline = existing ? await this.jsonlStorage.loadBaseline(config.runId) : undefined; }
                    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
                    const states: any = Object.create(null);
                    if (!baseline) for (const id of config.agentIds) {
                        states[id] = await this.jsonStorage.loadWorkingState(id);
                        // Hash the same logical initial locations that ensureMemoryBaseline stores.
                        // This changes no persisted agent data or existing run configuration.
                        if(worldConfig?.enabled){states[id].operational=currentOperational(states[id]);states[id].operational.location=operational.locations.find(l=>l.id===(worldConfig.initialPositions[id]??'unspecified'))!;}
                    }
                    const initialHash = hash(baseline?.states ?? freshBaseline?.states ?? states);
                    if (protocol.initialStateHash && protocol.initialStateHash !== initialHash) throw new Error('Shared starting-state hash mismatch');
                    protocol.initialStateHash = initialHash;
                }
                const {operationalInitializationVersion: _requestedInitialization,...requestedConfig}=config;
                const resolved = { ...requestedConfig, ...interaction, ...(initializeOperational?{operationalInitializationVersion:1 as const}:{}), recoveryConfig, ...(worldConfig?{worldConfig}:{}), ...(config.operationalConfig === undefined ? {} : {operationalConfig:operational}), agentIds: [...config.agentIds], initialTopic, llmConfig, memoryConfig, ...((config.socialConfig || config.taskConfig || config.feedbackConfig) ? environment : {}), ...(protocol ? { protocol } : {}) };
                if (existing && !isDeepStrictEqual({ ...existing, recoveryConfig:resolveRecovery(existing.recoveryConfig??previousExecution?.recoveryPolicy), llmConfig:resolveLlmConfig(existing.llmConfig), initialTopic: normalizeInitialTopic(existing.initialTopic), memoryConfig: resolveMemoryConfig(existing.memoryConfig), ...resolveEnvironment(existing) }, { ...resolved, ...environment })) throw new Error('Run ID already has different metadata; use a new run ID to change participants, topic, model or settings');
                const history = await this.jsonlStorage.getConversationHistory(config.runId);
                const events = [...await this.jsonlStorage.getEventHistory(config.runId), ...await this.jsonlStorage.readResearch(config.runId,'feedback')];
                if (!existing && (history.length || events.length)) throw new Error('Run already has research logs without configuration; use a new run ID');
                if (!existing) await this.jsonlStorage.saveConfig(config.runId, resolved);
                if(!existing||history.length<config.maxTurns)await this.jsonlStorage.ensureTaskHistoryBaseline(config.runId,config.agentIds,protocol,!existing);
                if (startingStates) for (const id of config.agentIds) {
                    if (!await this.activeStorage.loadAgentIdentity(id)) await this.activeStorage.saveWorkingState(id, startingStates[id]);
                }
                if (history.length < config.maxTurns) {
                    const states: Record<string, Awaited<ReturnType<JsonStorage['loadWorkingState']>>> = Object.create(null);
                    const worldBaseline=worldConfig?.enabled?await this.jsonlStorage.worldAt(config.runId):undefined;
                    for (const id of config.agentIds) {states[id] = freshBaseline?.states[id] ?? await this.activeStorage.loadWorkingState(id);if(worldBaseline){states[id].operational=currentOperational(states[id]);states[id].operational!.location=operational.locations.find(l=>l.id===worldBaseline.positions[id])!;}}
                    await this.jsonlStorage.ensureMemoryBaseline(config.runId, history.length - 1, states, freshBaseline?.operationalInitialization);
                    if(freshBaseline&&!events.some(e=>e.id===freshBaseline.operationalInitialization.id))await this.jsonlStorage.appendEvent(config.runId,freshBaseline.operationalInitialization);
                }
                this.config = resolved;
                this.world = await this.jsonlStorage.worldAt(config.runId);
                this.configHash = hash(existing ?? resolved);
                this.llmAdapter.setExperimentConfig(llmConfig);
                this.currentTurnIndex = history.length;
                this.shouldPause = false;
                this.shouldStop = false;
                this.lastError = restored?.error??null;
                const saved=previousExecution;
                this.pending=saved?.pending?.turnIndex===this.currentTurnIndex?structuredClone(saved.pending):null;
                this.recovery=this.pending?structuredClone(saved.recovery):{phase:'idle'};
                if(saved?.pending?.expectedCommitHash&&history[saved.pending.turnIndex]&&hash(history[saved.pending.turnIndex])!==saved.pending.expectedCommitHash)throw new Error('Saved commit hash differs from canonical history');
                if(this.pending?.expectedCommitHash){if(restored?.lifecycle==='running'){restored={...restored,lifecycle:'paused'};this.recovery={phase:'suspended',category:'storage_failure',code:'COMMIT_SAFETY_UNVERIFIED',reason:'Pending commit was not found; inspect storage before Resume.'};}else if(!restored){delete this.pending.expectedCommitHash;delete this.pending.commitCandidate;}}
                if(this.pending&&!restored)await this.flushUnwrittenAudit();
                if(this.pending&&!restored){this.pending.correctiveRetries=0;this.pending.technicalFailures=0;}
                if(restored?.lifecycle==='running'&&this.pending?.inFlight&&!this.pending.expectedCommitHash){
                    this.pending.totalTechnicalFailures++;this.pending.retryStartedAt??=Date.now();
                    this.pending.lastFailure={category:'inference_connection',code:'ATTEMPT_INTERRUPTED',explanation:'The backend restarted before this inference attempt was acknowledged.',retry:'technical'};
                    await this.jsonlStorage.appendEvent(config.runId,{id:`${this.pending.logicalTurnId}:attempt:${this.pending.attemptNumber}:interrupted`,type:'recovery_attempt',runId:config.runId,agentId:this.pending.agentId,turnIndex:this.currentTurnIndex,logicalTurnIndex:this.currentTurnIndex,attemptNumber:this.pending.attemptNumber,category:'inference_connection',code:'ATTEMPT_INTERRUPTED',stateCommitted:false,simulationMinute:this.world?.minute??null,recoveryAction:'restart_retry',attempt:{request:this.pending.preparedRequest},checkpoint:this.checkpoint()});
                }
                if (this.currentTurnIndex < config.maxTurns) {await this.recordControl(existing ? 'restart' : 'start');if(existing&&(!restored||restored.lifecycle==='running'))await this.recordHistoryControl('resumed');}
                this.status = this.currentTurnIndex >= config.maxTurns ? 'completed' : restored&&restored.lifecycle!=='running'?(restored.lifecycle==='stopped'?'stopped':'paused'):'running';
                this.shouldPause=this.status==='paused';this.shouldStop=this.status==='stopped';
                await this.saveExecution();
                this.emit('snapshot', await this.getSnapshot());
                this.publishStatus();
                if (this.status === 'running') this.launchLoop();
                else await this.jsonlStorage.releaseWriter(this.writerId);
            } catch (error) {
                await this.jsonlStorage.releaseWriter(this.writerId);
                throw error;
            }
        });
    }
    pause() { return this.command(async () => {
        if (this.status !== 'running') return;
        this.shouldPause = true;
        this.status = 'paused';
        this.interruptRecovery();this.recovery={...this.recovery,phase:'paused'};
        await this.saveExecution();
        this.publishStatus();
        await this.recordControl('pause');
        // Finish the in-flight turn before any Resume can launch the next loop.
        await this.activePromise;
    }); }
    resume() { return this.command(async () => {
        if (this.status !== 'paused' || !this.config) return;
        await this.activePromise;
        await this.jsonlStorage.acquireWriter(this.writerId);
        await this.jsonlStorage.recoverPendingTurns(this.jsonStorage);
        await this.flushUnwrittenAudit();
        await this.reconcilePendingCommit(true);
        if(this.pending&&this.recovery.phase==='suspended'){this.pending.correctiveRetries=0;this.pending.technicalFailures=0;}
        this.shouldPause = false;
        this.shouldStop = false;
        this.lastError = null;
        await this.recordControl('resume');
        await this.recordHistoryControl('resumed');
        this.status = this.currentTurnIndex >= this.config.maxTurns ? 'completed' : 'running';
        this.recovery={...this.recovery,phase:'idle'};await this.saveExecution();
        this.emit('snapshot', await this.getSnapshot());
        this.publishStatus();
        if (this.status === 'running') this.launchLoop();
        else await this.jsonlStorage.releaseWriter(this.writerId);
    }); }
    stop() { return this.command(async () => {
        this.shouldStop = true;
        this.status = 'stopped';this.interruptRecovery();this.recovery={...this.recovery,phase:'stopped'};await this.saveExecution();
        await this.recordControl('stop');
        this.publishStatus();
        await this.activePromise;
        try{if (this.jsonlStorage.ownsWriter(this.writerId)) await this.jsonlStorage.recoverPendingTurns(this.jsonStorage);await this.recordHistoryControl('stopped');}
        catch{this.recovery={phase:'stopped',category:'storage_failure',code:'STOPPED_WITH_PENDING_REPAIR',reason:'Stopped by researcher; committed projections still require storage repair before another run.'};await this.saveExecution().catch(()=>{});this.publishStatus();}
        finally{await this.jsonlStorage.releaseWriter(this.writerId);}
    }); }
    reset() { return this.command(async () => {
        this.shouldStop = true;this.interruptRecovery();
        await this.recordControl('reset');
        await this.activePromise;
        if (this.jsonlStorage.ownsWriter(this.writerId)) await this.jsonlStorage.recoverPendingTurns(this.jsonStorage);
        if(this.pending?.unwrittenAudit){await this.jsonlStorage.acquireWriter(this.writerId);await this.flushUnwrittenAudit();}
        await this.recordHistoryControl('reset');
        await this.saveExecution({lifecycle:'reset',pending:null});
        await this.jsonlStorage.releaseWriter(this.writerId);
        this.pending=null;this.recovery={phase:'idle'};
        this.status = 'idle';
        this.config = null;
        this.world = undefined;
        this.currentTurnIndex = 0;
        this.activeAgentId = null;
        this.lastError = null;
        this.shouldPause = false;
        this.shouldStop = false;
        this.publishStatus();
        this.emit('snapshot', await this.getSnapshot());
    }); }
    private async selection(){
        const c=this.config!;
        if(this.world&&schedule(c.worldConfig as WorldConfig).some(o=>o.minute<=this.world!.minute&&!this.world!.executed.includes(o.id)))await this.commitWorldAdvance(this.world.minute,'scheduler');
        if(!c.schedulingConfig||c.schedulingConfig.mode==='event_driven')return undefined;
        const history=await this.jsonlStorage.getConversationHistory(c.runId);
        let before=history.at(-1)?.schedulerStateAfter;
        if(!before&&c.protocol?.snapshotId){const snapshot=await this.jsonlStorage.loadArtifact('snapshots',c.protocol.snapshotId);if(snapshot.schedulerState){if(hash(snapshot.schedulerState)!==snapshot.schedulerHash)throw new Error('Snapshot scheduler hash mismatch');before=snapshot.schedulerState;}}
        return selectAgent(c.schedulingConfig,c.agentIds,c.agentIds.filter(id=>c.schedulingConfig!.mode==='round_robin'||!this.world?.waits[id]),this.currentTurnIndex,before??initialScheduler());
    }
    private async runLoop() {
        if (!this.config) return;
        while (this.status === 'running' && this.currentTurnIndex < this.config.maxTurns && !this.shouldPause && !this.shouldStop) {
            let agentId:string|undefined=this.pending?.agentId;
            try {
            const selection=this.pending?.context?.selection??await this.selection();
            agentId = this.pending?.agentId??(selection ? selection.agentId : this.world ? nextAgent(this.world,{...this.config.worldConfig,schedulingMode:this.config.schedulingConfig?.mode==='event_driven'?'event_driven':this.config.worldConfig!.schedulingMode} as WorldConfig,this.config.agentIds,this.currentTurnIndex,resolveEnvironment(this.config).taskConfig.kind!=='none') : this.config.agentIds[this.currentTurnIndex % this.config.agentIds.length]);
                if(this.pending?.retryAt>Date.now()){this.recovery={...this.recovery,phase:this.pending.nextPhase};this.publishStatus();await this.waitForRetry(this.pending.retryAt-Date.now());}
                if(this.recoveryConfig.enabled&&(this.shouldPause||this.shouldStop))break;
                if(!agentId && this.world){
                    const minute=nextWakeMinute(this.world,this.config.worldConfig as WorldConfig);
                    if(minute===undefined){this.status='paused';this.shouldPause=true;this.recovery={phase:'idle_wait',reason:'All agents are waiting for an external event'};await this.saveExecution();this.publishStatus();break;}
                    await this.commitWorldAdvance(minute,'scheduler');
                    continue;
                }
                if(!agentId)break;
                this.activeAgentId = agentId;
                if(this.pending?.forfeiturePending)await this.commitForfeiture();
                else await this.executeTurn(agentId,selection);
                await this.finishAtLimit();
            } catch (error: any) {
                if(this.recoveryConfig.enabled){await this.handleRecoverableFailure(error,agentId);continue;}
                this.activeAgentId = null;
                this.shouldPause = true;
                this.lastError = {
                    id: randomUUID(), type: 'experiment_error', runId: this.config.runId,
                    turnIndex: error instanceof TurnProjectionError ? this.currentTurnIndex - 1 : this.currentTurnIndex, agentId,
                    ...(this.world?{simulationMinute:this.world.minute}:{}),
                    message: (error instanceof LlmError || error instanceof ProposalError || error instanceof MemoryValidationError || error instanceof OperationalError || error instanceof WorldError || error instanceof ProtocolError || error instanceof TurnProjectionError) ? error.message : 'Turn execution failed; check backend storage and configuration',
                    ...(error instanceof LlmError ? { diagnostics: error.diagnostics } : {}),
                    timestamp: new Date().toISOString()
                };
                try { await this.jsonlStorage.appendEvent(this.config.runId, {
                    ...this.lastError,
                    ...(this.currentAttempt ? { attempt: { ...this.currentAttempt, request: this.llmAdapter.lastRequest, parsedResponse: this.llmAdapter.lastParsedResponse, rawResponse: this.llmAdapter.lastRawContent, llmValidation: this.llmAdapter.lastValidation, finishedAt: new Date().toISOString() } } : {})
                }); }
                catch { this.lastError.message += '; research error log could not be written'; }
                this.status = this.shouldStop ? 'stopped' : 'paused';
                this.recovery={phase:this.shouldStop?'stopped':'suspended',reason:this.lastError.message,category:classifyFailure(error).category,code:classifyFailure(error).code};
                console.error('Experiment paused', this.lastError);
                this.emit('experiment_error', this.lastError);
            } finally {
                this.currentAttempt = null;this.inferenceAbort=undefined;
                if(!this.recoveryConfig.enabled)this.pending=null;
                this.activeAgentId = null;
                this.publishStatus();
            }
        }
    }

    private async flushUnwrittenAudit(){
        const queued=this.pending?.unwrittenAudit;if(!queued||!this.config)return;
        const found=(await this.jsonlStorage.getEventHistory(this.config.runId)).find(event=>event.id===queued.id);
        const {checkpoint:oldCursor,...evidence}=queued;
        if(found){const {checkpoint,...existing}=found;if(hash(existing)!==hash(evidence))throw new Error('Rejected-attempt evidence differs from its durable ID');delete this.pending.unwrittenAudit;return;}
        delete this.pending.unwrittenAudit;
        try{await this.jsonlStorage.appendEvent(this.config.runId,{...evidence,checkpoint:this.checkpoint()});this.emit('recovery_attempt',evidence);}
        catch(error){this.pending.unwrittenAudit=queued;throw error;}
    }

    private async reconcilePendingCommit(allowAbsent=false):Promise<boolean>{
        if(!this.pending?.expectedCommitHash||!this.config)return false;
        const history=await this.jsonlStorage.getConversationHistory(this.config.runId);
        if(history.some((record,index)=>record.turnIndex!==index))throw new Error('Canonical turn ordering is ambiguous');
        const committed=history[this.pending.turnIndex];
        if(!committed){if(allowAbsent){delete this.pending.expectedCommitHash;delete this.pending.commitCandidate;return false;}return false;}
        if(committed.eventId!==this.pending.logicalTurnId||hash(committed)!==this.pending.expectedCommitHash)throw new Error('Canonical commit does not match the prepared turn');
        await this.jsonlStorage.recoverPendingTurns(this.jsonStorage);
        this.currentTurnIndex=history.length;this.world=await this.jsonlStorage.worldAt(this.config.runId);
        this.pending=null;this.recovery={phase:'idle',reason:'Committed turn recovered without repeating inference'};this.lastError=null;
        if(this.currentTurnIndex>=this.config.maxTurns&&!this.shouldStop&&!this.shouldPause)this.status='completed';
        await this.saveExecution();this.emit('snapshot',await this.getSnapshot());return true;
    }
    private async handleRecoverableFailure(error:any,agentId?:string){
        this.activeAgentId=null;
        try{
            // An uncertain append or failed projection must be reconciled against the exact commit hash.
            if(this.pending?.expectedCommitHash){
                let safeProjection=false,safeAppend=false;
                for(let repair=0;repair<=this.recoveryConfig.technicalRetries;repair++){
                    safeProjection=false;safeAppend=false;
                    try{
                        const history=await this.jsonlStorage.getConversationHistory(this.config!.runId),committed=history[this.pending.turnIndex];
                        const ordered=history.every((record,index)=>record.turnIndex===index);
                        safeProjection=ordered&&!!committed&&committed.eventId===this.pending.logicalTurnId&&hash(committed)===this.pending.expectedCommitHash;
                        safeAppend=ordered&&history.length===this.pending.turnIndex&&!!this.pending.commitCandidate&&hash(this.pending.commitCandidate)===this.pending.expectedCommitHash&&this.pending.commitCandidate.eventId===this.pending.logicalTurnId;
                        if(safeProjection){this.currentTurnIndex=history.length;this.world=await this.jsonlStorage.worldAt(this.config!.runId);}
                    }catch{ /* Unreadable or mismatched evidence never authorizes another mutation. */ }
                    if(repair===0)await this.jsonlStorage.appendEvent(this.config!.runId,{id:`${this.pending.logicalTurnId}:attempt:${this.pending.attemptNumber}:commit_failure`,type:'recovery_attempt',runId:this.config!.runId,agentId,logicalTurnIndex:this.pending.turnIndex,turnIndex:this.pending.turnIndex,simulationMinute:this.world?.minute??null,attemptNumber:this.pending.attemptNumber,category:'storage_failure',code:'COMMIT_ACKNOWLEDGMENT_OR_PROJECTION_FAILURE',explanation:'A write or projection did not acknowledge completion; canonical evidence is checked before any further mutation.',stateCommitted:safeProjection?true:safeAppend?false:null,recoveryAction:'reconcile_commit',timestamp:new Date().toISOString(),checkpoint:this.checkpoint()});
                    if(safeProjection)try{if(await this.reconcilePendingCommit()){if(this.status==='completed')await this.jsonlStorage.releaseWriter(this.writerId);return;}}catch{ /* Retry only the verified committed projection. */ }
                    if((!safeProjection&&!safeAppend)||this.shouldStop||this.shouldPause||repair===this.recoveryConfig.technicalRetries)break;
                    const delay=Math.min(this.recoveryConfig.maxBackoffMs,this.recoveryConfig.initialBackoffMs*2**repair);
                    const code=safeProjection?'COMMITTED_PROJECTION_RETRY':'PREPARED_COMMIT_WRITE_RETRY',action=safeProjection?'repair_committed_turn':'retry_verified_prepared_commit';
                    this.recovery={phase:'repairing',category:'storage_failure',code,reason:safeProjection?'The exact turn is committed; repairing its saved projections without repeating inference.':'Canonical history proves this exact prepared turn was not committed; retrying its journaled write without another inference.',turnIndex:this.pending.turnIndex,agentId,nextRetryAt:new Date(Date.now()+delay).toISOString()};
                    this.pending.storageRetryCount=(this.pending.storageRetryCount??0)+1;
                    await this.jsonlStorage.appendEvent(this.config!.runId,{id:`${this.pending.logicalTurnId}:storage:${this.pending.storageRetryCount}`,type:'recovery_attempt',runId:this.config!.runId,agentId,turnIndex:this.pending.turnIndex,logicalTurnIndex:this.pending.turnIndex,attemptNumber:this.pending.attemptNumber,category:'storage_failure',code,stateCommitted:safeProjection,recoveryAction:action,checkpoint:this.checkpoint()});
                    this.publishStatus();await this.waitForRetry(delay);
                    if(this.shouldStop||this.shouldPause)break;
                    if(safeAppend){
                        // The shared lease excludes another writer; recheck the canonical index after backoff.
                        const history=await this.jsonlStorage.getConversationHistory(this.config!.runId);
                        if(history.length===this.pending.turnIndex&&history.every((record,index)=>record.turnIndex===index))try{await this.jsonlStorage.appendConversationTurn(this.config!.runId,this.pending.commitCandidate);}catch{ /* Reconcile before any further write. */ }
                    }
                }
                if((safeProjection||safeAppend)&&(this.shouldStop||this.shouldPause)){this.recovery={...this.recovery,phase:this.shouldStop?'stopped':'paused'};await this.saveExecution();return;}
                if(error instanceof RecoveryCancelled){delete this.pending.expectedCommitHash;}
                else{
                    this.status=this.shouldStop?'stopped':'paused';this.shouldPause=true;
                    this.recovery={phase:this.shouldStop?'stopped':'suspended',category:'storage_failure',code:'COMMIT_SAFETY_UNVERIFIED',reason:'Commit/projection safety could not be established. Repair storage, inspect the canonical log, then Resume.'};
                    this.lastError={type:'experiment_error',message:this.recovery.reason,...this.recovery,turnIndex:this.pending.turnIndex,agentId};
                    const evidence={id:`${this.pending.logicalTurnId}:attempt:${this.pending.attemptNumber}:storage`,type:'recovery_attempt',runId:this.config!.runId,agentId,logicalTurnIndex:this.pending.turnIndex,turnIndex:this.pending.turnIndex,simulationMinute:this.world?.minute,attemptNumber:this.pending.attemptNumber,category:'storage_failure',code:this.recovery.code,explanation:this.recovery.reason,stateCommitted:safeProjection?true:safeAppend?false:null,recoveryAction:'suspend',attempt:{...this.currentAttempt,request:this.llmAdapter.lastRequest,rawResponse:this.llmAdapter.lastRawContent,parsedResponse:this.llmAdapter.lastParsedResponse},checkpoint:this.checkpoint()};
                    await this.jsonlStorage.appendEvent(this.config!.runId,evidence);const {checkpoint,...visible}=evidence;this.emit('recovery_attempt',visible);this.emit('experiment_error',this.lastError);return;
                }
            }
            if(this.shouldStop||this.shouldPause||error instanceof RecoveryCancelled){
                if(this.pending)this.pending.inFlight=false;
                this.recovery={...this.recovery,phase:this.shouldStop?'stopped':'paused'};
                if(this.pending&&this.currentAttempt){await this.jsonlStorage.appendEvent(this.config!.runId,{id:`${this.pending.logicalTurnId}:attempt:${this.pending.attemptNumber}:cancelled`,type:'recovery_attempt',runId:this.config!.runId,agentId,turnIndex:this.pending.turnIndex,logicalTurnIndex:this.pending.turnIndex,attemptNumber:this.pending.attemptNumber,category:'inference_connection',code:'RESEARCHER_CANCELLED',stateCommitted:false,recoveryAction:this.shouldStop?'researcher_stop':'researcher_pause',attempt:{...this.currentAttempt,request:this.llmAdapter.lastRequest,rawResponse:this.llmAdapter.lastRawContent},checkpoint:this.checkpoint()});}
                else await this.saveExecution();return;
            }
            if(this.pending?.forfeiturePending){
                this.status='paused';this.shouldPause=true;
                this.recovery={phase:'suspended',category:'storage_failure',code:'FORFEITURE_COMMIT_FAILED',reason:'The system-incomplete turn could not be prepared or verified. Inspect storage/world clock before Resume; no additional inference will be issued.'};
                this.lastError={type:'experiment_error',message:this.recovery.reason,...this.recovery};await this.saveExecution();this.publishStatus();return;
            }
            const failure=classifyFailure(error),config=this.recoveryConfig,pending=this.pending;
            if(pending){pending.inFlight=false;pending.retryStartedAt??=Date.now();}
            let action='suspend',delay=0,correction:string|undefined;
            if(pending&&failure.retry==='correct'&&pending.correctiveRetries<config.correctiveRetries){
                pending.correctiveRetries++;pending.totalCorrections++;
                correction=correctionMessage(failure,this.llmAdapter.lastParsedResponse??this.llmAdapter.lastRawContent??null,pending.correctiveRetries,config.correctiveRetries);
                if(this.llmAdapter.lastRawContent!==undefined)pending.corrections.push({role:'system',content:correction});else correction=undefined;action='corrective_retry';
            }else if(shouldForfeit(failure,config,pending)){
                action='forfeit_turn';pending.forfeiturePending=true;
            }else if(pending&&failure.retry==='technical'){
                pending.technicalFailures++;pending.totalTechnicalFailures++;
                if(pending.technicalFailures<=config.technicalRetries){action='technical_retry';delay=Math.min(config.maxBackoffMs,config.initialBackoffMs*2**(pending.technicalFailures-1));}
                else if(config.persistentConnectivityRecovery){action='wait_for_reconnection';delay=config.persistentRetryIntervalMs;}
            }
            const repeatedViolation=failure.retry==='correct'&&pending?.lastBehaviorCode===failure.code;
            if(pending&&failure.retry==='correct')pending.lastBehaviorCode=failure.code;
            if(pending){pending.lastFailure=failure;pending.retryAt=delay?Date.now()+delay:undefined;pending.nextPhase=action==='forfeit_turn'?'forfeiting':action==='wait_for_reconnection'?'waiting':action==='technical_retry'?'retrying':'correcting';}
            this.recovery={phase:action==='suspend'?'suspended':pending.nextPhase,agentId,turnIndex:this.currentTurnIndex,simulationMinute:this.world?.minute,attemptNumber:pending?.attemptNumber,correctiveRetry:pending?.correctiveRetries,correctiveLimit:config.correctiveRetries,technicalFailures:pending?.technicalFailures,category:failure.category,code:failure.code,reason:failure.explanation,...(failure.violations?.length?{violations:failure.violations}:{}),...(delay?{nextRetryAt:new Date(Date.now()+delay).toISOString()}:{}),...(action==='suspend'?{budgetExhausted:failure.retry==='correct'}:{})};
            if(action==='suspend'){this.shouldPause=true;this.status='paused';this.lastError={id:randomUUID(),type:'experiment_error',message:failure.explanation,...this.recovery};}
            const attempt={id:pending?`${pending.logicalTurnId}:attempt:${pending.attemptNumber}`:randomUUID(),type:'recovery_attempt',runId:this.config!.runId,agentId,logicalTurnIndex:this.currentTurnIndex,turnIndex:this.currentTurnIndex,simulationMinute:this.world?.minute??null,attemptNumber:pending?.attemptNumber,category:failure.category,code:failure.code,explanation:failure.explanation,...(failure.violations?.length?{violations:failure.violations}:{}),stateCommitted:false,recoveryAction:action,repeatedViolation,correctionMessage:correction,timestamp:new Date().toISOString(),retryElapsedMs:pending?.retryStartedAt?Date.now()-pending.retryStartedAt:0,
                proposal:{parsed:this.llmAdapter.lastParsedResponse??null,raw:this.llmAdapter.lastRawContent??null},diagnostics:this.llmAdapter.lastDiagnostics,
                proposedOperations:{memory:this.llmAdapter.lastParsedResponse&&((this.llmAdapter.lastParsedResponse as any).memory_operations),operational:(this.llmAdapter.lastParsedResponse as any)?.operational_operations,world:(this.llmAdapter.lastParsedResponse as any)?.world_operations},
                ...(config.auditRejectedAttempts?{attempt:{...this.currentAttempt,request:this.llmAdapter.lastRequest,rawResponse:this.llmAdapter.lastRawContent,parsedResponse:this.llmAdapter.lastParsedResponse,llmValidation:this.llmAdapter.lastValidation,diagnostics:this.llmAdapter.lastDiagnostics}}:{}),checkpoint:this.checkpoint()};
            // Audit plus next recovery cursor is one append: restart cannot lose an already-recorded correction.
            if(pending)pending.unwrittenAudit=attempt;
            await this.jsonlStorage.appendEvent(this.config!.runId,attempt);if(pending)delete pending.unwrittenAudit;const {checkpoint,...visibleAttempt}=attempt;this.emit('recovery_attempt',visibleAttempt);this.publishStatus();
            if(delay)await this.waitForRetry(delay);
        }catch{
            this.status=this.shouldStop?'stopped':'paused';this.shouldPause=true;
            this.recovery={phase:this.shouldStop?'stopped':'suspended',category:'storage_failure',code:'RECOVERY_AUDIT_UNAVAILABLE',reason:'Recovery evidence could not be persisted. No further inference or commits will run until storage is repaired.'};
            this.lastError={type:'experiment_error',message:this.recovery.reason,...this.recovery};this.emit('experiment_error',this.lastError);
        }
    }

    private async appendWorldCheckpoint(record:any){
        try{await this.jsonlStorage.appendEvent(this.config!.runId,record);}
        catch(error){
            // The checkpoint itself may already be durable when only its derived
            // history projection failed. Reconcile that committed world before retry.
            const found=(await this.jsonlStorage.getEventHistory(this.config!.runId)).filter(e=>e.id===record.id);
            if(found.length&&found.every(e=>hash(e)===hash(record)))this.world=structuredClone(record.worldAfter);
            throw error;
        }
    }

    private async commitWorldAdvance(minute:number,actor:string) {
        if(!this.world||!this.config)throw new WorldError('World simulation is disabled');
        const commitId=`${this.config.runId}:world:${this.world.revision+1}`;
        const result=advanceWorld(this.world,this.config.worldConfig as WorldConfig,minute,this.config.agentIds,commitId);
        const record={id:commitId,type:'world_checkpoint',beforeTurn:this.currentTurnIndex,actor,simulationMinute:minute,worldAfter:result.state,events:result.events,timestamp:new Date().toISOString()};
        await this.appendWorldCheckpoint(record);
        this.world=result.state;
        for(const event of result.events)this.emit('environment_event',event);
        this.publishStatus();
    }
    advanceTime(minute:number,actor:string,reason:string){return this.researchAction(async()=>{
        if(this.pending)throw new WorldError('Resolve or reset the pending logical turn before changing world state');
        if(typeof actor!=='string'||!actor.trim()||actor.length>200||typeof reason!=='string'||!reason.trim()||reason.length>4000)throw new WorldError('Researcher and advancement reason are required');
        if(this.config)this.world=await this.jsonlStorage.worldAt(this.config.runId);
        await this.commitWorldAdvance(minute,`${actor}: ${reason}`);
        return this.getState();
    });}
    wakeAgent(agentId:string,actor:string,reason:string){return this.researchAction(async()=>{
        if(this.pending)throw new WorldError('Resolve or reset the pending logical turn before changing world state');
        if(!this.world||!this.config?.agentIds.includes(agentId)||typeof actor!=='string'||!actor.trim()||actor.length>200||typeof reason!=='string'||!reason.trim()||reason.length>4000)throw new WorldError('Select a world participant and record researcher/reason');
        this.world=(await this.jsonlStorage.worldAt(this.config.runId))!;
        const state=structuredClone(this.world);delete state.waits[agentId];(state.wakeReasons[agentId]??=[]).push('researcher');state.revision++;
        const record={id:`${this.config.runId}:world:${state.revision}`,type:'world_checkpoint',beforeTurn:this.currentTurnIndex,actor,reason,agentId,simulationMinute:state.minute,worldAfter:state,events:[{id:`${this.config.runId}:world:${state.revision}:wake`,type:'world_wake',agentId,reason,simulationMinute:state.minute}],timestamp:new Date().toISOString()};
        await this.appendWorldCheckpoint(record);
        this.world=state;this.emit('environment_event',record);this.publishStatus();return this.getState();
    });}

    private async runWorkingState(agentId:string){
        const state=await this.activeStorage.loadWorkingState(agentId);
        if(this.config?.operationalInitializationVersion===1){
            const history=await this.jsonlStorage.getConversationHistory(this.config.runId);
            const latest=[...history].reverse().find(turn=>turn.agentId===agentId);
            const baseline=await this.jsonlStorage.loadBaseline(this.config.runId);
            if(baseline.operationalInitialization?.version!==1||hash(baseline.states)!==baseline.operationalInitialization.stateHash)throw new Error('Invalid run operational initialization evidence');
            const operational=latest?.stateAfter?.operational??baseline.states[agentId]?.operational;
            if(!operational)throw new Error('Missing run-local operational state');
            state.operational=structuredClone(operational);
        }
        return state;
    }

    private async buildPrompt(agentId: string) {
        const state = await this.runWorkingState(agentId);
        if(this.world){const location=this.config!.operationalConfig!.locations!.find(l=>l.id===this.world!.positions[agentId]);if(location){state.operational=currentOperational(state);state.operational.location=structuredClone(location);}}
        const config = resolveMemoryConfig(this.config!.memoryConfig);
        const identity = state.identity;
        const participants: ParticipantIdentity[] = [];
        if (config.mode === 'enabled') for (const id of this.config!.agentIds) {
            const participant = await this.activeStorage.loadAgentIdentity(id);
            if (!participant) throw new Error('Run participant identity is missing');
            participants.push({id,name:participant.name});
        }
        const retrieved = retrieveMemory(state, config);
        const history = visibleHistory([...await inheritedContext(this.jsonlStorage,this.config),...await this.jsonlStorage.getConversationHistory(this.config!.runId)],agentId,this.config!.worldConfig as WorldConfig);
        if (this.config!.protocol) return renderProtocol(state, config, normalizeProtocol(this.config!.protocol, config.mode), history,
            this.currentTurnIndex === 0 && this.config!.initialTopic ? this.config!.initialTopic : undefined, participants);
        const transcript = boundedTranscript(history, config);
        const stats = Object.entries(identity.stats).map(([key, value]) => `- ${key}: ${config.mode !== 'enabled' ? value.initial : value.current}`).join('\n');
        const system = `You are an agent with the following identity:
ID: ${identity.id}
Name: ${identity.name}${demeanorContext(identity)}

Current Stats:
${stats}

Working memory (episodic observations, beliefs/opinions, self-description, relationships):
${retrieved.text || '(None supplied)'}

Extractive digest of additional entries (excerpts; originals retained):
${retrieved.summary || '(None supplied)'}

${this.config!.decisionConfig?.mode==='agent_selected'?'Review the authorized recent conversations and choose your primary activity. Speech and physical work are optional.':'Based on the recent conversation transcript below, you must generate a reply.'}
You can also propose changes to your memories or beliefs if you learned something new or changed your mind.

Recent conversation:
${transcript || '(No conversation supplied)'}${memoryOperationGuide(config)}${participantDirectory(config, participants, identity.id)}`;
        return {
            state,
            retrieval: { ...retrieved.metadata, transcriptChars: transcript.length, config },
            system,
            messages: [{ role: 'user', content: this.currentTurnIndex === 0 && this.config!.initialTopic
                ? this.config!.initialTopic : `It is your turn to speak, ${identity.name}.` }]
        };
    }

    private async prepareTurnContext(agentId:string,selection?:any) {
        if(this.world&&schedule(this.config!.worldConfig as WorldConfig).some(o=>o.minute<=this.world!.minute&&!this.world!.executed.includes(o.id)))await this.commitWorldAdvance(this.world.minute,'scheduler');
        const prompt = await this.buildPrompt(agentId);
        const opConfig = resolveOperational(this.config!.operationalConfig);
        if((opConfig.enabled||this.config!.decisionConfig?.mode==='agent_selected') && !(this.currentTurnIndex === 0 && this.config!.initialTopic) &&
            (!this.config!.protocol?.turnPrompt || this.config!.protocol.turnPrompt === 'It is your turn to speak, {name}.')) {
            prompt.messages[0].content=`It is your turn to choose speech, an action, or silent continuation, ${prompt.state.identity.name}.`;
        }
        const observedStates = [];
        if(!this.config!.communicationConfig && opConfig.enabled && opConfig.observationPolicy === 'co_located' && (!this.world || this.config!.worldConfig!.observationPolicy==='local')) for(const id of this.config!.agentIds) if(id !== agentId) {const other=await this.runWorkingState(id);if(this.world){other.operational=currentOperational(other);other.operational.location=opConfig.locations.find(l=>l.id===this.world!.positions[id])!;}observedStates.push(other);}
        const opContext = opConfig.enabled ? operationalContext(prompt.state,opConfig,observedStates) : undefined;
        if(opContext) prompt.system += operationalInstructions(opContext);
        const schedulerDecision=this.world?{agentId,mode:this.config!.schedulingConfig?.mode??this.config!.worldConfig!.schedulingMode,eligibleAgentIds:this.config!.agentIds.filter(id=>!this.world!.waits[id]),stateBefore:{lastAgentId:this.world!.lastAgentId??null,waits:this.world!.waits},eligibility:resolveEnvironment(this.config!).taskConfig.kind!=='none'?'task_decision':this.config!.worldConfig!.schedulingMode==='round_robin'?'round_robin':'ready',wakeReasons:this.world.wakeReasons[agentId]??[]}:undefined;
        const worldObservation=this.world?worldContext(this.world,this.config!.worldConfig as WorldConfig,agentId,!!this.config!.communicationConfig):undefined;
        if(worldObservation)prompt.system+=worldInstructions(worldObservation);
        const historyConfig=resolveHistoryConfig(this.config!.taskHistoryConfig);
        const history=retrieveTaskHistory(historyConfig.enabled?await this.jsonlStorage.inferenceTaskHistory(this.config!.runId,agentId):[],agentId,this.config!.runId,worldObservation,historyConfig);
        prompt.system+=history.text;
        (prompt.retrieval as any).taskHistory=history.metadata;
        const environment = resolveEnvironment(this.config!);
        const pastEvents = [...await this.jsonlStorage.getEventHistory(this.config!.runId), ...await this.jsonlStorage.readResearch(this.config!.runId, 'feedback')];
        const feedback = visibleFeedback(this.config!, agentId, this.currentTurnIndex, pastEvents);
        prompt.system += socialInstructions(this.config!, this.currentTurnIndex) + feedbackContext(feedback);
        (prompt.retrieval as any).feedbackIds = feedback.map(event=>event.id);
        prompt.system+=interactionInstructions(this.config,agentId);
        return {prompt,opConfig,opContext,worldObservation,schedulerDecision,environment,selection};
    }
    private async executeTurn(agentId:string,selection?:any){
        if(!this.pending){
            const context=await this.prepareTurnContext(agentId,selection);
            this.pending={logicalTurnId:`${this.config!.runId}:turn:${this.currentTurnIndex}`,agentId,turnIndex:this.currentTurnIndex,attemptNumber:0,correctiveRetries:0,totalCorrections:0,technicalFailures:0,totalTechnicalFailures:0,startedAt:new Date().toISOString(),context,corrections:[]};
        }
        const {prompt:original,opConfig,opContext,worldObservation,schedulerDecision,environment}=this.pending.context;
        const prompt=structuredClone(original);
        // Retain every historical correction in audit/checkpoints; inference gets the latest complete diagnostic.
        prompt.messages.push(...this.pending.corrections.slice(-1));
        this.pending.attemptNumber++;this.pending.inFlight=true;
        delete this.pending.retryAt;
        this.recovery={...this.recovery,phase:this.pending.lastFailure?.retry==='technical'?'retrying':this.pending.corrections.length?'correcting':'generating',agentId,turnIndex:this.currentTurnIndex,attemptNumber:this.pending.attemptNumber,correctiveRetry:this.pending.correctiveRetries,correctiveLimit:this.recoveryConfig.correctiveRetries,simulationMinute:this.world?.minute};
        await this.saveExecution();
        if(this.recoveryConfig.enabled&&(this.shouldPause||this.shouldStop))throw new RecoveryCancelled();
        this.emit('turn_started',{agentId,turnIndex:this.currentTurnIndex});this.publishStatus();
        const execution=this.config!.decisionConfig?.mode==='agent_selected'||this.config!.communicationConfig
            ?executionContext(this.config!,agentId,opConfig,currentOperational(original.state).location.id,configuredWorldActions(this.config!.worldConfig)):undefined;
        this.currentAttempt = { startedAt: new Date().toISOString(), prompt: { system: prompt.system, messages: prompt.messages }, retrieval: prompt.retrieval, ...(opContext ? {operationalContext:opContext} : {}),...(worldObservation?{worldObservation,schedulerDecision}:{}) };
        this.llmAdapter.setExperimentConfig(this.config!.llmConfig);
        this.inferenceAbort=this.recoveryConfig.enabled?new AbortController():undefined;
        const response = await this.llmAdapter.generateTurn(prompt.system, prompt.messages, this.config!.protocol?.inputCharLimit, environment.socialConfig.enabled, environment.taskConfig.kind !== 'none', opConfig.enabled, !!this.world,this.inferenceAbort?.signal,this.recoveryConfig.enabled?async request=>{this.pending.preparedRequest=request;await this.saveExecution();}:undefined,this.config!.decisionConfig?.mode==='agent_selected',!!this.config!.communicationConfig,execution);
        if(this.recoveryConfig.enabled&&(this.shouldPause||this.shouldStop))throw new RecoveryCancelled();
        this.pending.technicalFailures=0;
        this.currentAttempt.parsedResponse = response;
        // Independent checks are accumulated before any candidate can commit. Never pick a
        // location from an ambiguous itinerary just to validate its dependent world effects.
        const violations:TurnViolation[]=execution?executionViolations(response,execution):[];
        if(!execution)validateDecision(response,this.config!,agentId);
        else try{validateDecision(response,this.config!,agentId);}catch(error){violations.push({code:'INVALID_AGENT_ACTION',path:'/social',message:(error as Error).message});}
        const moves=(response.operational_operations??[]).filter(op=>op.action==='set_location');
        const unambiguous=moves.length<=1&&(!moves.length||opConfig.locations.some((l:{id:string})=>l.id===moves[0].location_id));
        if(unambiguous){
            const location=moves.length?moves[0].location_id:currentOperational(prompt.state).location.id;
            if(execution&&this.world)for(const [index,op] of (response.world_operations??[]).entries())if(op.action==='inspect_inventory'){
                const inventory=this.world.inventories.find(i=>i.id===op.inventory_id);
                if(inventory&&(inventory.ownerType==='location'?inventory.ownerId!==location:inventory.ownerId!==agentId&&(location==='unspecified'||this.world.positions[inventory.ownerId]!==location)))violations.push({code:'INVENTORY_NOT_ACCESSIBLE',path:`/world_operations/${index}`,message:'Remote inventory inspection is not permitted. Inspect authorized storage at your authoritative post-move location; a planned destination does not move you.'});
            }
            // Routing is a pure authorization check: no observations/messages are published here.
            try{routeMessage(response,this.config!,agentId,this.currentTurnIndex,{...this.world?.positions,[agentId]:location},this.world?.minute??0);}
            catch(error){if(!violations.some(issue=>issue.code==='INVALID_COMMUNICATION'))violations.push({code:'INVALID_COMMUNICATION',path:'/communication',message:(error as Error).message});}
        }
        if(violations.length){this.currentAttempt.turnValidation={status:'rejected',violations};this.currentAttempt.decisionValidation={status:'rejected',violations};throw new ProposalError(violations.map(issue=>issue.message).join('\n'),violations[0].code,violations);}
        this.currentAttempt.turnValidation={status:'passed'};
        try{validateIntent(response,this.config!);this.currentAttempt.decisionValidation={status:'passed'};}catch(error){this.currentAttempt.decisionValidation={status:'rejected',error:(error as Error).message};throw error;}
        const eventId = this.pending.logicalTurnId;
        const config = resolveMemoryConfig(this.config!.memoryConfig);
        const operational = prepareOperational(prompt.state,response.operational_operations ?? [],opConfig,{runId:this.config!.runId,turnIndex:this.currentTurnIndex,eventId});
        if(opConfig.enabled)this.currentAttempt.operationalAudit=operational.audit;
        if(operational.error)throw new OperationalError(operational.error);
        const prepared = this.memoryManager.prepareOperations(operational.state, response.memory_operations, {
            source: { runId: this.config!.runId, turnIndex: this.currentTurnIndex, eventId },
            participants: this.config!.agentIds, config
        });
        this.currentAttempt.memoryAudit=prepared.auditTrail;
        const rejectedMemory=prepared.auditTrail.find((event:any)=>event.status==='failed');
        if(rejectedMemory)throw new ProposalError(rejectedMemory.error);
        const positions={...this.world?.positions,[agentId]:currentOperational(prepared.state).location.id};
        let message:ReturnType<typeof routeMessage>;
        try{message=routeMessage(response,this.config!,agentId,this.currentTurnIndex,positions,this.world?.minute??0);this.currentAttempt.communicationValidation={status:'passed'};}catch(error){this.currentAttempt.communicationValidation={status:'rejected',error:(error as Error).message};throw error;}
        let worldResult:ReturnType<typeof prepareWorld>|undefined;
        if(this.world){
            this.currentAttempt.worldOperations=structuredClone(response.world_operations);
            try{worldResult=prepareWorld(this.world,this.config!.worldConfig as WorldConfig,agentId,response.world_operations,currentOperational(prepared.state).location.id,this.config!.agentIds,`${this.config!.runId}:turn:${this.currentTurnIndex}`,response.response,response.social?.recipient_id??null,this.config!.communicationConfig?message??null:undefined);}
            catch(error){this.currentAttempt.worldValidation={status:'rejected',error:(error as Error).message};throw error;}
            this.currentAttempt.worldValidation={status:'passed'};
        }
        const record = {
            schemaVersion: 2, eventId,
            ...(this.pending.context.selection?{schedulerDecision:this.pending.context.selection.evidence,schedulerStateAfter:this.pending.context.selection.stateAfter}:{}),
            ...(response.decision?{decision:response.decision,decisionValidation:{status:'passed'}}:{}),
            ...(this.config!.communicationConfig?{communication:response.communication,message:message??null,messageRecipients:message?.recipientAgentIds??[]}:{}), ...(this.recoveryConfig.enabled?{recoveryPolicy:structuredClone(this.recoveryConfig),recoverySummary:{attempts:this.pending.attemptNumber,correctiveAttempts:this.pending.totalCorrections,technicalFailures:this.pending.totalTechnicalFailures,retryElapsedMs:this.pending.retryStartedAt?Date.now()-this.pending.retryStartedAt:0,totalTurnElapsedMs:Date.now()-Date.parse(this.pending.startedAt),correctionSucceeded:this.pending.totalCorrections>0}}:{}), stateScope: this.config!.protocol?.stateScope ?? 'shared', configHash: this.configHash, runId: this.config!.runId,
            turnIndex: this.currentTurnIndex, agentId, agentName: prompt.state.identity.name,
            ...(environment.socialConfig.enabled ? {social:response.social,taskDecision:response.task_decision} : {}),
            ...(opConfig.enabled ? {operationalContext:opContext,operationalAudit:operational.audit,operationalState:currentOperational(prepared.state),
                turnKind:response.response ? (operational.audit.length ? 'speech_and_action':'speech') : (operational.audit.length ? 'action_only':'intentional_noop')} : {}),
            environmentEvents: [...(this.pending.context.selection?[{id:eventId+':scheduler',type:'scheduler_decision',source:'backend_scheduler',...this.pending.context.selection.evidence}]:[]),...(response.decision?[{id:eventId+':decision',type:'agent_decision',agentId,decision:response.decision,validation:'passed'}]:[]),...(worldResult?.events??[])],
            ...(worldResult?{simulationMinute:this.world!.minute,worldBefore:this.world,worldAfter:worldResult.state,worldObservation,...(!this.pending.context.selection?{schedulerDecision}:{}),worldOperations:response.world_operations,worldValidation:{status:'passed'},messageRecipients:message?.recipientAgentIds??worldResult.recipients}:{}),
            response: response.response, timestamp: new Date().toISOString(),
            auditTrail: prepared.auditTrail, stateBefore: prompt.state, stateAfter: prepared.state,
            memoryMode: config.mode, retrieval: prompt.retrieval,
            startedAt: this.currentAttempt.startedAt, elapsedMs: Date.now() - Date.parse(this.currentAttempt.startedAt),
            prompt: { system: prompt.system, messages: prompt.messages },
            ...(this.recoveryConfig.enabled?{originalPrompt:{system:original.system,messages:original.messages}}:{}),
            request: this.llmAdapter.lastRequest, parsedResponse: response, rawResponse: this.llmAdapter.lastRawContent,
            llmValidation: this.llmAdapter.lastValidation, diagnostics: this.llmAdapter.lastDiagnostics
        };
        if (environment.taskConfig.kind !== 'none' && (this.currentTurnIndex + 1) % this.config!.agentIds.length === 0) {
            const previous = await this.jsonlStorage.getConversationHistory(this.config!.runId);
            record.environmentEvents.push(...settleRound(this.config!, [...previous.slice(-(this.config!.agentIds.length - 1)), record]));
        }
        await this.commitRecord(record);
    }
    private async finishAtLimit(){
        if(this.config&&this.currentTurnIndex>=this.config.maxTurns&&!this.shouldStop){
            await this.recordHistoryControl('limit_reached');
            if(!this.shouldStop){await this.saveExecution({lifecycle:'completed'});await this.jsonlStorage.releaseWriter(this.writerId);this.status='completed';}
        }
    }
    private async commitForfeiture(){
        const config={...this.config!,recoveryConfig:this.recoveryConfig};
        const record=forfeitedRecord(config,this.configHash,this.pending,this.world,await this.jsonlStorage.getEventHistory(config.runId));
        if(resolveEnvironment(config).taskConfig.kind!=='none'&&(this.currentTurnIndex+1)%config.agentIds.length===0){
            const previous=await this.jsonlStorage.getConversationHistory(config.runId);
            record.environmentEvents.push(...settleRound(config,[...previous.slice(-(config.agentIds.length-1)),record]));
        }
        await this.commitRecord(record);
    }
    private async commitRecord(record:any){
        // Commit before touching editable state. Recovery reapplies this exact state,
        // never the model's operations, so retries cannot duplicate adds or inference.
        if(this.recoveryConfig.enabled&&(this.shouldPause||this.shouldStop))throw new RecoveryCancelled();
        this.pending.expectedCommitHash=hash(record);this.pending.commitCandidate=record;
        await this.saveExecution();
        if(this.recoveryConfig.enabled&&(this.shouldPause||this.shouldStop))throw new RecoveryCancelled();
        await this.jsonlStorage.appendConversationTurn(this.config!.runId, record);
        this.currentTurnIndex++;
        if(record.worldAfter)this.world=record.worldAfter;
        try { await this.jsonlStorage.projectTurn(this.config!.runId, record, this.jsonStorage); }
        catch { throw new TurnProjectionError('Turn is committed, but its working-state/audit update failed. Resume will repair it before the next inference'); }
        const { stateBefore, stateAfter, prompt: renderedPrompt, parsedResponse, rawResponse, ...turnRecord } = record;
        for (const event of record.environmentEvents) this.emit('environment_event', event);
        if(record.forfeitureEvent)this.emit('environment_event',record.forfeitureEvent);
        this.emit('turn_completed', { turnRecord, auditTrail: record.auditTrail });
        this.pending=null;this.recovery={phase:'idle'};this.lastError=null;await this.saveExecution();
    }
}
