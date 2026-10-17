const fs=require('node:fs/promises');
const path=require('node:path');
const {analyzeBundles}=require('../dist/analysis/analyze');
(async()=>{
 const inputs=[],options={};let output,csv;
 const args=process.argv.slice(2);
 for(let i=0;i<args.length;i++){
  const value=args[i];
  if(['--output','--csv','--window','--seed','--bootstrap'].includes(value)){
   if(!args[i+1])throw Error(`Missing value for ${value}`);
   const next=args[++i];if(value==='--output')output=next;else if(value==='--csv')csv=next;else options[value==='--window'?'windowSize':value==='--bootstrap'?'bootstrapSamples':'seed']=Number(next);
  }else if(value.startsWith('--'))throw Error(`Unknown option ${value}`);else inputs.push(value);
 }
 if(!inputs.length)throw Error('Usage: npm run analyze -- run-a.json run-b.json --output report.json [--csv observations.csv] [--window 20] [--seed 42] [--bootstrap 500]');
 for(const target of [output,csv].filter(Boolean))if(inputs.some(input=>path.resolve(input)===path.resolve(target)))throw Error('Analysis output cannot replace an input export');
 if(output&&csv&&path.resolve(output)===path.resolve(csv))throw Error('JSON and CSV outputs must use distinct files');
 const report=analyzeBundles(await Promise.all(inputs.map(async file=>JSON.parse(await fs.readFile(file,'utf8')))),options);
 if(output)await fs.writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});else process.stdout.write(JSON.stringify(report,null,2)+'\n');
 if(csv){
  const keys=report.definitions.map(metric=>metric.id),quote=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
  const rows=[['runId','agentId','stream','recordId','turnIndex','condition','status',...keys],...report.observations.map(row=>[row.source.runId,row.source.agentId,row.source.stream,row.source.recordId,row.source.turnIndex,row.condition,row.status,...keys.map(key=>row.values[key])])];
  await fs.writeFile(csv,rows.map(row=>row.map(quote).join(',')).join('\n')+'\n',{flag:'wx'});
 }
})().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
