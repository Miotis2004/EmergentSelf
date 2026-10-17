import { JsonStorage } from '../storage/JsonStorage';
import { JsonlStorage } from '../storage/JsonlStorage';
import { LlmAdapter, LlmConfig, LlmError, resolveLlmConfig } from '../llm/LlmAdapter';
import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { MemoryManager } from '../agents/MemoryManager';

export type RunStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'completed';

export interface ExperimentConfig {
    runId: string;
    agentIds: string[]; // Immutable participant order for the sequential scheduler.
    initialTopic?: string; // Legacy configurations omit this field.
    maxTurns: number;
    llmConfig: LlmConfig;
}

export function normalizeInitialTopic(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new Error('Conversation topic must be text');
    const topic = value.trim();
    if (topic.length > 1000) throw new Error('Conversation topic must be at most 1,000 characters');
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

    constructor(jsonStorage: JsonStorage, jsonlStorage: JsonlStorage, llmAdapter: LlmAdapter) {
        this.jsonStorage = jsonStorage;
        this.jsonlStorage = jsonlStorage;
        this.llmAdapter = llmAdapter;
        this.memoryManager = new MemoryManager(this.jsonStorage);
    }

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
            activeAgentId: this.activeAgentId, error: this.lastError };
    }
    async getSnapshot() {
        const runId = this.config?.runId;
        const state = this.getState();
        const turns = runId ? await this.jsonlStorage.getConversationHistory(runId) : [];
        const events = runId ? await this.jsonlStorage.getEventHistory(runId) : [];
        return { ...state, turns, events };
    }
    private publishStatus() { this.emit('status_changed', this.getState()); }
    // Lifecycle commands are serialized, including discovery and disk I/O in start().
    private command(work: () => Promise<void>): Promise<void> {
        const result = this.commands.then(work);
        this.commands = result.catch(() => {});
        return result;
    }
    private launchLoop() {
        if (this.activePromise) throw new Error('A turn loop is still active');
        this.activePromise = this.runLoop().finally(() => { this.activePromise = null; });
    }
    start(input: ExperimentConfig) {
        // Snapshot caller-owned objects before asynchronous discovery or disk reads.
        const config = structuredClone(input);
        return this.command(async () => {
            if (this.activePromise || this.status === 'running' || this.status === 'paused') throw new Error('Stop or reset the current experiment before starting another');
            if (!/^[A-Za-z0-9_-]+$/.test(config.runId) || !Number.isSafeInteger(config.maxTurns) || config.maxTurns < 1 ||
                !Array.isArray(config.agentIds) || config.agentIds.length < 2 || new Set(config.agentIds).size !== config.agentIds.length ||
                !config.agentIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id))) throw new Error('Invalid run ID, agent IDs or turn limit');
            const initialTopic = normalizeInitialTopic(config.initialTopic);
            for (const id of config.agentIds) {
                if (!await this.jsonStorage.loadAgentIdentity(id)) throw new Error(`Agent ${id} missing`);
            }
            const llmConfig = resolveLlmConfig(config.llmConfig);
            const discovery = new LlmAdapter(llmConfig);
            const models = await discovery.getModels();
            if (!llmConfig.model) {
                if (models.length !== 1) throw new Error('Select a loaded model from model discovery');
                llmConfig.model = models[0].id;
            }
            if (!models.some(model => model.id === llmConfig.model)) throw new Error('Selected model is not in the loaded model list');
            const resolved = { ...config, agentIds: [...config.agentIds], initialTopic, llmConfig };
            const existing = await this.jsonlStorage.loadConfig(config.runId);
            if (existing && !isDeepStrictEqual({ ...existing, initialTopic: normalizeInitialTopic(existing.initialTopic) }, resolved)) throw new Error('Run ID already has different metadata; use a new run ID to change participants, topic, model or settings');
            const history = await this.jsonlStorage.getConversationHistory(config.runId);
            const events = await this.jsonlStorage.getEventHistory(config.runId);
            if (!existing && (history.length || events.length)) throw new Error('Run already has research logs without configuration; use a new run ID');
            if (!existing) await this.jsonlStorage.saveConfig(config.runId, resolved);
            this.config = resolved;
            this.llmAdapter.updateConfig(llmConfig);
            this.currentTurnIndex = history.length;
            this.shouldPause = false;
            this.shouldStop = false;
            this.lastError = null;
            this.status = this.currentTurnIndex >= config.maxTurns ? 'completed' : 'running';
            this.emit('snapshot', { ...this.getState(), turns: history, events });
            this.publishStatus();
            if (this.status === 'running') this.launchLoop();
        });
    }
    pause() { return this.command(async () => {
        if (this.status !== 'running') return;
        this.shouldPause = true;
        this.status = 'paused';
        this.publishStatus();
        // Finish the in-flight turn before any Resume can launch the next loop.
        await this.activePromise;
    }); }
    resume() { return this.command(async () => {
        if (this.status !== 'paused' || !this.config) return;
        await this.activePromise;
        this.shouldPause = false;
        this.shouldStop = false;
        this.lastError = null;
        this.status = this.currentTurnIndex >= this.config.maxTurns ? 'completed' : 'running';
        this.publishStatus();
        if (this.status === 'running') this.launchLoop();
    }); }
    stop() { return this.command(async () => {
        this.shouldStop = true;
        this.status = 'stopped';
        this.publishStatus();
        await this.activePromise;
    }); }
    reset() { return this.command(async () => {
        this.shouldStop = true;
        await this.activePromise;
        this.status = 'idle';
        this.config = null;
        this.currentTurnIndex = 0;
        this.activeAgentId = null;
        this.lastError = null;
        this.shouldPause = false;
        this.shouldStop = false;
        this.publishStatus();
        this.emit('snapshot', await this.getSnapshot());
    }); }
    private async runLoop() {
        if (!this.config) return;
        while (this.status === 'running' && this.currentTurnIndex < this.config.maxTurns && !this.shouldPause && !this.shouldStop) {
            const agentId = this.config.agentIds[this.currentTurnIndex % this.config.agentIds.length];
            this.activeAgentId = agentId;
            try {
                await this.executeTurn(agentId);
                if (this.currentTurnIndex >= this.config.maxTurns && !this.shouldStop) this.status = 'completed';
            } catch (error: any) {
                this.activeAgentId = null;
                this.shouldPause = true;
                this.lastError = {
                    id: randomUUID(), type: 'experiment_error', runId: this.config.runId,
                    turnIndex: this.currentTurnIndex, agentId,
                    message: error instanceof LlmError ? error.message : 'Turn execution failed; check backend storage and configuration',
                    ...(error instanceof LlmError ? { diagnostics: error.diagnostics } : {}),
                    timestamp: new Date().toISOString()
                };
                try { await this.jsonlStorage.appendEvent(this.config.runId, this.lastError); }
                catch { this.lastError.message += '; research error log could not be written'; }
                this.status = this.shouldStop ? 'stopped' : 'paused';
                console.error('Experiment paused', this.lastError);
                this.emit('experiment_error', this.lastError);
            } finally {
                this.activeAgentId = null;
                this.publishStatus();
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
            messages: [{
                role: 'user',
                content: this.currentTurnIndex === 0 && this.config!.initialTopic
                    ? this.config!.initialTopic : `It is your turn to speak, ${identity.name}.`
            }]
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

        // Validate each proposal; rejected operations are preserved in the audit trail.
        const auditTrail = await this.memoryManager.applyOperations(agentId, response.memory_operations || []);

        // Log everything immutably
        await this.jsonlStorage.appendConversationTurn(this.config!.runId, { ...turnRecord, auditTrail, diagnostics: this.llmAdapter.lastDiagnostics });
        // The appended turn is the commit point. Never retry a completed turn.
        this.currentTurnIndex++;
        this.emit('turn_completed', { turnRecord, auditTrail });
        await this.jsonlStorage.appendEvent(this.config!.runId, {
            turnIndex: turnRecord.turnIndex,
            agentId,
            type: 'memory_update',
            operations: auditTrail,
            timestamp: new Date().toISOString()
        });

    }
}
