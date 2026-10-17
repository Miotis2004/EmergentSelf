import Ajv from 'ajv';

// Shared by the server's constrained decoder and our independent validator.
export const agentTurnSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        response: { type: 'string' },
        memory_operations: {
            type: 'array', maxItems: 50, items: {
                type: 'object', additionalProperties: false,
                properties: {
                    action: { enum: ['add', 'update', 'retire', 'consolidate', 'contradict'], description: 'update revises a target_id; contradict supersedes a target_id with an alternative; consolidate summarizes target_ids without deleting originals; retire deactivates a target_id' },
                    type: { enum: ['memory', 'episodic', 'belief', 'stat', 'self_description', 'relationship'], description: 'memory is a legacy alias for episodic observations; beliefs/opinions, self-description and relationships are separate categories' },
                    target_id: { type: 'string', minLength: 1 },
                    target_ids: { type: 'array', minItems: 2, maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1 }, description: 'Existing entry IDs to consolidate into one entry of the same category' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    importance: { type: 'number', minimum: 0, maximum: 1 },
                    relationship_agent_id: { type: 'string', minLength: 1 },
                    content: { type: ['string', 'number'], maxLength: 8000 },
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
