import fs from 'fs/promises';
import path from 'path';

export class JsonlStorage {
    private baseDir: string;

    constructor(baseDir: string = path.join(process.cwd(), '../researcher')) {
        this.baseDir = baseDir;
    }

    private getExperimentDir(runId: string): string {
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
     * Saves experimental configuration.
     */
    async saveConfig(runId: string, config: any): Promise<void> {
        const expDir = this.getExperimentDir(runId);
        await this.ensureDir(expDir);
        await fs.writeFile(path.join(expDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
    }

    async loadConfig(runId: string): Promise<any | null> {
        try {
            return JSON.parse(await fs.readFile(path.join(this.getExperimentDir(runId), 'config.json'), 'utf-8'));
        } catch (error: any) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
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
