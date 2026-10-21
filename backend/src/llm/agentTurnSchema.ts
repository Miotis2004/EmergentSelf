import {queryOperationsSchema,subjectSchema,topicsSchema} from '../memory/querySchema';
import {TurnSchemaError,uniqueViolations} from '../validation/issues';
import type {TurnViolation} from '../validation/issues';
import {structuralViolations} from '../interaction/execution';
import type {ExecutionContext} from '../interaction/execution';
import {decisionSchema,communicationSchema,channelSchema} from '../interaction/policy';
import {worldOperationsSchema} from '../world/simulation';
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
export function responseSchema(social = false, task = false, operational = false, world = false, decision = false, channels = false, execution?:ExecutionContext) {
    if(world&&!operational)throw new Error('World output requires operational capability');
    if (task && !social) throw new Error('Task output requires social capability');
    const schema = social ? (task ? socialTurnSchema : socialOnlySchema) : agentTurnSchema;
    let base:any = operational ? withOperational(schema) : schema;
    if(decision)base={...base,properties:{...base.properties,decision:execution?{...decisionSchema,properties:{...decisionSchema.properties,mode:{enum:execution.availableModes}}}:decisionSchema},required:[...base.required,"decision"]};
    if(channels)base={...base,properties:{...base.properties,communication:execution?.communication?channelSchema(['private','team','local','global'].filter(scope=>(execution.communication as any)['allow'+scope[0].toUpperCase()+scope.slice(1)+'Messages']),execution.participantIds.filter(id=>id!==execution.agentId)):communicationSchema},required:[...base.required,"communication"]};
    const worldSchema=execution?{...worldOperationsSchema,items:{anyOf:worldOperationsSchema.items.anyOf.filter(schema=>schema.properties.action.enum.some((action:string)=>execution.worldActions.includes(action)))}}:worldOperationsSchema;
    if(execution?.memoryQueries)base={...base,properties:{...base.properties,memory_operations:{...agentTurnSchema.properties.memory_operations,items:{anyOf:memoryOperationSchema.anyOf.map(variant=>({...variant,properties:{...variant.properties,subjects:subjectSchema,topics:topicsSchema}}))}},retrieval_operations:queryOperationsSchema(execution.memoryQueries.conversation,execution.memoryQueries.memory!==false)}};
    return world ? {...base,properties:{...base.properties,world_operations:worldSchema},required:[...base.required,'world_operations']} : base;
}
/**
 * llama.cpp expands bounded repetitions while compiling a schema into grammar.
 * char{0,8000}-style strings and bounded operation arrays can exceed expansion
 * guards. Unbounded JSON strings/arrays avoid these large finite repetitions;
 * the backend still checks every limit. Tiny array bounds (0–2) remain
 * in the decoder to enforce empty audiences and at most two operational changes.
 * All structure, required fields, enums, minima and numeric constraints are retained.
 */
export const INFERENCE_SCHEMA_VERSION = 'llama-small-bounds-v2';
export function inferenceResponseSchema(social = false, task = false, operational = false, world = false, decision = false, channels = false, execution?:ExecutionContext) {
    function project(value:any):any {
        if(Array.isArray(value))return value.map(project);
        if(value && typeof value === 'object')return Object.fromEntries(Object.entries(value)
            .filter(([key,child])=>key !== 'maxLength' && (key !== 'maxItems' || typeof child==='number' && child<=2))
            .map(([key,child])=>[key,project(child)]));
        return value;
    }
    return project(responseSchema(social,task,operational,world,decision,channels,execution));
}

const ajv = new Ajv({ strict: false, strictNumbers: true, allErrors:true });
const validators = new Map<string,ReturnType<typeof ajv.compile>>();

export function validateAgentTurn(value: unknown, social = false, task = false, operational = false, world = false, decision = false, channels = false, execution?:ExecutionContext): asserts value is import('./LlmAdapter').AgentTurnResponse {
    const key=JSON.stringify([social,task,operational,world,decision,channels,execution?.availableModes,execution?.communication,execution?.participantIds,execution?.agentId,execution?.worldActions,execution?.memoryQueries]);
    if(!validators.has(key))validators.set(key,ajv.compile(responseSchema(social,task,operational,world,decision,channels,execution)));
    const validate=validators.get(key)!;
    if (!validate(value)) {
        // Explain reference-shape errors without exposing memory content in diagnostics.
        const issues=structuralViolations(value,operational,channels);
        const schemaIssues:TurnViolation[]=(validate.errors??[]).filter(e=>!issues.some(issue=>e.instancePath.startsWith(issue.path.split('/').slice(0,2).join('/')))).map(e=>({code:'INVALID_STRUCTURED_OUTPUT',path:e.instancePath||'/',message:'Schema constraint '+e.keyword+' failed'+(e.keyword==='required'?' (missing '+e.params.missingProperty+')':'')+'.'}));
        const reject=(message:string):never=>{throw new TurnSchemaError(message,uniqueViolations([...issues,...schemaIssues]));};
        const operations = (value as any)?.memory_operations;
        if (Array.isArray(operations)) for (const [index, op] of operations.entries()) {
            if (op?.action === 'add' && op?.type === 'relationship' && (typeof op.relationship_agent_id !== 'string' || !op.relationship_agent_id.trim())) {
                reject(`Invalid agent-turn schema: memory_operations/${index} relationship addition requires a nonempty relationship_agent_id from the participant directory`);
            }
            if (['update','retire','contradict'].includes(op?.action) && (typeof op.target_id !== 'string' || !op.target_id.trim())) {
                reject(`Invalid agent-turn schema: memory_operations/${index} missing target_id; revision requires an exact existing active target ID`);
            }
            if (op?.action === 'consolidate' && (!Array.isArray(op.target_ids) || op.target_ids.length < 2 || op.target_ids.some((id:unknown)=>typeof id !== 'string' || !id.trim()) || new Set(op.target_ids).size !== op.target_ids.length)) {
                reject(`Invalid agent-turn schema: memory_operations/${index} consolidation requires at least two distinct nonempty target_ids`);
            }
        }
        // Paths and validator keywords are safe; never include model-generated values.
        reject(`Invalid agent-turn schema: ${validate.errors?.map(e => `${e.instancePath || '/'} ${e.keyword}`).join(', ')}`);
    }
}
