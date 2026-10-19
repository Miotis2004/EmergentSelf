import {projectHistory, queryHistory, validateHistory, HistoryQuery, TaskHistoryRecord} from '../taskHistory/history';
import {hash} from '../research/protocol';
import {WorldState, initialWorld, assertWorldCompatible} from '../world/simulation';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { JsonStorage } from './JsonStorage';
import { WorkingState } from '../memory/types';
import { diffStates } from '../memory/history';

export class TurnProjectionError extends Error {}

export class JsonlStorage {
    private baseDir: string;
    private historyWrites=new Map<string,Promise<any>>();

    private historySources=new Map<string,{signature:string;size:number;ino:number;records:any[]}>();
    private sourceSignature(stat:any){return [stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');}
    private compactHistorySource(record:any,kind:'turn'|'event'):any|null {
        if(kind==='turn')return {schemaVersion:record.schemaVersion,eventId:record.eventId,turnIndex:record.turnIndex,agentId:record.agentId,response:record.response?true:false,timestamp:record.timestamp,environmentEvents:record.environmentEvents,operationalAudit:record.operationalAudit};
        if(record.type==='world_checkpoint')return {id:record.id,type:record.type,beforeTurn:record.beforeTurn,simulationMinute:record.simulationMinute,events:record.events,timestamp:record.timestamp};
        if(record.type==='recovery_attempt'||record.type==='experiment_error')return {id:record.id,type:record.type,agentId:record.agentId,category:record.category,code:record.code,turnIndex:record.turnIndex,logicalTurnIndex:record.logicalTurnIndex,stateCommitted:record.stateCommitted,timestamp:record.timestamp,explanation:record.explanation,message:record.message,proposedOperations:{world:record.proposedOperations?.world??record.proposal?.parsed?.world_operations??record.attempt?.parsedResponse?.world_operations??record.attempt?.worldOperations},attempt:{operationalAudit:record.attempt?.operationalAudit,worldValidation:record.attempt?.worldValidation}};
        if(record.type==='task_history_control'||record.type?.startsWith('transformation_')||record.type==='resource_reserved'||record.type==='resource_released'||record.type==='world_operation')return record;
        return null;
    }
    private async historySource(file:string,kind:'turn'|'event'){
        let stat;try{stat=await fs.stat(file);}catch(error:any){if(error.code==='ENOENT')return [];throw error;}
        const signature=this.sourceSignature(stat),cached=this.historySources.get(file);
        if(cached?.signature===signature)return cached.records;
        const records=(await this.readJsonl<any>(file)).map(r=>this.compactHistorySource(r,kind)).filter(Boolean);
        const after=await fs.stat(file);
        if(this.sourceSignature(after)===signature)this.historySources.set(file,{signature,size:stat.size,ino:stat.ino,records});
        return records;
    }

    async reconcileTaskHistory(runId:string):Promise<TaskHistoryRecord[]> {
        const previous=this.historyWrites.get(runId)??Promise.resolve();
        const work=previous.catch(()=>{}).then(async()=>{
            const config=await this.loadConfig(runId);if(!config?.worldConfig?.enabled)return [];
            const dirPath=this.getExperimentDir(runId);
            const turns=await this.historySource(path.join(dirPath,'conversation.jsonl'),'turn');
            const events=await this.historySource(path.join(dirPath,'events.jsonl'),'event');
            const records=projectHistory(runId,config,turns,events);
            const projection={version:1,sourceHash:hash([config,turns.map(t=>[t.eventId,t.turnIndex,t.environmentEvents,t.operationalAudit,!!t.response,t.timestamp]),events]),records};
            const dir=path.join(this.baseDir,'task-history');
            const target=path.join(dir,runId+'.jsonl');
            const cached=new Map<string,TaskHistoryRecord>();
            for(const batch of await this.readJsonl<any>(target)){
                if(batch.version!==1)throw new Error('Unsupported history projection version');
                for(const record of batch.updates??[])cached.set(record.id,record);
                for(const id of batch.removedIds??[])cached.delete(id);
            }
            const updates=records.filter(r=>hash(cached.get(r.id)??null)!==hash(r));
            const ids=new Set(records.map(r=>r.id)),removedIds=[...cached.keys()].filter(id=>!ids.has(id));
            if(updates.length||removedIds.length){await this.ensureDir(dir);await this.appendJsonl(target,{version:1,sourceHash:projection.sourceHash,updates,removedIds});}
            return structuredClone(records);
        });
        this.historyWrites.set(runId,work);
        try{return await work;}catch(error:any){throw Object.assign(new Error(`Task-history projection needs repair: ${error.message}`),{code:'EIO'});}
        finally{if(this.historyWrites.get(runId)===work)this.historyWrites.delete(runId);}
    }

    async rebuildTaskHistory(runId:string,owner:string){
        if(!this.ownsWriter(owner))throw new Error('History rebuild requires the research writer lease');
        const dir=this.getExperimentDir(runId);
        if(!await this.loadConfig(runId))throw new Error('Unknown run');
        // Validate canonical JSON before quarantining a disposable projection.
        await this.getConversationHistory(runId);await this.getEventHistory(runId);
        this.historySources.delete(path.join(dir,'conversation.jsonl'));this.historySources.delete(path.join(dir,'events.jsonl'));
        const target=path.join(this.baseDir,'task-history',runId+'.jsonl');
        let quarantined:string|null=null;
        try {await fs.access(target);const quarantine=path.join(this.baseDir,'task-history','quarantine');await this.ensureDir(quarantine);quarantined=path.join(quarantine,runId+'.'+randomUUID()+'.jsonl');await fs.rename(target,quarantined);}
        catch(error:any){if(error.code!=='ENOENT')throw error;}
        const records=await this.reconcileTaskHistory(runId);return {runId,records:records.length,quarantined};
    }

    async taskHistory(agentId:string,query:HistoryQuery={}) {
        // Validate before filesystem reads. Per-run projection is keyed by agent/run/task
        // and rebuildable exclusively from canonical records; cache is never evidence.
        queryHistory([],agentId,query);
        const runs=query.runId?[query.runId]:await this.listRuns();
        const records:TaskHistoryRecord[]=[];
        for(const runId of runs){const config=await this.loadConfig(runId);if(config?.agentIds?.includes(agentId))records.push(...await this.reconcileTaskHistory(runId));}
        return queryHistory(records,agentId,query);
    }

    async snapshotTaskHistory(snapshot:any,agentId:string):Promise<TaskHistoryRecord[]> {
        if(snapshot.taskHistory){if(hash(snapshot.taskHistory)!==snapshot.taskHistoryHash)throw new Error('Snapshot task history hash mismatch');validateHistory(snapshot.taskHistory);return snapshot.taskHistory.filter((r:TaskHistoryRecord)=>r.agentId===agentId);}
        if(!snapshot.sourceRunId||!Number.isSafeInteger(snapshot.sourceTurnIndex))return [];
        const runId=snapshot.sourceRunId,config=await this.loadConfig(runId);if(!config)return [];
        const turns=(await this.getConversationHistory(runId)).filter(t=>t.turnIndex<=snapshot.sourceTurnIndex);
        const events=(await this.getEventHistory(runId)).filter(e=>e.type==='world_checkpoint'?e.beforeTurn<=snapshot.sourceTurnIndex:['recovery_attempt','experiment_error','task_history_control'].includes(e.type)&&e.turnIndex<=snapshot.sourceTurnIndex);
        const own=projectHistory(runId,config,turns,events).filter(r=>r.agentId===agentId);
        return [...await this.historyBaseline(runId,agentId),...own];
    }

    private async historyBaseline(runId:string,agentId:string):Promise<TaskHistoryRecord[]> {
        try {const saved=JSON.parse(await fs.readFile(path.join(this.getExperimentDir(runId),'task-history-baseline.json'),'utf8'));if(hash(saved.records)!==saved.hash)throw new Error('Task history baseline hash mismatch');validateHistory(saved.records);return saved.records.filter((r:TaskHistoryRecord)=>r.agentId===agentId);}
        catch(error:any){if(error.code==='ENOENT')return [];throw error;}
    }

    async ensureTaskHistoryBaseline(runId:string,agents:string[],protocol:any,fresh:boolean){
        const target=path.join(this.getExperimentDir(runId),'task-history-baseline.json');
        try{await fs.access(target);for(const agent of agents)await this.historyBaseline(runId,agent);return;}
        catch(error:any){if(error.code!=='ENOENT')throw error;}
        if(!fresh&&!protocol?.snapshotId)return;
        const records:TaskHistoryRecord[]=[];
        for(const agent of agents){
            const history=protocol?.snapshotId?await this.snapshotTaskHistory(await this.loadArtifact('snapshots',protocol.snapshotId),agent):fresh?await this.allTaskHistory(agent):[];
            records.push(...queryHistory(history.filter(r=>r.runId!==runId&&r.taskType!=='report'),agent,{limit:500}).records);
        }
        const value={version:1,hash:hash(records),records};
        // Publish complete immutable baseline. Never adopt later experience into an old run.
        const temporary=target+'.'+randomUUID()+'.tmp';
        try{await fs.writeFile(temporary,JSON.stringify(value));await fs.link(temporary,target);}
        catch(error:any){if(error.code!=='EEXIST')throw error;}
        finally{await fs.rm(temporary,{force:true});}
    }

    async inferenceTaskHistory(runId:string,agentId:string):Promise<TaskHistoryRecord[]> {
        return [...await this.historyBaseline(runId,agentId),...(await this.reconcileTaskHistory(runId)).filter(r=>r.agentId===agentId)];
    }

    async allTaskHistory(agentId:string):Promise<TaskHistoryRecord[]> {
        const records:TaskHistoryRecord[]=[];
        for(const runId of await this.listRuns()){const config=await this.loadConfig(runId);if(config?.agentIds?.includes(agentId))records.push(...(await this.reconcileTaskHistory(runId)).filter(r=>r.agentId===agentId));}
        return records;
    }

    constructor(baseDir: string = path.join(process.cwd(), '../researcher')) {
        this.baseDir = baseDir;
    }

    private getExperimentDir(runId: string): string {
        if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error('Invalid run ID');
        return path.join(this.baseDir, 'experiments', runId);
    }

    private async ensureDir(dirPath: string): Promise<void> {
        await fs.mkdir(dirPath, { recursive: true });
    }

    /**
     * Appends an event to a JSONL file.
     */
    private async appendJsonl(filePath: string, data: any): Promise<void> {
        const line = JSON.stringify(data) + '\n';
        const cached=this.historySources.get(filePath);
        let current:any;
        if(cached){try{current=await fs.stat(filePath);}catch(error:any){if(error.code!=='ENOENT')throw error;}}
        await fs.appendFile(filePath, line, 'utf-8');
        if(cached&&current&&this.sourceSignature(current)===cached.signature){
            const after=await fs.stat(filePath);
            if(after.ino===cached.ino&&after.size===cached.size+Buffer.byteLength(line)){
                const compact=this.compactHistorySource(data,path.basename(filePath)==='conversation.jsonl'?'turn':'event');
                if(compact)cached.records.push(structuredClone(compact));
                cached.size=after.size;cached.signature=this.sourceSignature(after);
            }else this.historySources.delete(filePath);
        }else if(cached)this.historySources.delete(filePath);
    }

    /**
     * Creates immutable experimental configuration; never replaces an existing file.
     */
    async saveConfig(runId: string, config: any): Promise<void> {
        const expDir = this.getExperimentDir(runId);
        await this.ensureDir(expDir);
        await fs.writeFile(path.join(expDir, 'config.json'), JSON.stringify(config, null, 2), { encoding: 'utf-8', flag: 'wx' });
    }

    async loadConfig(runId: string): Promise<any | null> {
        try {
            return JSON.parse(await fs.readFile(path.join(this.getExperimentDir(runId), 'config.json'), 'utf-8'));
        } catch (error: any) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
    }

    async ensureMemoryBaseline(runId: string, atTurn: number, states: Record<string, WorkingState>) {
        const dir = this.getExperimentDir(runId);
        await this.ensureDir(dir);
        try {
            await fs.writeFile(path.join(dir, 'memory-baseline.json'), JSON.stringify({ schemaVersion: 2, atTurn, states }), { encoding: 'utf8', flag: 'wx' });
        } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
    }

    async memoryHistory(runId: string, agentId: string, turn?: number, compareTo?: number) {
        if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error('Invalid agent ID');
        const baseline = JSON.parse(await fs.readFile(path.join(this.getExperimentDir(runId), 'memory-baseline.json'), 'utf8'));
        if (!Object.hasOwn(baseline.states, agentId)) throw new Error('Agent is not a participant in this memory history');
        const history = await this.getConversationHistory(runId);
        const last = Math.max(baseline.atTurn, history.length - 1);
        const stateAt = (index: number): WorkingState => {
            if (!Number.isSafeInteger(index) || index < baseline.atTurn || index > last) throw new Error(`Historical turn must be between ${baseline.atTurn} and ${last}`);
            let state = baseline.states[agentId];
            for (const record of history) {
                if (record.turnIndex > baseline.atTurn && record.turnIndex <= index && record.agentId === agentId) {
                    if (!record.stateAfter) throw new Error('Historical state was not recorded for this legacy turn');
                    state = record.stateAfter;
                }
            }
            return structuredClone(state);
        };
        const selected = turn ?? last;
        const state = stateAt(selected);
        return {
            runId, agentId, turnIndex: selected, baselineTurn: baseline.atTurn, lastTurn: last, state,
            timeline: history.filter(record => record.agentId === agentId && record.schemaVersion === 2).map(record => ({
                turnIndex: record.turnIndex, eventId: record.eventId, timestamp: record.timestamp,
                operations: record.auditTrail, retrieval: record.retrieval, ...(record.operationalAudit ? {operationalAudit:record.operationalAudit,operationalState:record.operationalState} : {})
            })),
            ...(compareTo === undefined ? {} : { compareTo, diff: diffStates(stateAt(compareTo), state) })
        };
    }

    // The conversation record is the write-ahead commit. Projection/event writes
    // are idempotently repaired before any subsequent inference, even after restart.
    async projectTurn(runId: string, record: any, storage: JsonStorage) {
        if (record.stateScope === 'trial') storage = this.trialStorage(runId);
        if ((record.memoryMode !== 'none' && record.memoryMode !== 'history') || record.operationalState) await storage.saveWorkingState(record.agentId, record.stateAfter);
        const existingEvents = await this.getEventHistory(runId);
        const recorded = new Set(existingEvents.map(event=>event.id));
        for (const event of record.environmentEvents ?? []) if (!recorded.has(event.id)) await this.appendEvent(runId, event);
        await this.reconcileTaskHistory(runId);
        await this.appendEvent(runId, {
            schemaVersion: 2, id: record.eventId, type: 'memory_update',
            turnIndex: record.turnIndex, agentId: record.agentId, timestamp: record.timestamp,
            operations: record.auditTrail, retrieval: record.retrieval, ...(record.operationalAudit ? {operationalAudit:record.operationalAudit,operationalState:record.operationalState} : {})
        });
    }

    async recoverPendingTurns(storage: JsonStorage) {
        const dir = path.join(this.baseDir, 'experiments');
        let runs;
        try { runs = await fs.readdir(dir, { withFileTypes: true }); }
        catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
        for (const run of runs.filter(entry => entry.isDirectory())) {
            const history = await this.getConversationHistory(run.name);
            const events = await this.getEventHistory(run.name);
            const projected = new Set(events.filter(e => e.type === 'memory_update').map(e => e.id));
            for (const record of history) {
                if (record.schemaVersion === 2 && !projected.has(record.eventId)) await this.projectTurn(run.name, record, storage);
            }
            await this.reconcileTaskHistory(run.name);
        }
    }

    // Canonical world state is embedded in immutable turn/checkpoint commits, not a mutable file.
    async worldAt(runId:string, atTurn?:number):Promise<WorldState|undefined> {
        const config=await this.loadConfig(runId);
        if(!config?.worldConfig?.enabled)return undefined;
        let initial:WorldState|undefined;
        if(config.protocol?.snapshotId){const snapshot=await this.loadArtifact('snapshots',config.protocol.snapshotId);if(snapshot.worldState&&hash(snapshot.worldState)!==snapshot.worldHash)throw new Error('Snapshot world hash mismatch');initial=snapshot.worldState;}
        let state=structuredClone(initial??initialWorld(config.worldConfig,config.agentIds));
        const records=[...(await this.getConversationHistory(runId)).filter(t=>atTurn===undefined||t.turnIndex<=atTurn),
            ...(await this.getEventHistory(runId)).filter(e=>e.type==='world_checkpoint'&&(atTurn===undefined||e.beforeTurn<=atTurn))];
        for(const record of records.sort((a,b)=>(a.worldAfter?.revision??-1)-(b.worldAfter?.revision??-1)))if(record.worldAfter&&record.worldAfter.revision>state.revision)state=structuredClone(record.worldAfter);
        assertWorldCompatible(state,config.worldConfig,config.agentIds,config.operationalConfig.locations.map((l:any)=>l.id));
        return state;
    }

    async latestExecution(runId:string):Promise<any|undefined> {
        const events=await this.getEventHistory(runId);
        const last=events.filter(event=>event.type==='execution_checkpoint'||event.type==='recovery_attempt').at(-1);
        return last?.checkpoint;
    }

    trialStorage(runId: string) { return new JsonStorage(path.join(this.getExperimentDir(runId), 'working-state')); }
    async loadBaseline(runId: string): Promise<any> {
        return JSON.parse(await fs.readFile(path.join(this.getExperimentDir(runId), 'memory-baseline.json'), 'utf8'));
    }
    async saveArtifact(kind: 'templates' | 'snapshots' | 'batches' | 'probe-definitions' | 'benchmarks' | 'benchmark-sessions' | 'evaluations-private' | 'ratings' | 'branches' | 'branch-comparisons' | 'studies' | 'publications', artifactId: string, value: any) {
        if (!/^[A-Za-z0-9_-]{1,120}$/.test(artifactId)) throw new Error('Invalid artifact ID');
        const dir = path.join(this.baseDir, kind);
        await this.ensureDir(dir);
        const target = path.join(dir, `${artifactId}.json`);
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, JSON.stringify(value, null, 2), {flag:'wx'});
            // Publish the complete immutable document atomically, without replacing an ID.
            await fs.link(temporary, target);
        } finally { await fs.rm(temporary, {force:true}); }
    }
    async loadArtifact(kind: 'templates' | 'snapshots' | 'batches' | 'probe-definitions' | 'benchmarks' | 'benchmark-sessions' | 'evaluations-private' | 'ratings' | 'branches' | 'branch-comparisons' | 'studies' | 'publications', artifactId: string): Promise<any> {
        if (!/^[A-Za-z0-9_-]{1,120}$/.test(artifactId)) throw new Error('Invalid artifact ID');
        return JSON.parse(await fs.readFile(path.join(this.baseDir, kind, `${artifactId}.json`), 'utf8'));
    }
    async listArtifacts(kind: 'templates' | 'snapshots' | 'batches' | 'probe-definitions' | 'benchmarks' | 'benchmark-sessions' | 'evaluations-private' | 'ratings' | 'branches' | 'branch-comparisons' | 'studies' | 'publications') {
        try { return (await fs.readdir(path.join(this.baseDir, kind))).filter(file => file.endsWith('.json')).map(file => file.slice(0,-5)).sort(); }
        catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
    }
    async listRuns() {
        try { return (await fs.readdir(path.join(this.baseDir, 'experiments'), {withFileTypes:true})).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(); }
        catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
    }
    async appendResearch(runId: string, stream: 'probes' | 'interventions' | 'benchmarks' | 'feedback' | 'branch-comparisons', record: any) {
        const dir = this.getExperimentDir(runId); await this.ensureDir(dir);
        await this.appendJsonl(path.join(dir, `${stream}.jsonl`), record);
    }
    async readResearch(runId: string, stream: 'probes' | 'interventions' | 'benchmarks' | 'feedback' | 'branch-comparisons'): Promise<any[]> {
        return this.readJsonl(path.join(this.getExperimentDir(runId), `${stream}.jsonl`));
    }

    private lockOwner: string | null = null;
    async acquireWriter(owner: string): Promise<void> {
        if (this.lockOwner === owner) return;
        await this.ensureDir(this.baseDir);
        const file = path.join(this.baseDir, '.writer.lock');
        try {
            await fs.writeFile(file, JSON.stringify({ pid: process.pid, owner }), { flag: 'wx' });
        } catch (error: any) {
            if (error.code !== 'EEXIST') throw error;
            const existing = JSON.parse(await fs.readFile(file, 'utf8'));
            try { process.kill(existing.pid, 0); }
            catch (probe: any) {
                if (probe.code !== 'ESRCH') throw probe;
                await fs.unlink(file);
                return this.acquireWriter(owner);
            }
            throw new Error('Another experiment writer owns this research store; stop it before starting');
        }
        this.lockOwner = owner;
    }
    ownsWriter(owner: string) { return this.lockOwner === owner; }
    async releaseWriter(owner: string) {
        if (this.lockOwner !== owner) return;
        const file = path.join(this.baseDir, '.writer.lock');
        const saved = JSON.parse(await fs.readFile(file, 'utf8'));
        if (saved.owner === owner) await fs.unlink(file);
        this.lockOwner = null;
    }

    /**
     * Appends a conversation turn to the log.
     */
    async appendConversationTurn(runId: string, turn: any): Promise<void> {
        const expDir = this.getExperimentDir(runId);
        await this.ensureDir(expDir);
        await this.appendJsonl(path.join(expDir, 'conversation.jsonl'), turn);
    }

    /**
     * Appends a state or memory change event to the log.
     */
    async appendEvent(runId: string, event: any): Promise<void> {
        const expDir = this.getExperimentDir(runId);
        await this.ensureDir(expDir);
        await this.appendJsonl(path.join(expDir, 'events.jsonl'), event);
        if(['world_checkpoint','task_history_control'].includes(event.type)||event.type==='recovery_attempt'&&['invalid_action','schema_validation'].includes(event.category)||event.type==='experiment_error'&&(event.attempt?.worldValidation?.status==='rejected'||event.attempt?.operationalAudit?.some((a:any)=>a.status==='rejected')))await this.reconcileTaskHistory(runId);
    }

    /**
     * Reads all lines from a JSONL file.
     */
    async readJsonl<T>(filePath: string): Promise<T[]> {
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return data.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => JSON.parse(line) as T);
        } catch (error: any) {
             if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    async getConversationHistory(runId: string): Promise<any[]> {
        const expDir = this.getExperimentDir(runId);
        return this.readJsonl(path.join(expDir, 'conversation.jsonl'));
    }

    async getEventHistory(runId: string): Promise<any[]> {
         const expDir = this.getExperimentDir(runId);
         return this.readJsonl(path.join(expDir, 'events.jsonl'));
    }
}
