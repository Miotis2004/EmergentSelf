import fs from 'fs/promises';
import path from 'path';
import { WorkingState, importLegacy } from '../memory/types';
import { randomUUID } from 'crypto';

/**
 * Interface representing the structure of an agent's persistent state.
 */
export interface AgentState {
    id: string;
    name: string;
    stats: {
        [key: string]: {
            initial: number;
            current: number;
        };
    };
    memories: any[]; // Editable working memories
    beliefs: any[]; // Beliefs about the world or other agents
}

export class JsonStorage {
    private baseDir: string;

    constructor(baseDir: string = path.join(process.cwd(), '../model_memories')) {
        this.baseDir = baseDir;
    }

    private getAgentDir(agentId: string): string {
        if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error('Invalid agent ID');
        return path.join(this.baseDir, 'agents', agentId);
    }

    private async ensureDir(dirPath: string): Promise<void> {
        await fs.mkdir(dirPath, { recursive: true });
    }

    /**
     * Atomically writes data to a JSON file.
     */
    private async atomicWrite(filePath: string, data: any): Promise<void> {
        const tempPath = `${filePath}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
            await fs.rename(tempPath, filePath);
        } finally {
            await fs.rm(tempPath, { force: true });
        }
    }

    /**
     * Reads a JSON file, returning null if it doesn't exist.
     */
    private async readJson<T>(filePath: string): Promise<T | null> {
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data) as T;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    /**
     * Saves the agent's identity state.
     */
    async saveAgentIdentity(agentId: string, state: AgentState): Promise<void> {
        const agentDir = this.getAgentDir(agentId);
        await this.ensureDir(agentDir);
        const current = await this.readJson<WorkingState>(path.join(agentDir, 'state.json'));
        if (current) { current.identity = state; await this.saveWorkingState(agentId, current); }
        else await this.atomicWrite(path.join(agentDir, 'identity.json'), state);
    }

    /**
     * Loads the agent's identity state.
     */
    async loadAgentIdentity(agentId: string): Promise<AgentState | null> {
        const agentDir = this.getAgentDir(agentId);
        const state = await this.readJson<WorkingState>(path.join(agentDir, 'state.json'));
        return state?.identity ?? this.readJson<AgentState>(path.join(agentDir, 'identity.json'));
    }

    /**
     * Saves the agent's editable memory.
     */
    async saveAgentMemory(agentId: string, memories: any[]): Promise<void> {
        const agentDir = this.getAgentDir(agentId);
        await this.ensureDir(agentDir);
        if (await this.readJson<WorkingState>(path.join(agentDir, 'state.json'))) throw new Error('Use audited Phase II operations to revise canonical memory');
        await this.atomicWrite(path.join(agentDir, 'memory.json'), memories);
    }

    /**
     * Loads the agent's editable memory.
     */
    async loadAgentMemory(agentId: string): Promise<any[] | null> {
        const agentDir = this.getAgentDir(agentId);
        const state = await this.readJson<WorkingState>(path.join(agentDir, 'state.json'));
        return state ? state.entries.filter(e => e.type === 'episodic' && e.status === 'active') : this.readJson<any[]>(path.join(agentDir, 'memory.json'));
    }

    /**
     * Saves the agent's beliefs.
     */
    async saveAgentBeliefs(agentId: string, beliefs: any[]): Promise<void> {
        const agentDir = this.getAgentDir(agentId);
        await this.ensureDir(agentDir);
        if (await this.readJson<WorkingState>(path.join(agentDir, 'state.json'))) throw new Error('Use audited Phase II operations to revise canonical beliefs');
        await this.atomicWrite(path.join(agentDir, 'beliefs.json'), beliefs);
    }

    /**
     * Loads the agent's beliefs.
     */
    async loadAgentBeliefs(agentId: string): Promise<any[] | null> {
        const agentDir = this.getAgentDir(agentId);
        const state = await this.readJson<WorkingState>(path.join(agentDir, 'state.json'));
        return state ? state.entries.filter(e => e.type === 'belief' && e.status === 'active') : this.readJson<any[]>(path.join(agentDir, 'beliefs.json'));
    }

    async loadWorkingState(agentId: string): Promise<WorkingState> {
        const dir = this.getAgentDir(agentId);
        const current = await this.readJson<WorkingState>(path.join(dir, 'state.json'));
        if (current) {
            if (current.schemaVersion !== 2) throw new Error('Unsupported working state schema');
            return current;
        }
        const identity = await this.readJson<AgentState>(path.join(dir, 'identity.json'));
        if (!identity) throw new Error(`Agent ${agentId} not found`);
        return importLegacy(identity, await this.readJson<any[]>(path.join(dir, 'memory.json')) || [], await this.readJson<any[]>(path.join(dir, 'beliefs.json')) || []);
    }

    async createClone(agentId: string, state: WorkingState): Promise<void> {
        if (state.identity.id !== agentId) throw new Error('Invalid clone identity');
        const dir = this.getAgentDir(agentId);
        await this.ensureDir(path.dirname(dir));
        await fs.mkdir(dir); // Exclusive reservation: never overwrite any existing agent.
        try { await this.atomicWrite(path.join(dir, 'state.json'), state); }
        catch (error) { await fs.rm(dir, {recursive:true, force:true}); throw error; }
    }

    async saveWorkingState(agentId: string, state: WorkingState): Promise<void> {
        if (state.identity.id !== agentId || state.schemaVersion !== 2) throw new Error('Invalid working state identity/version');
        const dir = this.getAgentDir(agentId);
        await this.ensureDir(dir);
        await this.atomicWrite(path.join(dir, 'state.json'), state);
    }

    /**
     * Lists all available agent IDs.
     */
    async listAgents(): Promise<string[]> {
        const agentsDir = path.join(this.baseDir, 'agents');
        try {
            const entries = await fs.readdir(agentsDir, { withFileTypes: true });
            return entries.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);
        } catch (error: any) {
             if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
}
