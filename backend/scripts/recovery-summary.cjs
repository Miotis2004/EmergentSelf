// Read-only counts and timing evidence. Never print proposals, conversations or memory.
function summarizeRecovery(records){
 const result={attemptEvents:0,rejectedCandidates:0,byCode:{},byCategory:{},violationAttempts:{},timeouts:{count:0,byPhase:{},timedCount:0,missingTimingCount:0,minElapsedMs:null,maxElapsedMs:null,meanElapsedMs:null}};
 const seen=new Set();let elapsedTotal=0;
 for(const record of records){
  if(!['recovery_attempt','experiment_error'].includes(record.type)||record.id&&seen.has(record.id))continue;
  if(record.id)seen.add(record.id);result.attemptEvents++;
  const code=record.code??'UNCLASSIFIED',category=record.category??'UNCLASSIFIED';
  result.byCode[code]=(result.byCode[code]??0)+1;result.byCategory[category]=(result.byCategory[category]??0)+1;
  if(record.stateCommitted===false&&['invalid_action','schema_validation'].includes(category))result.rejectedCandidates++;
  for(const issue of new Set((record.violations??[]).map(v=>v.code)))result.violationAttempts[issue]=(result.violationAttempts[issue]??0)+1;
  if(code!=='INFERENCE_TIMEOUT'&&category!=='inference_timeout')continue;
  const timeouts=result.timeouts,diagnostics=record.diagnostics??record.attempt?.diagnostics??{};timeouts.count++;
  const phase=diagnostics.failureStage??'unknown';timeouts.byPhase[phase]=(timeouts.byPhase[phase]??0)+1;
  if(Number.isFinite(diagnostics.elapsedMs)){timeouts.timedCount++;elapsedTotal+=diagnostics.elapsedMs;timeouts.minElapsedMs=Math.min(timeouts.minElapsedMs??Infinity,diagnostics.elapsedMs);timeouts.maxElapsedMs=Math.max(timeouts.maxElapsedMs??0,diagnostics.elapsedMs);}else timeouts.missingTimingCount++;
 }
 if(result.timeouts.timedCount)result.timeouts.meanElapsedMs=elapsedTotal/result.timeouts.timedCount;
 return result;
}
module.exports={summarizeRecovery};
if(require.main===module)(async()=>{
 const file=process.argv[2];if(!file||process.argv.length!==3)throw Error('Usage: node backend/scripts/recovery-summary.cjs /path/to/events.jsonl');
 const {createReadStream}=require('node:fs'),{createInterface}=require('node:readline');
 const lines=createInterface({input:createReadStream(file),crlfDelay:Infinity}),records=[];let lineNumber=0;
 for await(const line of lines){lineNumber++;if(!line.trim())continue;try{records.push(JSON.parse(line));}catch{throw Error('Invalid JSONL at line '+lineNumber+'; no data was modified');}}
 process.stdout.write(JSON.stringify(summarizeRecovery(records),null,2)+'\n');
})().catch(error=>{process.stderr.write(error.code==='ENOENT'?'Event file not found; no data was modified\n':error.message+'\n');process.exitCode=1;});
