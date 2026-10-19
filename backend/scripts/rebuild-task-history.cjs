// Rebuild only derived task-history indexes. Original run files are never changed.
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {JsonlStorage}=require('../dist/storage/JsonlStorage');
(async()=>{
 const logs=new JsonlStorage(process.env.RESEARCH_DIR||path.resolve(__dirname,'../../researcher'));
 const owner='history-rebuild-'+randomUUID();await logs.acquireWriter(owner);
 try{for(const runId of process.argv[2]?[process.argv[2]]:await logs.listRuns())console.log(JSON.stringify(await logs.rebuildTaskHistory(runId,owner)));}
 finally{await logs.releaseWriter(owner);}
})().catch(error=>{console.error('Task history rebuild failed: '+error.message);process.exitCode=1;});
