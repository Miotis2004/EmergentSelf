import { MemoryConfig, MemoryEntry, MemoryKind, WorkingState } from './types';

const categories: {type:MemoryKind; label:string}[] = [
    {type:'episodic',label:'Episodic observations'}, {type:'belief',label:'Beliefs and opinions'},
    {type:'self_description',label:'Self-descriptions'}, {type:'relationship',label:'Relationships'}
];
function grouped(lines: {type:MemoryKind; text:string}[]): string {
    return categories.flatMap(category=>{
        const entries = lines.filter(line=>line.type===category.type);
        return entries.length ? [`Active ${category.label} (${category.type}):\n${entries.map(line=>line.text).join('\n')}`] : [];
    }).join('\n\n');
}

/** JSON lines keep reference metadata separate from quoted, agent-authored content. */
function renderRecord(entry: MemoryEntry, content: string): string {
    return JSON.stringify({metadata:{id:entry.id,type:entry.type,confidence:entry.confidence,status:entry.status,
        ...(entry.relationship_agent_id ? {relationship_agent_id:entry.relationship_agent_id} : {})},
        content,excerpt:content.length < entry.content.length});
}

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
    const lines: {type:MemoryKind; text:string}[] = [];
    let used = 0;
    for (const entry of config.mode !== 'enabled' ? [] : ranked) {
        const text = entry.content.slice(0, config.entryChars);
        const line = renderRecord(entry, text);
        const proposed = [...lines, {type:entry.type,text:line}];
        if (selectedIds.length < config.retrievalEntries && grouped(proposed).length <= config.retrievalChars) {
            lines.push({type:entry.type,text:line}); selectedIds.push(entry.id); used = grouped(lines).length;
        }
    }
    // Deterministic extractive digest, never an invented/model-authored recollection.
    // Originals remain in the state and append-only turn record.
    let summary = '';
    const excerpts: {type:MemoryKind; text:string}[] = [];
    if (config.mode === 'enabled') for (const entry of ranked.filter(e => !selectedIds.includes(e.id))) {
        // Include complete metadata and valid JSON even when escaped text expands.
        let low = 1, high = Math.min(160, entry.content.length), chosen = '';
        while (low <= high) {
            const length = Math.floor((low + high) / 2);
            const text = renderRecord(entry, entry.content.slice(0,length));
            if (grouped([...excerpts,{type:entry.type,text}]).length <= config.summaryChars) {
                chosen = text; low = length + 1;
            } else high = length - 1;
        }
        if (!chosen) break;
        excerpts.push({type:entry.type,text:chosen});
        summary = grouped(excerpts); summaryIds.push(entry.id);
    }
    return {
        text: grouped(lines), summary,
        metadata: { rule: config.retrievalRule, mode: config.mode, selectedIds, summaryIds,
            omittedEntries: active.length - selectedIds.length - summaryIds.length,
            memoryChars: used, summaryChars: summary.length }
    };
}

export function boundedTranscript(history: any[], config: MemoryConfig): string {
    if (config.mode === 'none' || config.transcriptTurns === 0 || config.transcriptChars === 0) return '';
    if(history.some(t=>Object.hasOwn(t,'message'))){
        const lines=history.slice(-config.transcriptTurns).filter(t=>t.response).map(t=>JSON.stringify(t.message?{messageId:t.message.messageId,runId:t.message.runId,speaker:t.agentId,scope:t.message.scope,channelId:t.message.channelId,audience:[t.agentId,...t.message.recipientAgentIds],classification:'agent_report',content:t.response}:{speaker:t.agentId,content:t.response}));
        while(lines.length&&lines.join('\n').length>config.transcriptChars)lines.shift();
        return lines.join('\n');
    }
    return history.slice(-config.transcriptTurns).map(turn => `${turn.agentName}${turn.social ? (turn.social.action === 'decline' ? ' [declined]' : turn.social.recipient_id ? ' → ' + turn.social.recipient_id : ' → all') : ''}: ${turn.response === '' ? '[no speech]' : turn.response}`).join('\n').slice(-config.transcriptChars);
}
