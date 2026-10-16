import fetch from 'node-fetch'; // We will use native fetch or install node-fetch if Node < 18 (Node 22 supports global fetch)

export interface LlmConfig {
    baseUrl: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
}

export interface MemoryOperation {
    action: 'add' | 'update' | 'retire';
    type: 'memory' | 'belief' | 'stat';
    target_id?: string; // used for update/retire
    content: string | number; // the new memory, belief text, or stat value
    reason: string;
}

export interface AgentTurnResponse {
    response: string;
    memory_operations: MemoryOperation[];
}

export class LlmAdapter {
    private config: LlmConfig;

    constructor(config: LlmConfig = { baseUrl: 'http://127.0.0.1:8080/v1', model: 'default' }) {
        this.config = config;
    }

    updateConfig(newConfig: Partial<LlmConfig>) {
        this.config = { ...this.config, ...newConfig };
    }

    async checkHealth(): Promise<boolean> {
        try {
            // llama.cpp server usually provides /health
            const healthUrl = this.config.baseUrl.replace('/v1', '/health');
            const response = await fetch(healthUrl);
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    async getModels(): Promise<any[]> {
        try {
            const response = await fetch(`${this.config.baseUrl}/models`);
            if (!response.ok) return [];
            const data = await response.json() as any;
            return data.data || [];
        } catch (error) {
            return [];
        }
    }

    async generateTurn(systemPrompt: string, messages: { role: string; content: string }[]): Promise<AgentTurnResponse> {
        const payload = {
            model: this.config.model,
            messages: [
                { role: 'system', content: systemPrompt },
                ...messages
            ],
            temperature: this.config.temperature ?? 0.7,
            max_tokens: this.config.maxTokens ?? 512,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'agent_turn',
                    schema: {
                        type: 'object',
                        properties: {
                            response: {
                                type: 'string',
                                description: 'The conversational response to the other agent.'
                            },
                            memory_operations: {
                                type: 'array',
                                description: 'Proposed updates to your internal state based on the conversation.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        action: {
                                            type: 'string',
                                            enum: ['add', 'update', 'retire']
                                        },
                                        type: {
                                            type: 'string',
                                            enum: ['memory', 'belief', 'stat']
                                        },
                                        target_id: {
                                            type: 'string',
                                            description: 'The ID of the existing memory/belief to update or retire. Omit for add.'
                                        },
                                        content: {
                                            type: ['string', 'number'],
                                            description: 'The text of the memory/belief, or the numeric value of the stat.'
                                        },
                                        reason: {
                                            type: 'string',
                                            description: 'Why you are making this state change.'
                                        }
                                    },
                                    required: ['action', 'type', 'content', 'reason']
                                }
                            }
                        },
                        required: ['response', 'memory_operations']
                    }
                }
            }
        };

        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`LLM Error: ${response.status} ${response.statusText} - ${errText}`);
        }

        const data = await response.json() as any;
        const content = data.choices[0].message.content;

        try {
            return JSON.parse(content) as AgentTurnResponse;
        } catch (e) {
            // Fallback parsing or throw
            console.error("Failed to parse LLM response as JSON", content);
            throw new Error("Invalid JSON response from LLM");
        }
    }
}
