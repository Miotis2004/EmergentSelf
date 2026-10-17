import { AgentState } from '../storage/JsonStorage';

export type MemoryKind = 'episodic' | 'belief' | 'self_description' | 'relationship';
export interface SourceEvent { runId: string; turnIndex: number; eventId: string; }
export interface MemoryEntry {
    id: string;
    type: MemoryKind;
    content: string;
    confidence: number;
    importance?: number;
    source: SourceEvent | null;
    updated_source: SourceEvent | null;
    created_at: string | null;
    updated_at: string | null;
    status: 'active' | 'retired' | 'superseded';
    relationship_agent_id?: string;
    consolidated_from?: string[];
    contradicts?: string[];
}
export interface WorkingState { schemaVersion: 2; identity: AgentState; entries: MemoryEntry[]; }
export interface MemoryConfig {
    mode: 'enabled' | 'none';
    maxActiveEntries: number;
    maxOperations: number;
    maxEntryChars: number;
    retrievalEntries: number;
    retrievalChars: number;
    entryChars: number;
    summaryChars: number;
    transcriptTurns: number;
    transcriptChars: number;
    retrievalRule: 'importance' | 'recent';
}
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
    mode: 'enabled', maxActiveEntries: 200, maxOperations: 20, maxEntryChars: 2000,
    retrievalEntries: 24, retrievalChars: 12000, entryChars: 1000, summaryChars: 2000,
    transcriptTurns: 10, transcriptChars: 8000, retrievalRule: 'importance'
};
export function resolveMemoryConfig(input: Partial<MemoryConfig> = {}): MemoryConfig {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid memory configuration');
    if (Object.keys(input).some(key => !Object.hasOwn(DEFAULT_MEMORY_CONFIG, key))) throw new Error('Unknown memory configuration field');
    const config = { ...DEFAULT_MEMORY_CONFIG, ...input };
    if (!['enabled', 'none'].includes(config.mode) || !['importance', 'recent'].includes(config.retrievalRule)) throw new Error('Invalid memory mode or retrieval rule');
    const limits: Record<string, [number, number]> = {
        maxActiveEntries: [1, 1000], maxOperations: [1, 50], maxEntryChars: [1, 8000],
        retrievalEntries: [0, 100], retrievalChars: [0, 32000], entryChars: [1, 8000],
        summaryChars: [0, 8000], transcriptTurns: [0, 100], transcriptChars: [0, 32000]
    };
    for (const [key, [min, max]] of Object.entries(limits)) {
        const value = config[key as keyof MemoryConfig];
        if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`Memory ${key} must be an integer between ${min} and ${max}`);
    }
    return config;
}

export function importLegacy(identity: AgentState, memories: any[], beliefs: any[]): WorkingState {
    const entries = (items: any[], type: MemoryKind): MemoryEntry[] => items.map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `legacy-${type}-${index}`,
        type, content: String(item.content ?? ''), confidence: 0.5,
        source: null, updated_source: null, created_at: item.created_at ?? null,
        updated_at: item.updated_at ?? item.created_at ?? null, status: 'active'
    }));
    return { schemaVersion: 2, identity, entries: [...entries(memories, 'episodic'), ...entries(beliefs, 'belief')] };
}
