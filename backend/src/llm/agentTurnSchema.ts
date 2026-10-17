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
    required: ['response', 'memory_operations']
};
export const socialTurnSchema = {
    ...agentTurnSchema,
    properties: {...agentTurnSchema.properties,
        social: {type:'object',additionalProperties:false,properties:{action:{enum:['speak','decline']},recipient_id:{type:['string','null']}},required:['action','recipient_id']},
        task_decision: {description:'Required when social.action is speak in task-enabled requests; omit when declining.',type:'object',additionalProperties:false,properties:{amount:{type:'integer',minimum:0,maximum:100}},required:['amount']}
    }, required:[...agentTurnSchema.required,'social']
};
const {task_decision, ...socialOnlyProperties} = socialTurnSchema.properties;
const socialOnlySchema = {...socialTurnSchema, properties:socialOnlyProperties};

export function responseSchema(social = false, task = false) {
    if (task && !social) throw new Error('Task output requires social capability');
    return social ? (task ? socialTurnSchema : socialOnlySchema) : agentTurnSchema;
}
const ajv = new Ajv({ strict: false, strictNumbers: true });
const validators = [ajv.compile(agentTurnSchema), ajv.compile(socialOnlySchema), ajv.compile(socialTurnSchema)];

export function validateAgentTurn(value: unknown, social = false, task = false): asserts value is import('./LlmAdapter').AgentTurnResponse {
    const validate = validators[social ? (task ? 2 : 1) : 0];
    if (!validate(value)) {
        // Paths and validator keywords are safe; never include model-generated values.
        throw new Error(`Invalid agent-turn schema: ${validate.errors?.map(e => `${e.instancePath || '/'} ${e.keyword}`).join(', ')}`);
    }
}
