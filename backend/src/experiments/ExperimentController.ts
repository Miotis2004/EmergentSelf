import { JsonStorage, AgentState } from '../storage/JsonStorage';
import { JsonlStorage } from '../storage/JsonlStorage';
import { LlmAdapter, LlmConfig } from '../llm/LlmAdapter';
import { MemoryManager } from '../agents/MemoryManager';

export type RunStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'completed';

export interface ExperimentConfig {
    runId: string;
    agentIds: string[]; // typically two for Phase I
    maxTurns: number;
    llmConfig: LlmConfig;
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

    private onEventCallback?: (eventType: string, data: any) => void;

    constructor(jsonStorage: JsonStorage, jsonlStorage: JsonlStorage, llmAdapter: LlmAdapter) {
        this.jsonStorage = jsonStorage;
        this.jsonlStorage = jsonlStorage;
        this.llmAdapter = llmAdapter;
        this.memoryManager = new MemoryManager(this.jsonStorage);
    }

    onEvent(cb: (eventType: string, data: any) => void) {
        this.onEventCallback = cb;
    }

    private emit(eventType: string, data: any) {
        if (this.onEventCallback) {
            this.onEventCallback(eventType, data);
        }
    }

    getStatus(): RunStatus {
        return this.status;
    }

    getConfig(): ExperimentConfig | null {
        return this.config;
    }

    getTurnIndex(): number {
        return this.currentTurnIndex;
    }

    async start(config: ExperimentConfig) {
        if (this.status === 'running') {
            throw new Error('Experiment is already running.');
        }

        this.config = config;
        this.shouldPause = false;
        this.shouldStop = false;

        // Save config
        await this.jsonlStorage.saveConfig(config.runId, config);

        // Resume state if conversation log exists
        const history = await this.jsonlStorage.getConversationHistory(config.runId);
        this.currentTurnIndex = history.length;

        if (this.currentTurnIndex >= config.maxTurns) {
            this.status = 'completed';
            this.emit('status_changed', { status: this.status });
            return;
        }

        this.status = 'running';
        this.emit('status_changed', { status: this.status });
        this.activePromise = this.runLoop();
    }

    async pause() {
        if (this.status !== 'running') return;
        this.shouldPause = true;
        this.status = 'paused';
        this.emit('status_changed', { status: this.status });
    }

    async resume() {
        if (this.status !== 'paused' || !this.config) return;
        this.shouldPause = false;
        this.shouldStop = false;
        this.status = 'running';
        this.emit('status_changed', { status: this.status });
        this.activePromise = this.runLoop();
    }

    async stop() {
        this.shouldStop = true;
        this.status = 'stopped';
        this.emit('status_changed', { status: this.status });
        if (this.activePromise) {
            await this.activePromise;
        }
    }

    async reset() {
        this.status = 'idle';
        this.config = null;
        this.currentTurnIndex = 0;
        this.shouldPause = false;
        this.shouldStop = false;
        this.emit('status_changed', { status: this.status });
    }

    private async runLoop() {
        if (!this.config) return;

        while (this.status === 'running' && this.currentTurnIndex < this.config.maxTurns && !this.shouldPause && !this.shouldStop) {
            const activeAgentId = this.config.agentIds[this.currentTurnIndex % this.config.agentIds.length];

            try {
                await this.executeTurn(activeAgentId);
                this.currentTurnIndex++;

                if (this.currentTurnIndex >= this.config.maxTurns) {
                    this.status = 'completed';
                    this.emit('status_changed', { status: this.status });
                    break;
                }
            } catch (error: any) {
                console.error("Turn failed:", error);
                this.status = 'paused'; // auto-pause on error
                this.emit('status_changed', { status: this.status, error: error.message });
                break;
            }
        }
    }

    private async buildPrompt(agentId: string): Promise<{ system: string; messages: { role: string; content: string }[] }> {
        const identity = await this.jsonStorage.loadAgentIdentity(agentId);
        const memories = await this.jsonStorage.loadAgentMemory(agentId) || [];
        const beliefs = await this.jsonStorage.loadAgentBeliefs(agentId) || [];

        if (!identity) throw new Error(`Agent ${agentId} missing`);

        // Get recent conversation history from the append-only log
        const history = await this.jsonlStorage.getConversationHistory(this.config!.runId);

        // Bounded transcript (e.g. last 10 turns)
        const recentTurns = history.slice(-10);
        const transcript = recentTurns.map(t => `${t.agentName}: ${t.response}`).join('\n');

        const system = `You are an agent with the following identity:
ID: ${identity.id}
Name: ${identity.name}

Current Stats:
${Object.entries(identity.stats).map(([k, v]) => `- ${k}: ${v.current}`).join('\n')}

Memories:
${memories.map(m => `- [${m.id}] ${m.content}`).join('\n')}

Beliefs:
${beliefs.map(b => `- [${b.id}] ${b.content}`).join('\n')}

Based on the recent conversation transcript below, you must generate a reply.
You can also propose changes to your memories or beliefs if you learned something new or changed your mind.

Recent conversation:
${transcript ? transcript : '(No conversation yet)'}`;

        return {
            system,
            messages: [{ role: 'user', content: `It is your turn to speak, ${identity.name}.` }]
        };
    }

    private async executeTurn(agentId: string) {
        this.emit('turn_started', { agentId, turnIndex: this.currentTurnIndex });

        // Build context
        const prompt = await this.buildPrompt(agentId);

        // Execute inference sequentially
        this.llmAdapter.updateConfig(this.config!.llmConfig);
        const response = await this.llmAdapter.generateTurn(prompt.system, prompt.messages);

        const identity = await this.jsonStorage.loadAgentIdentity(agentId);

        // Create turn record
        const turnRecord = {
            turnIndex: this.currentTurnIndex,
            agentId,
            agentName: identity?.name || agentId,
            response: response.response,
            timestamp: new Date().toISOString()
        };

        // Validate and apply memory operations atomically
        const auditTrail = await this.memoryManager.applyOperations(agentId, response.memory_operations || []);

        // Log everything immutably
        await this.jsonlStorage.appendConversationTurn(this.config!.runId, turnRecord);
        await this.jsonlStorage.appendEvent(this.config!.runId, {
            turnIndex: this.currentTurnIndex,
            agentId,
            type: 'memory_update',
            operations: auditTrail,
            timestamp: new Date().toISOString()
        });

        // Broadcast updates
        this.emit('turn_completed', { turnRecord, auditTrail });
    }
}
