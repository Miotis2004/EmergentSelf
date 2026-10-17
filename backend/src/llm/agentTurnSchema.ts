import Ajv from 'ajv';

// Complete anyOf object variants work with llama.cpp constrained generation;
// avoid conditional if/then schemas, which some local decoders ignore.
const operationProperties = {
    target_id: { type:'string', minLength:1, description:'Exact existing active entry ID of the same category; stat updates use the exact stat name. Never invent an ID.' },
    target_ids: { type:'array', minItems:2, maxItems:20, uniqueItems:true, items:{type:'string',minLength:1}, description:'Exact active entry IDs of the same category to consolidate' },
    type: { enum: ['memory', 'episodic', 'belief', 'stat', 'self_description', 'relationship'], description: 'memory is a legacy alias for episodic observations; beliefs/opinions, self-description and relationships are separate categories' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    importance: { type: 'number', minimum: 0, maximum: 1 },
    relationship_agent_id: { type: 'string', minLength: 1 },
    content: { type: ['string', 'number'], maxLength: 8000 },
    reason: { type: 'string', minLength: 1 }
};
const operationSchema = (actions: string[], required: string[]) => ({
    type:'object', additionalProperties:false,
    properties:{action:{enum:actions}, ...operationProperties},
    required:['action','type','content','reason',...required]
});
export const memoryOperationSchema = {anyOf:[
    operationSchema(['add'], []),
    operationSchema(['update','retire','contradict'], ['target_id']),
    operationSchema(['consolidate'], ['target_ids'])
]};

// Shared by the server's constrained decoder and our independent validator.
export const agentTurnSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        response: { type: 'string' },
        memory_operations: {
            type: 'array', maxItems: 50, items: memoryOperationSchema
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
        // Explain reference-shape errors without exposing memory content in diagnostics.
        const operations = (value as any)?.memory_operations;
        if (Array.isArray(operations)) for (const [index, op] of operations.entries()) {
            if (['update','retire','contradict'].includes(op?.action) && (typeof op.target_id !== 'string' || !op.target_id.trim())) {
                throw new Error(`Invalid agent-turn schema: memory_operations/${index} missing target_id; revision requires an exact existing active target ID`);
            }
            if (op?.action === 'consolidate' && (!Array.isArray(op.target_ids) || op.target_ids.length < 2 || op.target_ids.some((id:unknown)=>typeof id !== 'string' || !id.trim()) || new Set(op.target_ids).size !== op.target_ids.length)) {
                throw new Error(`Invalid agent-turn schema: memory_operations/${index} consolidation requires at least two distinct nonempty target_ids`);
            }
        }
        // Paths and validator keywords are safe; never include model-generated values.
        throw new Error(`Invalid agent-turn schema: ${validate.errors?.map(e => `${e.instancePath || '/'} ${e.keyword}`).join(', ')}`);
    }
}
