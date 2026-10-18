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
        await fs.appendFile(filePath, line, 'utf-8');
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
