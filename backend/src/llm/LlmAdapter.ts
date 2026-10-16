import fetch from 'node-fetch';
import { agentTurnSchema, validateAgentTurn } from './agentTurnSchema';

export interface LlmConfig {
    baseUrl: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    outputMode?: 'json_schema' | 'json_only';
}
export interface MemoryOperation {
    action: 'add' | 'update' | 'retire';
    type: 'memory' | 'belief' | 'stat';
    target_id?: string;
    content: string | number;
    reason: string;
}
export interface LlmDiagnostics {
    httpStatus: number | null;
    requestedModel: string;
    model: string;
    finishReason: string | null;
    contentPresent: boolean;
    contentLength: number;
    excerpt: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
export interface AgentTurnResponse {
    response: string;
    memory_operations: MemoryOperation[];
}
export class LlmError extends Error {
    constructor(message: string, public readonly diagnostics: LlmDiagnostics) { super(message); }
}

export function resolveLlmConfig(config: Partial<LlmConfig> = {}): LlmConfig {
    const maxTokens = config.maxTokens ?? Number(process.env.LLM_MAX_TOKENS ?? 2048);
    const outputMode = config.outputMode ?? process.env.LLM_OUTPUT_MODE ?? 'json_schema';
    const baseUrl = (config.baseUrl ?? process.env.LLM_BASE_URL ?? 'http://127.0.0.1:8080/v1').replace(/\/$/, '');
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('LLM base URL must be HTTP(S) without embedded credentials');
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new Error('LLM maxTokens must be a positive integer');
    if (outputMode !== 'json_schema' && outputMode !== 'json_only') throw new Error('LLM outputMode must be json_schema or json_only');
    if (config.temperature !== undefined && (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2)) throw new Error('LLM temperature must be between 0 and 2');
    return { ...config, baseUrl, model: config.model ?? '', maxTokens, outputMode, temperature: config.temperature ?? 0.7 };
}

function excerpt(text: string): string {
    const capped = text.slice(0, 200).replace(/[\x00-\x1f\x7f]/g, ' ');
    // Default excerpts expose JSON punctuation only, never conversation/memory text.
    return (process.env.LLM_DEBUG_CONTENT === 'true' ? capped : capped.replace(/[^{}\[\]:,"\s]+/g, '…')) + (text.length > 200 ? '… [truncated]' : '');
}

export class LlmAdapter {
    private config: LlmConfig;
    public lastDiagnostics: LlmDiagnostics | undefined;
    constructor(config: Partial<LlmConfig> = {}) { this.config = resolveLlmConfig(config); }
    updateConfig(config: Partial<LlmConfig>) { this.config = resolveLlmConfig({ ...this.config, ...config }); }

    async checkHealth(): Promise<boolean> {
        try {
            const url = new URL(this.config.baseUrl);
            url.pathname = url.pathname.replace(/\/v1$/, '') + '/health';
            return (await fetch(url.toString(), { timeout: 30000 })).ok;
        } catch { return false; }
    }

    async getModels(): Promise<{ id: string }[]> {
        const response = await fetch(`${this.config.baseUrl}/models`, { timeout: 30000 });
        const text = await response.text();
        if (!response.ok) throw new Error(`Model discovery failed (HTTP ${response.status})`);
        let data: any;
        try { data = JSON.parse(text); } catch { throw new Error('Model discovery returned non-JSON data'); }
        if (!Array.isArray(data?.data) || !data.data.every((m: any) => typeof m?.id === 'string' && m.id.length > 0)) throw new Error('Model discovery returned an invalid model list');
        return data.data.map((m: any) => ({ id: m.id }));
    }

    async generateTurn(systemPrompt: string, messages: { role: string; content: string }[]): Promise<AgentTurnResponse> {
        this.lastDiagnostics = undefined;
        if (!this.config.model) throw new Error('Select a loaded model before running an experiment');
        const diagnostics: LlmDiagnostics = {
            httpStatus: null, requestedModel: this.config.model, model: this.config.model,
            finishReason: null, contentPresent: false, contentLength: 0, excerpt: ''
        };
        const payload = {
            model: this.config.model,
            messages: [ { role: 'system', content: systemPrompt }, ...messages,
                // Format instruction only; identity/personality instructions are unchanged.
                ...(this.config.outputMode === 'json_only' ? [{ role: 'system', content: 'Return only a JSON object with response (string) and memory_operations (array, empty when no changes). Memory operations have action (add/update/retire), type (memory/belief/stat), optional target_id, content and reason. Do not use Markdown fences.' }] : [])
            ],
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            response_format: this.config.outputMode === 'json_only'
                ? { type: 'json_object' }
                : { type: 'json_schema', json_schema: { name: 'agent_turn', schema: agentTurnSchema } }
        };
        const fail = (message: string): never => { throw new LlmError(message, diagnostics); };
        try {
            let response;
            try {
                response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload), timeout: 300000
                });
            } catch { return fail('LLM request failed or timed out; check the configured server connection'); }
            diagnostics.httpStatus = response.status;
            const raw = await response.text();
            let data: any;
            try { data = JSON.parse(raw); } catch {
                diagnostics.contentLength = raw.length;
                diagnostics.excerpt = excerpt(raw);
                return fail(`LLM returned a non-JSON HTTP body (HTTP ${response.status})`);
            }
            if (typeof data?.model === 'string') diagnostics.model = data.model;
            const choice = data?.choices?.[0];
            const content = choice?.message?.content;
            diagnostics.finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
            diagnostics.contentPresent = typeof content === 'string';
            diagnostics.contentLength = typeof content === 'string' ? content.length : 0;
            diagnostics.excerpt = typeof content === 'string' ? excerpt(content) : '';
            if (data?.usage && typeof data.usage === 'object') {
                diagnostics.usage = {};
                for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
                    if (Number.isFinite(data.usage[key])) diagnostics.usage[key] = data.usage[key];
                }
            }
            if (!response.ok) return fail(`LLM request rejected (HTTP ${response.status}); verify model and configured output mode. No automatic fallback was attempted`);
            if (!Array.isArray(data?.choices) || !choice || typeof choice.message !== 'object') return fail('Invalid OpenAI-compatible response: missing choices[0].message');
            if (diagnostics.finishReason === 'length') return fail(`LLM response truncated (finish_reason: length; max_tokens: ${this.config.maxTokens}). Increase the output limit in a new run`);
            if (diagnostics.finishReason && diagnostics.finishReason !== 'stop') return fail(`LLM did not finish normally (finish_reason: ${diagnostics.finishReason})`);
            if (typeof content !== 'string' || !content.trim()) return fail('LLM response is missing nonempty choices[0].message.content');
            let parsed: unknown;
            try { parsed = JSON.parse(content); } catch { return fail('Invalid JSON response from LLM; inspect diagnostics for truncation or output-format incompatibility'); }
            try { validateAgentTurn(parsed); } catch (error: any) { return fail(error.message); }
            return parsed as AgentTurnResponse;
        } catch (error) {
            if (error instanceof LlmError) throw error;
            throw new LlmError('LLM response could not be read or validated; check server connection and output compatibility', diagnostics);
        } finally {
            this.lastDiagnostics = diagnostics;
            console.info('LLM response diagnostics', diagnostics);
        }
    }
}
