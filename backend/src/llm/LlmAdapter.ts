import type {TurnViolation} from '../validation/issues';
import {uniqueViolations} from '../validation/issues';
import {ExecutionContext,turnExecutionContract,executionViolations,EXECUTION_MARKER,EXECUTION_CONTRACT_VERSION} from '../interaction/execution';
import type { OperationalOperation } from '../operations/state';
import { memoryContentWarnings, MemoryContentWarning } from '../memory/contentDiagnostics';
import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { responseSchema, inferenceResponseSchema, INFERENCE_SCHEMA_VERSION, validateAgentTurn } from './agentTurnSchema';

export interface LlmConfig {
    baseUrl: string;
    model: string;
    temperature?: number;
    topP?: number;
    seed?: number;
    seedSupported?: boolean;
    modelVersion?: string;
    contextWindowTokens?: number;
    maxTokens?: number;
    requestTimeoutMs?: number;
    outputMode?: 'json_schema' | 'json_only';
}
export interface MemoryOperation {
    action: 'add' | 'update' | 'retire' | 'consolidate' | 'contradict';
    type: 'memory' | 'episodic' | 'belief' | 'stat' | 'self_description' | 'relationship';
    target_ids?: string[];
    confidence?: number;
    importance?: number;
    relationship_agent_id?: string;
    target_id?: string;
    content: string | number;
    reason: string;
}
export interface LlmDiagnostics {
    requestTimeoutMs?:number; elapsedMs?:number; inputChars?:number; maxTokens?:number; failureStage?:string;
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
    decision?: {mode:string;reason:string;goal:string|null};
    communication?: {scope:string;recipientAgentIds:string[]}|null;
    response: string;
    memory_operations: MemoryOperation[];
    operational_operations?: OperationalOperation[];
    world_operations?: any[];
    social?: {action:'speak'|'decline';recipient_id:string|null};
    task_decision?: {amount:number};
}
export interface LlmValidation {
    contractVersion: 'schema-json-v1';
    schemaHash: string; // Authoritative validation schema, retained for historical readers.
    validationSchemaHash: string;
    inferenceSchemaHash?: string;
    inferenceSchemaVersion?: typeof INFERENCE_SCHEMA_VERSION;
    status: 'pending' | 'passed' | 'failed';
    stage: 'request' | 'http' | 'http_body' | 'envelope' | 'response_json' | 'schema' | 'transport_boundary' | 'complete';
    error?: string;
    violations?:TurnViolation[];
    executionContractVersion?:string; executionContractHash?:string;
    memoryContentWarnings?: MemoryContentWarning[];
}
export const TRANSPORT_MARKER = '[EMERGENTSELF_TRANSPORT_FORMAT_V1]';
export function outputContract(schema: ReturnType<typeof responseSchema>): string {
    return `${TRANSPORT_MARKER}
Transport serialization requirements only. This message is not conversational content, an agent identity, an experience, or a memory instruction. Do not quote or store these requirements or the schema in response text or memory operations.
Return exactly one valid JSON object conforming to the schema below. Include every required field. Use an empty memory_operations array when no memory changes are proposed. Put conversational text only inside response. No Markdown fences, preamble, trailing commentary, or additional JSON values. Preserve the meaning of the agent's reply and decisions; these requirements specify formatting only.
JSON Schema:
${JSON.stringify(schema)}
[/EMERGENTSELF_TRANSPORT_FORMAT_V1]`;
}
export class LlmError extends Error {
    constructor(message: string, public readonly diagnostics: LlmDiagnostics, public readonly kind:'output'|'timeout'|'connection'|'server'|'configuration'='output',public readonly violations?:TurnViolation[]) { super(message); }
}

export const DEFAULT_REQUEST_TIMEOUT_MS=600000;
export function resolveLlmConfig(config: Partial<LlmConfig> = {}): LlmConfig {
    const requestTimeoutMs=config.requestTimeoutMs??Number(process.env.LLM_REQUEST_TIMEOUT_MS??DEFAULT_REQUEST_TIMEOUT_MS);
    if(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<10||requestTimeoutMs>900000)throw new Error('LLM request timeout must be 10–900000 milliseconds');
    const maxTokens = config.maxTokens ?? Number(process.env.LLM_MAX_TOKENS ?? 2048);
    const outputMode = config.outputMode ?? process.env.LLM_OUTPUT_MODE ?? 'json_schema';
    const baseUrl = (config.baseUrl ?? process.env.LLM_BASE_URL ?? 'http://127.0.0.1:8080/v1').replace(/\/$/, '');
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('LLM base URL must be HTTP(S) without embedded credentials');
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new Error('LLM maxTokens must be a positive integer');
    if (outputMode !== 'json_schema' && outputMode !== 'json_only') throw new Error('LLM outputMode must be json_schema or json_only');
    if (config.temperature !== undefined && (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2)) throw new Error('LLM temperature must be between 0 and 2');
    if (config.topP !== undefined && (!Number.isFinite(config.topP) || config.topP < 0 || config.topP > 1)) throw new Error('topP must be between 0 and 1');
    if (config.seedSupported !== undefined && typeof config.seedSupported !== 'boolean') throw new Error('seedSupported must be a boolean');
    if (config.seed !== undefined && (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff || config.seedSupported !== true)) throw new Error('A uint32 seed requires explicitly declared server seed support');
    if (config.modelVersion !== undefined && (typeof config.modelVersion !== 'string' || !config.modelVersion.trim() || config.modelVersion.length > 256)) throw new Error('Invalid model version');
    if (config.contextWindowTokens !== undefined && (!Number.isSafeInteger(config.contextWindowTokens) || config.contextWindowTokens < maxTokens)) throw new Error('Declared model context must accommodate completion tokens');
    return { ...config, ...((config.requestTimeoutMs!==undefined||process.env.LLM_REQUEST_TIMEOUT_MS!==undefined)?{requestTimeoutMs}:{}), baseUrl, model: config.model ?? '', maxTokens, outputMode, temperature: config.temperature ?? 0.7 };
}

function excerpt(text: string): string {
    const capped = text.slice(0, 200).replace(/[\x00-\x1f\x7f]/g, ' ');
    // Default excerpts expose JSON punctuation only, never conversation/memory text.
    return (process.env.LLM_DEBUG_CONTENT === 'true' ? capped : capped.replace(/[^{}\[\]:,"\s]+/g, '…')) + (text.length > 200 ? '… [truncated]' : '');
}

export class LlmAdapter {
    private config: LlmConfig;
    public lastRequest: any;
    public lastParsedResponse: unknown;
    public lastRawContent: string | undefined;
    public lastDiagnostics: LlmDiagnostics | undefined;
    public lastValidation: LlmValidation | undefined;
    constructor(config: Partial<LlmConfig> = {}) { this.config = resolveLlmConfig(config); }
    updateConfig(config: Partial<LlmConfig>) { this.config = resolveLlmConfig({ ...this.config, ...config }); }
    // A saved experiment is a complete configuration, not a patch to the previous run.
    setExperimentConfig(config:LlmConfig) { this.config=resolveLlmConfig(config); }

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

    async generateTurn(systemPrompt: string, messages: { role: string; content: string }[], inputCharLimit?: number, social = false, task = false, operational = false, world = false, signal?:AbortSignal, beforeRequest?:(request:any)=>Promise<void>, decision = false, channels = false, execution?:ExecutionContext): Promise<AgentTurnResponse> {
        this.lastRequest = undefined;
        this.lastDiagnostics = undefined;
        this.lastRawContent = undefined;
        this.lastParsedResponse = undefined;
        this.lastValidation = undefined;
        if (!this.config.model) throw new Error('Select a loaded model before running an experiment');
        const started=Date.now();
        const diagnostics: LlmDiagnostics = {
            requestTimeoutMs:this.config.requestTimeoutMs??DEFAULT_REQUEST_TIMEOUT_MS,maxTokens:this.config.maxTokens,
            httpStatus: null, requestedModel: this.config.model, model: this.config.model,
            finishReason: null, contentPresent: false, contentLength: 0, excerpt: ''
        };
        const schema = responseSchema(social, task, operational, world, decision, channels, execution);
        const schemaText = JSON.stringify(schema);
        const executionText=execution?turnExecutionContract(execution):undefined;
        const inferenceSchema = inferenceResponseSchema(social, task, operational, world, decision, channels, execution);
        const validationSchemaHash = createHash('sha256').update(schemaText).digest('hex');
        this.lastValidation = {contractVersion:'schema-json-v1',schemaHash:validationSchemaHash,validationSchemaHash,
            ...(this.config.outputMode === 'json_schema' ? {inferenceSchemaVersion:INFERENCE_SCHEMA_VERSION,inferenceSchemaHash:createHash('sha256').update(JSON.stringify(inferenceSchema)).digest('hex')} : {}),...(executionText?{executionContractVersion:EXECUTION_CONTRACT_VERSION,executionContractHash:createHash('sha256').update(executionText).digest('hex')}:{}),status:'pending',stage:'request'};
        const payload = {
            model: this.config.model,
            // Keep the original agent prompt and conversational messages intact.
            // Prompt instructions retain all application limits; only the decoder
            // receives a projection without bounded upper string/array repetitions.
            messages: [{role:'system',content:systemPrompt}, ...messages, ...(executionText?[{role:'system',content:executionText}]:[]), {role:'system',content:outputContract(schema)}],
            temperature: this.config.temperature,
            ...(this.config.topP === undefined ? {} : { top_p: this.config.topP }),
            ...(this.config.seed === undefined ? {} : { seed: this.config.seed }),
            max_tokens: this.config.maxTokens,
            response_format: this.config.outputMode === 'json_only'
                ? { type: 'json_object' }
                : { type: 'json_schema', json_schema: { name: 'agent_turn', schema: inferenceSchema } }
        };
        diagnostics.inputChars=payload.messages.reduce((n,message)=>n+message.content.length,0);
        this.lastRequest = structuredClone(payload);
        if(beforeRequest)await beforeRequest(structuredClone(payload));
        const fail = (message: string,kind:LlmError['kind']='output'): never => {
            Object.assign(this.lastValidation!, {status:'failed',error:message});
            diagnostics.failureStage=this.lastValidation!.stage;
            throw new LlmError(message, diagnostics,kind,this.lastValidation!.violations);
        };
        try {
            if (inputCharLimit !== undefined && payload.messages.reduce((n, message) => n + message.content.length, 0) > inputCharLimit) return fail('LLM request exceeds the recorded input character limit','configuration');
            this.lastValidation.stage = 'http';
            let response;
            try {
                response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload), timeout: diagnostics.requestTimeoutMs, signal:signal as any
                });
            } catch(error:any) { const timeout=error?.type==='request-timeout'||error?.code==='ETIMEDOUT';return fail(timeout?`LLM inference timed out after ${diagnostics.requestTimeoutMs} ms; no proposal was committed. Inspect request size and server timing; this is a technical failure, not a decision violation.`:'LLM connection failed; check the configured server connection',timeout?'timeout':'connection'); }
            diagnostics.httpStatus = response.status;
            this.lastValidation.stage = 'http_body';
            const raw = await response.text();
            let data: any;
            try { data = JSON.parse(raw); } catch {
                diagnostics.contentLength = raw.length;
                diagnostics.excerpt = excerpt(raw);
                return fail(`LLM returned a non-JSON HTTP body (HTTP ${response.status})`,!response.ok?(response.status>=500||response.status===429||response.status===408?'server':'configuration'):'output');
            }
            if (typeof data?.model === 'string') diagnostics.model = data.model;
            const choice = data?.choices?.[0];
            const content = choice?.message?.content;
            diagnostics.finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
            diagnostics.contentPresent = typeof content === 'string';
            if (typeof content === 'string') this.lastRawContent = content;
            diagnostics.contentLength = typeof content === 'string' ? content.length : 0;
            diagnostics.excerpt = typeof content === 'string' ? excerpt(content) : '';
            if (data?.usage && typeof data.usage === 'object') {
                diagnostics.usage = {};
                for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
                    if (Number.isFinite(data.usage[key])) diagnostics.usage[key] = data.usage[key];
                }
            }
            if (!response.ok) return fail(`LLM request rejected (HTTP ${response.status}); verify model and configured output mode. No automatic fallback was attempted`,response.status===408||response.status===429||response.status>=500?'server':'configuration');
            this.lastValidation.stage = 'envelope';
            if (!Array.isArray(data?.choices) || !choice || typeof choice.message !== 'object') return fail('Invalid OpenAI-compatible response: missing choices[0].message');
            if (diagnostics.finishReason === 'length') return fail(`LLM response truncated (finish_reason: length; max_tokens: ${this.config.maxTokens}). Increase the output limit in a new run`);
            if (diagnostics.finishReason && diagnostics.finishReason !== 'stop') return fail(`LLM did not finish normally (finish_reason: ${diagnostics.finishReason})`);
            if (typeof content !== 'string' || !content.trim()) return fail('LLM response is missing nonempty choices[0].message.content');
            this.lastValidation.stage = 'response_json';
            let parsed: unknown;
            try { parsed = JSON.parse(content); } catch { return fail('Invalid JSON response from LLM; inspect diagnostics for truncation or output-format incompatibility'); }
            this.lastParsedResponse = structuredClone(parsed);
            const warnings = memoryContentWarnings((parsed as any)?.memory_operations);
            if (warnings.length) this.lastValidation.memoryContentWarnings = warnings;
            this.lastValidation.stage = 'schema';
            try { validateAgentTurn(parsed, social, task, operational, world, decision, channels, execution); } catch (error: any) {
                const violations=uniqueViolations([...(execution?executionViolations(parsed,execution):[]),...(error.violations??[])]);
                this.lastValidation.violations=violations;
                return fail(error.message+(violations.length?'\n'+violations.map(issue=>issue.code+' '+issue.path+': '+issue.message).join('\n'):''));
            }
            this.lastValidation.stage = 'transport_boundary';
            const turn = parsed as AgentTurnResponse;
            const echoesContract = (value: unknown) => typeof value === 'string' && (value.includes('[EMERGENTSELF_CORRECTION_V1]') || value.includes(EXECUTION_MARKER) || value.includes(TRANSPORT_MARKER) || value.includes(schemaText));
            if (echoesContract(turn.response) || turn.memory_operations.some(operation => echoesContract(operation.content) || echoesContract(operation.reason)) || turn.world_operations?.some(operation=>echoesContract(operation.reason)) || turn.operational_operations?.some(operation => echoesContract(operation.reason) || ('description' in operation && echoesContract(operation.description)))) {
                return fail('LLM echoed reserved transport metadata into conversation, memory or operational operations; output was rejected without rewriting');
            }
            this.lastValidation.status = 'passed';
            this.lastValidation.stage = 'complete';
            return turn;
        } catch (error:any) {
            if (error instanceof LlmError) throw error;
            const timeout=error?.type==='body-timeout'||error?.type==='request-timeout';
            return fail(timeout?`LLM response body timed out after ${diagnostics.requestTimeoutMs} ms; no proposal was committed. Inspect server timing.`:'LLM response could not be read; check server connection',timeout?'timeout':'connection');
        } finally {
            diagnostics.elapsedMs=Date.now()-started;
            this.lastDiagnostics = diagnostics;
            console.info('LLM response diagnostics', diagnostics);
        }
    }
}
