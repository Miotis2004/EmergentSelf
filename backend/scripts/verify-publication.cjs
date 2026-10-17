const fs=require('node:fs/promises');
const path=require('node:path');
const {verifyPublication}=require('../dist/publication/package');
const {captureCode}=require('../dist/publication/provenance');
(async()=>{
 const args=process.argv.slice(2);let recompute=false,extract;
 if(!args[0])throw Error('Usage: npm run verify-publication -- PACKAGE.json [--recompute] [--extract-code NEW_DIRECTORY]');
 for(let i=1;i<args.length;i++){if(args[i]==='--recompute')recompute=true;else if(args[i]==='--extract-code'&&args[i+1])extract=args[++i];else throw Error('Unknown option or missing value');}
 const bundle=JSON.parse(await fs.readFile(args[0],'utf8')),code=recompute?await captureCode():null;
 const result=verifyPublication(bundle,recompute,code?.codeHash);
 if(extract){
  if(bundle.profile!=='private')throw Error('Aggregate packages have no code archive');
  await fs.mkdir(extract); // New directory only: never overwrite a researcher workspace.
  for(const [name,contents] of Object.entries(bundle.code)){
   const target=path.join(extract,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,contents,{flag:'wx'});
  }
 }
 process.stdout.write(JSON.stringify({...result,...(extract?{sourceExtracted:true}:{})})+'\n');
})().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
