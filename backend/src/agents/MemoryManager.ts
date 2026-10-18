import { memoryContentWarnings } from '../memory/contentDiagnostics';
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
        const warnings = memoryContentWarnings(operations);
        for (const [operationIndex, op] of operations.entries()) {
            const timestamp = new Date().toISOString();
            const record: any = { operation: op, status: 'success', timestamp, source: context.source };
            const operationWarnings = warnings.filter(warning=>warning.operationIndex === operationIndex);
            if (operationWarnings.length) record.warnings = operationWarnings;
            if (context.config.mode !== 'enabled') {
                auditTrail.push({ ...record, status: 'ignored', error: `${context.config.mode} condition: proposed state changes withheld` });
                continue;
            }
            const candidate = structuredClone(state);
            try {
                if (op.type === 'stat') {
                    if (op.action !== 'update') throw new Error('Invalid stat action: stats require update');
                    if (!op.target_id) throw new Error('Missing target_id for stat update');
                    if (!Object.hasOwn(candidate.identity.stats, op.target_id)) throw new Error('Nonexistent stat target: use an exact existing stat name');
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
                        const entry = candidate.entries.find(e => e.id === id);
                        if (!entry) throw new Error('Nonexistent target: no entry with that ID in this agent’s stored memory');
                        if (entry.status !== 'active') throw new Error('Inactive target: revision requires an active entry');
                        if (entry.type !== type) throw new Error('Category mismatch: target entry belongs to a different memory category');
                        return entry;
                    });
                    if (op.action !== 'add' && (!originals.length || (op.action === 'consolidate' && originals.length < 2))) throw new Error(op.action === 'consolidate' ? 'Missing target_ids: consolidation requires at least two existing active entry IDs' : 'Missing target_id: revision requires an existing active entry ID');
                    const subject = op.relationship_agent_id ?? originals[0]?.relationship_agent_id;
                    if (type === 'relationship') {
                        if (typeof subject !== 'string' || !subject.trim()) throw new Error('Missing relationship_agent_id: use the exact ID of another participant');
                        if (subject === candidate.identity.id) throw new Error('Self-referential relationship: subject must be another participant');
                        if (!context.participants.includes(subject)) throw new Error('Unknown relationship participant: use an exact participant ID from the directory');
                    }
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
