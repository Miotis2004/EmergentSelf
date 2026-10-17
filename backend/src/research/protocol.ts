import { createHash } from 'crypto';
import { MemoryConfig, WorkingState } from '../memory/types';
import { retrieveMemory, boundedTranscript } from '../memory/retrieval';

export class ProtocolError extends Error {}

export const CONDITIONS = ['none', 'history', 'enabled'] as const;
export const DEFAULT_SYSTEM_PROMPT = `You are an agent with the following identity:
ID: {id}
Name: {name}

Attributes:
{attributes}

Working memory:
{memory}

Extractive digest (excerpts; originals retained):
{digest}

Recent conversation:
{transcript}

Based on the conversation, generate a reply. You may propose revisions to your working state.`;
export interface Protocol {
    version: 1;
    condition: 'none' | 'history' | 'enabled';
    systemPrompt: string;
    turnPrompt: string;
    inputCharLimit: number;
    attributeMode: 'numeric' | 'arbitrary' | 'role';
    roles: Record<string, string>;
    stateScope: 'shared' | 'trial';
    snapshotId?: string;
    initialStateHash?: string;
    templateId?: string;
    batchId?: string;
    trialIndex?: number;
    repeatIndex?: number;
    randomizationSeed?: number;
}
export function id(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) throw new Error('IDs must contain 1–120 letters, numbers, hyphens or underscores');
    return value;
}
export function text(value: unknown, label: string, maximum = 4000): string {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`${label} must be nonempty text up to ${maximum} characters`);
    return value;
}
export function seed(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer');
    return Number(value);
}
export function normalizeProtocol(input: Partial<Protocol>, mode: MemoryConfig['mode']): Protocol {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid protocol');
    if (input.version !== undefined && input.version !== 1) throw new Error('Unsupported protocol version');
    const condition = input.condition ?? mode;
    if (!CONDITIONS.includes(condition) || condition !== mode) throw new Error('Protocol condition must match the memory condition');
    const attributeMode = input.attributeMode ?? 'numeric';
    const stateScope = input.stateScope ?? 'shared';
    if (!['numeric', 'arbitrary', 'role'].includes(attributeMode) || !['shared', 'trial'].includes(stateScope)) throw new Error('Invalid attribute mode or state scope');
    const systemPrompt = text(input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT, 'System prompt', 12000);
    const turnPrompt = text(input.turnPrompt ?? 'It is your turn to speak, {name}.', 'Turn prompt', 2000);
    const allowed = new Set(['id','name','attributes','memory','digest','transcript']);
    for (const prompt of [systemPrompt, turnPrompt]) for (const match of prompt.matchAll(/(?<!\{)\{([A-Za-z_]+)\}(?!\})/g)) {
        if (!allowed.has(match[1])) throw new Error(`Unknown prompt placeholder: ${match[1]}`);
    }
    const inputCharLimit = input.inputCharLimit ?? 24000;
    if (!Number.isSafeInteger(inputCharLimit) || inputCharLimit < 1 || inputCharLimit > 128000) throw new Error('Input character limit must be 1–128000');
    const roles = input.roles ?? {};
    if (!roles || typeof roles !== 'object' || Array.isArray(roles)) throw new Error('Roles must map agent IDs to descriptions');
    for (const [key, value] of Object.entries(roles)) { id(key); text(value, 'Role description', 2000); }
    if (attributeMode !== 'role' && Object.keys(roles).length) throw new Error('Role descriptions require the explicit role condition');
    for (const key of ['snapshotId','templateId','batchId'] as const) if (input[key] !== undefined) id(input[key]);
    if (input.initialStateHash !== undefined && !/^[a-f0-9]{64}$/.test(input.initialStateHash)) throw new Error('Invalid initial-state hash');
    for (const key of ['trialIndex','repeatIndex','randomizationSeed'] as const) if (input[key] !== undefined) seed(input[key]);
    if (stateScope === 'trial' && !input.snapshotId) throw new Error('Isolated trials require a frozen snapshot');
    return { ...input, version: 1, condition, systemPrompt, turnPrompt, inputCharLimit, attributeMode, roles: { ...roles }, stateScope };
}
function canonical(value: any): any {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
export function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export function shuffled<T>(values: T[], initialSeed: number): T[] {
    let state = seed(initialSeed);
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const j = Math.floor((state / 4294967296) * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
export function renderProtocol(state: WorkingState, config: MemoryConfig, protocol: Protocol, history: any[], stimulus?: string) {
    const retrieved = retrieveMemory(state, config);
    const identity = state.identity;
    const attributeLabels = Object.fromEntries(Object.keys(identity.stats).sort().map((key,index)=>[key,protocol.attributeMode === 'arbitrary' ? `q${index+1}` : key]));
    let attributes: string;
    if (protocol.attributeMode === 'role') attributes = protocol.roles[identity.id] ?? '';
    else attributes = Object.keys(identity.stats).sort().map((key, index) =>
        `- ${protocol.attributeMode === 'arbitrary' ? `q${index + 1}` : key}: ${config.mode === 'enabled' ? identity.stats[key].current : identity.stats[key].initial}`).join('\n');
    const fields: Record<string, string> = { id: identity.id, name: identity.name, attributes,
        memory: retrieved.text || '(None supplied)', digest: retrieved.summary || '(None supplied)',
        transcript: boundedTranscript(history, config) || '(No conversation supplied)' };
    // One replacement pass: memory/role text containing braces is never interpreted.
    const render = (value: string) => value.replace(/(?<!\{)\{([A-Za-z_]+)\}(?!\})/g, (_, key) => fields[key]);
    const system = render(protocol.systemPrompt);
    const messages = [{ role: 'user', content: stimulus ?? render(protocol.turnPrompt) }];
    if (system.length + messages[0].content.length > protocol.inputCharLimit) throw new ProtocolError('Rendered prompt exceeds the recorded input character limit');
    return { system, messages, retrieval: { ...retrieved.metadata, attributeLabels, transcriptChars: fields.transcript.length, config }, state };
}
export function differences(left: any, right: any, path = ''): any[] {
    if (hash(left ?? null) === hash(right ?? null)) return [];
    if (left && right && !Array.isArray(left) && !Array.isArray(right) && typeof left === 'object' && typeof right === 'object') {
        return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap(key => differences(left[key], right[key], path ? `${path}.${key}` : key));
    }
    return [{ path, left: left ?? null, right: right ?? null }];
}
