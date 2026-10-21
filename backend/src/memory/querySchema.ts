// Shared structural definitions; no runtime controller or recovery dependencies.
const text={type:'string',minLength:1,maxLength:200};
const identifier={...text,pattern:'^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,199}$'};
const strings={type:'array',maxItems:20,uniqueItems:true,items:text};
export const subjectSchema={type:'array',maxItems:20,uniqueItems:true,items:{type:'object',additionalProperties:false,properties:{type:{enum:['agent','location','object','resource','task','project','entity']},id:identifier},required:['type','id']}};
export const topicsSchema=strings;
const queryObject=(properties:any,required:string[]=[])=>({type:'object',additionalProperties:false,properties,required});
const page={limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0,maximum:1000000}};
export function queryOperationsSchema(conversation:boolean,memory=true){
 const variants=[
    ...(memory?[queryObject({action:{enum:['query_memory']},query:queryObject({ownerAgentId:identifier,subjectAgentId:identifier,person:text,subjects:subjectSchema,topics:topicsSchema,types:{...strings,items:{enum:['episodic','belief','self_description','relationship']}},keyword:{type:'string',minLength:1,maxLength:500},...page})},['action','query'])]:[]),
    ...(conversation?[queryObject({action:{enum:['query_conversation']},query:queryObject({conversationId:text,contentOffset:{type:'integer',minimum:0,maximum:10000000},...page},['conversationId'])},['action','query'])]:[])
 ];
 return variants.length?{type:'array',maxItems:2,items:{anyOf:variants}}:{type:'array',maxItems:0};
}
