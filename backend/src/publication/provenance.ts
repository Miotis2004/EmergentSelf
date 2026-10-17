import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { hash } from '../research/protocol';
export const sha256=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
export async function captureCode(){
 const root=path.resolve(__dirname,'../../..'),files:Record<string,string>={};
 const walk=async(relative:string)=>{
  for(const entry of (await fs.readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=`${relative}/${entry.name}`;
   if(entry.isDirectory())await walk(name);else if(entry.isFile()&&/\.(ts|cjs)$/.test(name))files[name]=await fs.readFile(path.join(root,name),'utf8');
  }
 };
 for(const dir of ['backend/src','backend/scripts','backend/test'])await walk(dir);
 for(const name of (await fs.readdir(path.join(root,'examples/phase-vii'))).filter(name=>name.endsWith('.json')).sort())files[`examples/phase-vii/${name}`]=await fs.readFile(path.join(root,'examples/phase-vii',name),'utf8');
 for(const file of ['backend/package.json','backend/package-lock.json','backend/tsconfig.json'])files[file]=await fs.readFile(path.join(root,file),'utf8');
 let revision='unavailable',dirty:boolean|null=null;
 try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();dirty=Boolean(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());}catch{}
 const fileHashes=Object.fromEntries(Object.entries(files).map(([name,contents])=>[name,sha256(contents)]));
 return {revision,dirty,nodeVersion:process.version,platform:process.platform,architecture:process.arch,fileHashes,codeHash:hash(fileHashes),files};
}
