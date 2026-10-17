import { MemoryConfig, WorkingState } from './types';

export function retrieveMemory(state: WorkingState, config: MemoryConfig) {
    const active = state.entries.filter(entry => entry.status === 'active');
    const ranked = [...active].sort((a, b) => {
        if (config.retrievalRule === 'importance') {
            const score = ((b.importance ?? 0.5) - (a.importance ?? 0.5)) || b.confidence - a.confidence;
            if (score) return score;
        }
        const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
        return compare(b.updated_at ?? '', a.updated_at ?? '') || compare(a.id, b.id);
    });
    const selectedIds: string[] = [], summaryIds: string[] = [];
    const lines: string[] = [];
    let used = 0;
    for (const entry of config.mode !== 'enabled' ? [] : ranked) {
        const prefix = `[${entry.id}] ${entry.type}${entry.relationship_agent_id ? ` about ${entry.relationship_agent_id}` : ''} (confidence=${entry.confidence}): `;
        const text = entry.content.slice(0, config.entryChars);
        const line = prefix + text + (text.length < entry.content.length ? ' [excerpt]' : '');
        if (selectedIds.length < config.retrievalEntries && used + line.length + 1 <= config.retrievalChars) {
            lines.push(line); selectedIds.push(entry.id); used += line.length + 1;
        }
    }
    // Deterministic extractive digest, never an invented/model-authored recollection.
    // Originals remain in the state and append-only turn record.
    let summary = '';
    if (config.mode === 'enabled') for (const entry of ranked.filter(e => !selectedIds.includes(e.id))) {
        const prefix = `[${entry.id}] ${entry.type}: `;
        const remaining = config.summaryChars - summary.length - prefix.length - 1;
        if (remaining < 1) break;
        const piece = entry.content.slice(0, Math.min(160, remaining));
        summary += prefix + piece + '\n'; summaryIds.push(entry.id);
    }
    return {
        text: lines.join('\n'), summary,
        metadata: { rule: config.retrievalRule, mode: config.mode, selectedIds, summaryIds,
            omittedEntries: active.length - selectedIds.length - summaryIds.length,
            memoryChars: used, summaryChars: summary.length }
    };
}

export function boundedTranscript(history: any[], config: MemoryConfig): string {
    if (config.mode === 'none' || config.transcriptTurns === 0 || config.transcriptChars === 0) return '';
    return history.slice(-config.transcriptTurns).map(turn => `${turn.agentName}: ${turn.response}`).join('\n').slice(-config.transcriptChars);
}
