import Ajv from 'ajv';

// Shared by the server's constrained decoder and our independent validator.
export const agentTurnSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        response: { type: 'string' },
        memory_operations: {
            type: 'array', items: {
                type: 'object', additionalProperties: false,
                properties: {
                    action: { enum: ['add', 'update', 'retire'] },
                    type: { enum: ['memory', 'belief', 'stat'] },
                    target_id: { type: 'string', minLength: 1 },
                    content: { type: ['string', 'number'] },
                    reason: { type: 'string', minLength: 1 }
                },
                required: ['action', 'type', 'content', 'reason']
            }
        }
    },
    required: ['response']
};
const validate = new Ajv({ strict: false, strictNumbers: true }).compile(agentTurnSchema);

export function validateAgentTurn(value: unknown): asserts value is import('./LlmAdapter').AgentTurnResponse {
    if (!validate(value)) {
        // Paths and validator keywords are safe; never include model-generated values.
        throw new Error(`Invalid agent-turn schema: ${validate.errors?.map(e => `${e.instancePath || '/'} ${e.keyword}`).join(', ')}`);
    }
    const turn = value as unknown as import('./LlmAdapter').AgentTurnResponse;
    turn.memory_operations ??= [];
}
