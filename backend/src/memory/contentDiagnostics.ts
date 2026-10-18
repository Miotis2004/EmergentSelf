/** Narrow observation only: never normalize or reject agent-authored content. */
export interface MemoryContentWarning {
    code: 'memory_content_record_header';
    severity: 'warning';
    operationIndex: number;
    format: 'legacy_header' | 'structured_record';
    message: string;
    content: string;
}
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const legacyHeader = new RegExp(`^\\s*\\[${uuid}\\]\\s*(?:memory|episodic|belief|self_description|relationship)\\s*\\(confidence\\s*=\\s*(?:0(?:\\.\\d+)?|1(?:\\.0+)?)\\)\\s*:`, 'i');
export function memoryContentWarnings(operations: unknown): MemoryContentWarning[] {
    if (!Array.isArray(operations)) return [];
    return operations.flatMap((operation, operationIndex) => {
        if (!operation || operation.type === 'stat' || typeof operation.content !== 'string') return [];
        let format: MemoryContentWarning['format'] | undefined;
        if (legacyHeader.test(operation.content)) format = 'legacy_header';
        else if (operation.content.trimStart().startsWith('{')) {
            try {
                const record = JSON.parse(operation.content);
                if (record?.metadata && typeof record.metadata.id === 'string' &&
                    ['episodic','memory','belief','self_description','relationship'].includes(record.metadata.type) &&
                    typeof record.content === 'string') format = 'structured_record';
            } catch { /* Ordinary prose or incomplete JSON is not classified. */ }
        }
        return format ? [{code:'memory_content_record_header' as const,severity:'warning' as const,
            operationIndex,format,message:'Memory content begins with serialized record metadata; original content retained without rewriting or rejection.',content:operation.content}] : [];
    });
}
