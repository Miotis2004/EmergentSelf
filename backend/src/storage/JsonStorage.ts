import fs from 'fs/promises';
import path from 'path';

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
        return path.join(this.baseDir, 'agents', agentId);
    }

    private async ensureDir(dirPath: string): Promise<void> {
        await fs.mkdir(dirPath, { recursive: true });
    }

    /**
     * Atomically writes data to a JSON file.
     */
    private async atomicWrite(filePath: string, data: any): Promise<void> {
        const tempPath = `${filePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
        await fs.rename(tempPath, filePath);
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
        await this.atomicWrite(path.join(agentDir, 'identity.json'), state);
    }

    /**
     * Loads the agent's identity state.
     */
    async loadAgentIdentity(agentId: string): Promise<AgentState | null> {
        const agentDir = this.getAgentDir(agentId);
        return this.readJson<AgentState>(path.join(agentDir, 'identity.json'));
    }

    /**
     * Saves the agent's editable memory.
     */
    async saveAgentMemory(agentId: string, memories: any[]): Promise<void> {
        const agentDir = this.getAgentDir(agentId);
        await this.ensureDir(agentDir);
        await this.atomicWrite(path.join(agentDir, 'memory.json'), memories);
    }

    /**
     * Loads the agent's editable memory.
     */
    async loadAgentMemory(agentId: string): Promise<any[] | null> {
        const agentDir = this.getAgentDir(agentId);
        return this.readJson<any[]>(path.join(agentDir, 'memory.json'));
    }

    /**
     * Saves the agent's beliefs.
     */
    async saveAgentBeliefs(agentId: string, beliefs: any[]): Promise<void> {
        const agentDir = this.getAgentDir(agentId);
        await this.ensureDir(agentDir);
        await this.atomicWrite(path.join(agentDir, 'beliefs.json'), beliefs);
    }

    /**
     * Loads the agent's beliefs.
     */
    async loadAgentBeliefs(agentId: string): Promise<any[] | null> {
        const agentDir = this.getAgentDir(agentId);
        return this.readJson<any[]>(path.join(agentDir, 'beliefs.json'));
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
