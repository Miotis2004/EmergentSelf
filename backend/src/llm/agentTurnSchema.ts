import { operationalOperationsSchema } from '../operations/state';
import Ajv from 'ajv';

// Complete anyOf object variants work with llama.cpp constrained generation;
// avoid conditional if/then schemas, which some local decoders ignore.
const operationProperties = {
    target_id: { type:'string', minLength:1, description:'Exact existing active entry ID of the same category; stat updates use the exact stat name. Never invent an ID.' },
    target_ids: { type:'array', minItems:2, maxItems:20, uniqueItems:true, items:{type:'string',minLength:1}, description:'Exact active entry IDs of the same category to consolidate' },
    type: { enum: ['memory', 'episodic', 'belief', 'stat', 'self_description', 'relationship'], description: 'memory is a legacy alias for episodic observations; beliefs/opinions, self-description and relationships are separate categories' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    importance: { type: 'number', minimum: 0, maximum: 1 },
    relationship_agent_id: { type: 'string', minLength: 1, description: 'For relationship additions, required exact ID of another participant from the directory, not a name. Revisions preserve the original subject; omit to retain it.' },
    content: { type: ['string', 'number'], maxLength: 8000, description: 'Natural-language information only (numeric value for stats). Do not embed record IDs, category/confidence labels, or serialized memory headers.' },
    reason: { type: 'string', minLength: 1 }
};
const operationSchema = (actions: string[], required: string[], types: string[] = operationProperties.type.enum) => ({
    type:'object', additionalProperties:false,
    properties:{action:{enum:actions}, ...operationProperties, type:{...operationProperties.type,enum:types}},
    required:['action','type','content','reason',...required]
});
export const memoryOperationSchema = {anyOf:[
    operationSchema(['add'], [], operationProperties.type.enum.filter(type=>type !== 'relationship')),
    operationSchema(['add'], ['relationship_agent_id'], ['relationship']),
    operationSchema(['update','retire','contradict'], ['target_id']),
    operationSchema(['consolidate'], ['target_ids'])
]};

// Authoritative application validation schema. Decoder projection below relaxes only
// upper repetition bounds; it never changes these backend limits.
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

function withOperational(schema:any) { return {...schema,properties:{...schema.properties,operational_operations:operationalOperationsSchema},required:[...schema.required,'operational_operations']}; }
export function responseSchema(social = false, task = false, operational = false) {
    if (task && !social) throw new Error('Task output requires social capability');
    const schema = social ? (task ? socialTurnSchema : socialOnlySchema) : agentTurnSchema;
    return operational ? withOperational(schema) : schema;
}
/**
 * llama.cpp expands bounded repetitions while compiling a schema into grammar.
 * char{0,8000}-style strings and bounded operation arrays can exceed expansion
 * guards. Unbounded JSON strings/arrays avoid these large finite repetitions;
 * the backend still checks every limit.
 * All structure, required fields, enums, minima and numeric constraints are retained.
 */
export const INFERENCE_SCHEMA_VERSION = 'llama-unbounded-v1';
export function inferenceResponseSchema(social = false, task = false, operational = false) {
    function project(value:any):any {
        if(Array.isArray(value))return value.map(project);
        if(value && typeof value === 'object')return Object.fromEntries(Object.entries(value)
            .filter(([key])=>key !== 'maxLength' && key !== 'maxItems')
            .map(([key,child])=>[key,project(child)]));
        return value;
    }
    return project(responseSchema(social,task,operational));
}

const ajv = new Ajv({ strict: false, strictNumbers: true });
const validators = [agentTurnSchema,socialOnlySchema,socialTurnSchema].flatMap(schema=>[ajv.compile(schema),ajv.compile(withOperational(schema))]);

export function validateAgentTurn(value: unknown, social = false, task = false, operational = false): asserts value is import('./LlmAdapter').AgentTurnResponse {
    const validate = validators[(social ? (task ? 2 : 1) : 0)*2+Number(operational)];
    if (!validate(value)) {
        // Explain reference-shape errors without exposing memory content in diagnostics.
        const operations = (value as any)?.memory_operations;
        if (Array.isArray(operations)) for (const [index, op] of operations.entries()) {
            if (op?.action === 'add' && op?.type === 'relationship' && (typeof op.relationship_agent_id !== 'string' || !op.relationship_agent_id.trim())) {
                throw new Error(`Invalid agent-turn schema: memory_operations/${index} relationship addition requires a nonempty relationship_agent_id from the participant directory`);
            }
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
