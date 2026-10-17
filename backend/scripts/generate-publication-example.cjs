const fs=require('node:fs/promises');
const path=require('node:path');
const {syntheticExample}=require('../dist/publication/example');
(async()=>{
 const args=process.argv.slice(2);if(args.some(arg=>arg!=='--check'))throw Error('Usage: npm run example:publication -- [--check]');
 const root=path.resolve(__dirname,'../../examples/phase-vii'),example=syntheticExample();
 const files={'study.json':example.study,'expected-synthesis.json':example.synthesis,...Object.fromEntries(example.bundles.map(b=>[`${b.runId}.json`,b]))};
 if(!args.includes('--check'))await fs.mkdir(root,{recursive:true});
 for(const [name,value] of Object.entries(files)){
  const contents=JSON.stringify(value,null,2)+'\n',file=path.join(root,name);
  if(args.includes('--check')){if(await fs.readFile(file,'utf8')!==contents)throw Error(`Example differs: ${name}`);}else await fs.writeFile(file,contents,{flag:'wx'});
 }
 process.stdout.write(args.includes('--check')?'Synthetic example reproduces exactly.\n':'Synthetic example created without inference.\n');
})().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
