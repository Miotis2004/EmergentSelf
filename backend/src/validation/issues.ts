/** Structured diagnostics contain constraints/paths, never private transcript content. */
export interface TurnViolation {code:string;path:string;message:string}
export function uniqueViolations(issues:TurnViolation[]):TurnViolation[]{
    return issues.filter((issue,index)=>issues.findIndex(other=>other.code===issue.code&&other.path===issue.path&&other.message===issue.message)===index);
}
export class TurnSchemaError extends Error {
    constructor(message:string,public readonly violations:TurnViolation[]){super(message);}
}
