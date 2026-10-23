/** Shared error identity without loading the world engine during schema initialization. */
export class WorldError extends Error {constructor(message:string,public code?:string){super(message);}}
