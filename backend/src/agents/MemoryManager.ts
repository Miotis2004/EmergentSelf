import { JsonStorage, AgentState } from '../storage/JsonStorage';
import { MemoryOperation } from '../llm/LlmAdapter';
import { randomUUID } from 'crypto';

export class MemoryManager {
    private storage: JsonStorage;

    constructor(storage: JsonStorage) {
        this.storage = storage;
    }

    async applyOperations(agentId: string, operations: MemoryOperation[]): Promise<any[]> {
        const memories = await this.storage.loadAgentMemory(agentId) || [];
        const beliefs = await this.storage.loadAgentBeliefs(agentId) || [];
        const identity = await this.storage.loadAgentIdentity(agentId);

        if (!identity) {
            throw new Error(`Agent ${agentId} not found`);
        }

        const auditTrail = [];

        for (const op of operations) {
            try {
                let changeRecord: any = { operation: op, status: 'success', timestamp: new Date().toISOString() };

                if (op.type === 'memory') {
                    if (op.action === 'add') {
                        const newId = randomUUID();
                        memories.push({ id: newId, content: op.content, created_at: new Date().toISOString() });
                        changeRecord.new_id = newId;
                    } else if (op.action === 'update' && op.target_id) {
                        const idx = memories.findIndex(m => m.id === op.target_id);
                        if (idx > -1) {
                            changeRecord.previous_content = memories[idx].content;
                            memories[idx].content = op.content;
                            memories[idx].updated_at = new Date().toISOString();
                        } else {
                            changeRecord.status = 'failed';
                            changeRecord.error = 'Target memory ID not found';
                        }
                    } else if (op.action === 'retire' && op.target_id) {
                        const idx = memories.findIndex(m => m.id === op.target_id);
                        if (idx > -1) {
                            changeRecord.previous_content = memories[idx].content;
                            memories.splice(idx, 1);
                        } else {
                            changeRecord.status = 'failed';
                            changeRecord.error = 'Target memory ID not found';
                        }
                    }
                } else if (op.type === 'belief') {
                     if (op.action === 'add') {
                        const newId = randomUUID();
                        beliefs.push({ id: newId, content: op.content, created_at: new Date().toISOString() });
                        changeRecord.new_id = newId;
                    } else if (op.action === 'update' && op.target_id) {
                        const idx = beliefs.findIndex(m => m.id === op.target_id);
                        if (idx > -1) {
                             changeRecord.previous_content = beliefs[idx].content;
                            beliefs[idx].content = op.content;
                            beliefs[idx].updated_at = new Date().toISOString();
                        } else {
                            changeRecord.status = 'failed';
                            changeRecord.error = 'Target belief ID not found';
                        }
                    } else if (op.action === 'retire' && op.target_id) {
                        const idx = beliefs.findIndex(m => m.id === op.target_id);
                        if (idx > -1) {
                             changeRecord.previous_content = beliefs[idx].content;
                            beliefs.splice(idx, 1);
                        } else {
                            changeRecord.status = 'failed';
                            changeRecord.error = 'Target belief ID not found';
                        }
                    }
                } else if (op.type === 'stat') {
                    // Update current stat value if it exists
                    if (op.action === 'update' && typeof op.target_id === 'string' && typeof op.content === 'number') {
                        const statKey = op.target_id;
                        if (identity.stats[statKey]) {
                             changeRecord.previous_content = identity.stats[statKey].current;
                             identity.stats[statKey].current = op.content;
                        } else {
                            changeRecord.status = 'failed';
                            changeRecord.error = 'Target stat not found';
                        }
                    } else {
                        changeRecord.status = 'failed';
                        changeRecord.error = 'Unsupported stat operation or invalid payload';
                    }
                }

                auditTrail.push(changeRecord);
            } catch (err: any) {
                 auditTrail.push({ operation: op, status: 'failed', error: err.message, timestamp: new Date().toISOString() });
            }
        }

        await this.storage.saveAgentMemory(agentId, memories);
        await this.storage.saveAgentBeliefs(agentId, beliefs);
        await this.storage.saveAgentIdentity(agentId, identity);

        return auditTrail;
    }
}
