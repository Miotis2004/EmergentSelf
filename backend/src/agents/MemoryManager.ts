import { JsonStorage } from '../storage/JsonStorage';
import { MemoryOperation } from '../llm/LlmAdapter';
import { validateAgentTurn } from '../llm/agentTurnSchema';
import { randomUUID } from 'crypto';
import { MemoryConfig, MemoryEntry, MemoryKind, SourceEvent, WorkingState, resolveMemoryConfig } from '../memory/types';

export class MemoryValidationError extends Error {}
export interface MemoryContext { source: SourceEvent; participants: string[]; config: MemoryConfig; }
export class MemoryManager {
    constructor(private storage: JsonStorage) {}

    // Pure preparation: inference/validation never partially changes working files.
    prepareOperations(before: WorkingState, operations: MemoryOperation[], context: MemoryContext) {
        validateAgentTurn({ response: '', memory_operations: operations });
        if (operations.length > context.config.maxOperations) throw new MemoryValidationError('Memory operation limit exceeded; reduce proposed changes or start a run with a larger limit');
        let state = structuredClone(before);
        const auditTrail: any[] = [];
        for (const op of operations) {
            const timestamp = new Date().toISOString();
            const record: any = { operation: op, status: 'success', timestamp, source: context.source };
            if (context.config.mode === 'none') {
                auditTrail.push({ ...record, status: 'ignored', error: 'No-memory condition: proposed state changes withheld' });
                continue;
            }
            const candidate = structuredClone(state);
            try {
                if (op.type === 'stat') {
                    if (op.action !== 'update' || !op.target_id || !Object.hasOwn(candidate.identity.stats, op.target_id)) throw new Error('Invalid stat target or action');
                    if (typeof op.content !== 'number' || !Number.isFinite(op.content) || op.content < 0 || op.content > 10) throw new Error('Stat values must be finite numbers between 0 and 10');
                    record.before = structuredClone(candidate.identity.stats[op.target_id]);
                    record.previous_content = record.before.current;
                    candidate.identity.stats[op.target_id].current = op.content;
                    record.after = structuredClone(candidate.identity.stats[op.target_id]);
                } else {
                    const type: MemoryKind = op.type === 'memory' ? 'episodic' : op.type;
                    if (typeof op.content !== 'string' || !op.content.trim() || op.content.length > context.config.maxEntryChars) throw new Error('Memory content must be nonempty text within the configured entry limit');
                    const targets = op.action === 'consolidate' ? op.target_ids : op.target_id ? [op.target_id] : [];
                    const originals = (targets || []).map(id => {
                        const entry = candidate.entries.find(e => e.id === id && e.type === type && e.status === 'active');
                        if (!entry) throw new Error('Target active memory entry not found in this agent/category');
                        return entry;
                    });
                    if (op.action !== 'add' && (!originals.length || (op.action === 'consolidate' && originals.length < 2))) throw new Error('Memory revision requires existing target IDs');
                    const subject = op.relationship_agent_id ?? originals[0]?.relationship_agent_id;
                    if (type === 'relationship' && (!subject || subject === candidate.identity.id || !context.participants.includes(subject))) throw new Error('Relationship subject must be another participant');
                    if (type !== 'relationship' && op.relationship_agent_id) throw new Error('Only relationships can have a relationship subject');
                    if (originals.some(e => e.relationship_agent_id !== subject)) throw new Error('Relationship subjects cannot change during revision/consolidation');
                    record.before = structuredClone(originals);
                    let entry: MemoryEntry;
                    if (op.action === 'update' || op.action === 'retire') {
                        entry = originals[0];
                        record.previous_content = entry.content;
                        if (op.action === 'retire') entry.status = 'retired';
                        else entry.content = op.content;
                        entry.confidence = op.confidence ?? entry.confidence;
                        if (op.importance !== undefined) entry.importance = op.importance;
                        entry.updated_at = timestamp;
                        entry.updated_source = context.source;
                    } else {
                        entry = {
                            id: randomUUID(), type, content: op.content, confidence: op.confidence ?? 0.5,
                            ...(op.importance === undefined ? {} : { importance: op.importance }),
                            source: context.source, updated_source: context.source, created_at: timestamp,
                            updated_at: timestamp, status: 'active',
                            ...(subject ? { relationship_agent_id: subject } : {})
                        };
                        if (op.action === 'consolidate' || op.action === 'contradict') {
                            for (const old of originals) {
                                old.status = 'superseded'; old.updated_at = timestamp; old.updated_source = context.source;
                            }
                            if (op.action === 'consolidate') entry.consolidated_from = originals.map(e => e.id);
                            else entry.contradicts = originals.map(e => e.id);
                        }
                        candidate.entries.push(entry);
                        record.new_id = entry.id;
                    }
                    record.after = structuredClone([...originals.filter(e => e.id !== entry.id), entry]);
                    if (candidate.entries.filter(e => e.status === 'active').length > context.config.maxActiveEntries && candidate.entries.filter(e => e.status === 'active').length > state.entries.filter(e => e.status === 'active').length) throw new Error('Active memory limit reached; consolidate or retire entries before adding more');
                }
                state = candidate;
            } catch (error: any) {
                record.status = 'failed'; record.error = error.message;
                delete record.after;
            }
            auditTrail.push(record);
        }
        return { state, auditTrail };
    }

    async applyOperations(agentId: string, operations: MemoryOperation[]): Promise<any[]> {
        const before = await this.storage.loadWorkingState(agentId);
        const result = this.prepareOperations(before, operations, {
            source: { runId: 'standalone', turnIndex: -1, eventId: randomUUID() }, participants: [agentId], config: resolveMemoryConfig()
        });
        if (operations.length) await this.storage.saveWorkingState(agentId, result.state);
        return result.auditTrail;
    }
}
