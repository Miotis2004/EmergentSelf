import { JsonStorage } from '../storage/JsonStorage';
import { MemoryOperation } from '../llm/LlmAdapter';
import { validateAgentTurn } from '../llm/agentTurnSchema';
import { randomUUID } from 'crypto';

export class MemoryManager {
    constructor(private storage: JsonStorage) {}

    async applyOperations(agentId: string, operations: MemoryOperation[]): Promise<any[]> {
        validateAgentTurn({ response: '', memory_operations: operations });
        const memories = await this.storage.loadAgentMemory(agentId) || [];
        const beliefs = await this.storage.loadAgentBeliefs(agentId) || [];
        const identity = await this.storage.loadAgentIdentity(agentId);
        if (!identity) throw new Error(`Agent ${agentId} not found`);
        const auditTrail = [];
        for (const op of operations) {
            const record: any = { operation: op, status: 'success', timestamp: new Date().toISOString() };
            try {
                if (op.type === 'stat') {
                    if (op.action !== 'update' || !op.target_id || !Object.hasOwn(identity.stats, op.target_id)) throw new Error('Invalid stat target or action');
                    if (typeof op.content !== 'number' || !Number.isFinite(op.content) || op.content < 0 || op.content > 10) throw new Error('Stat values must be finite numbers between 0 and 10');
                    record.previous_content = identity.stats[op.target_id].current;
                    // The immutable initial value is never assigned from model output.
                    identity.stats[op.target_id].current = op.content;
                } else {
                    if (typeof op.content !== 'string') throw new Error('Memory and belief content must be text');
                    const items = op.type === 'memory' ? memories : beliefs;
                    if (op.action === 'add') {
                        const id = randomUUID();
                        items.push({ id, content: op.content, created_at: record.timestamp });
                        record.new_id = id;
                    } else {
                        const index = items.findIndex(item => item.id === op.target_id);
                        if (!op.target_id || index < 0) throw new Error('Target memory or belief ID not found');
                        record.previous_content = items[index].content;
                        if (op.action === 'retire') items.splice(index, 1);
                        else {
                            items[index].content = op.content;
                            items[index].updated_at = record.timestamp;
                        }
                    }
                }
            } catch (error: any) {
                record.status = 'failed';
                record.error = error.message;
            }
            auditTrail.push(record);
        }
        if (operations.length) {
            await this.storage.saveAgentMemory(agentId, memories);
            await this.storage.saveAgentBeliefs(agentId, beliefs);
            await this.storage.saveAgentIdentity(agentId, identity);
        }
        return auditTrail;
    }
}
