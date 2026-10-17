const fs=require('node:fs/promises');
const path=require('node:path');
const {captureCode}=require('../dist/publication/provenance');
const {buildPublication}=require('../dist/publication/package');
(async()=>{
 const args=process.argv.slice(2),inputs=[];let studyFile,output,profile,publicationId='offline-publication';
 for(let i=0;i<args.length;i++){
  const arg=args[i];if(['--study','--output','--profile','--id'].includes(arg)){
   const value=args[++i];if(!value)throw Error(`Missing value for ${arg}`);
   if(arg==='--study')studyFile=value;else if(arg==='--output')output=value;else if(arg==='--profile')profile=value;else publicationId=value;
  }else if(arg.startsWith('--'))throw Error(`Unknown option ${arg}`);else inputs.push(arg);
 }
 if(!studyFile||!output||!profile)throw Error('Usage: npm run synthesize -- --study STUDY.json --profile private|aggregate --output NEW.json [exports.json ...]');
 if([studyFile,...inputs].some(file=>path.resolve(file)===path.resolve(output)))throw Error('Output cannot replace source data');
 const study=JSON.parse(await fs.readFile(studyFile,'utf8')),exports=await Promise.all(inputs.map(async file=>JSON.parse(await fs.readFile(file,'utf8'))));
 const bundle=buildPublication(study,exports,await captureCode(),{publicationId,profile,createdAt:new Date().toISOString()});
 await fs.writeFile(output,JSON.stringify(bundle,null,2)+'\n',{flag:'wx'});
 process.stdout.write(JSON.stringify({profile:bundle.profile,bundleHash:bundle.bundleHash})+'\n');
})().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
