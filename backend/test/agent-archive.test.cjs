const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const express=require('express');
const http=require('node:http');
const {fixture,until}=require('./helpers.cjs');
const {createAgentsRouter}=require('../dist/api/agents');
const {JsonStorage}=require('../dist/storage/JsonStorage');
const reply=()=>JSON.stringify({response:'Unchanged speech',memory_operations:[]});
async function api(t,f){const app=express();app.use(express.json());app.use('/agents',createAgentsRouter(f.storage,f.controller,f.logs));const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}/agents`;}
async function bytes(dir){const result={};for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isFile())result[entry.name]=await fs.readFile(path.join(dir,entry.name),'utf8');}return result;}

test('archive endpoint persists visibility across restarts without changing identity, memories, relationships or operational state',async t=>{
 const f=await fixture(t,reply),state=await f.storage.loadWorkingState('bob');state.entries.push({id:'relationship-sara',type:'relationship',content:'A remembered relationship',relationship_agent_id:'sara',confidence:.5,status:'active',source:null,updated_source:null,created_at:null,updated_at:null});await f.storage.saveWorkingState('bob',state);const dir=path.join(f.root,'agents/agents/bob'),before=await bytes(dir),base=await api(t,f);
 const result=await fetch(base+'/bob/archive',{method:'POST'});assert.equal(result.status,200);assert.equal((await result.json()).archived,true);const after=await bytes(dir);for(const [name,content]of Object.entries(before))assert.equal(after[name],content);assert.deepEqual(JSON.parse(after['visibility.json']),{archived:true});
 assert.deepEqual((await (await fetch(base)).json()).map(a=>a.id),['sara']);const details=await (await fetch(base+'/bob')).json();assert.equal(details.identity.archived,true);assert.deepEqual(details.state,state);assert.ok(details.state.entries.some(e=>e.relationship_agent_id==='sara'));
 const fresh=new JsonStorage(path.join(f.root,'agents'));assert.deepEqual(await fresh.listAgents(),['sara']);assert.deepEqual((await fresh.listAgents({includeArchived:true})).sort(),['bob','sara']);assert.equal((await fresh.loadAgentIdentity('bob')).name,'bob');
 // An old snapshot or turn projection cannot restore visibility.
 await fresh.saveWorkingState('bob',state);assert.deepEqual(await fresh.listAgents(),['sara']);
});

test('agents lacking archived metadata remain available and are not migrated by listing',async t=>{const f=await fixture(t,reply),dir=path.join(f.root,'agents/agents/bob'),before=await bytes(dir);assert.deepEqual((await f.storage.listAgents()).sort(),['bob','sara']);assert.deepEqual(await bytes(dir),before);assert.equal((await f.storage.loadAgentIdentity('bob')).archived??false,false);});

test('running/paused participants cannot be archived; unselected agents can be hidden safely',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,async()=>{await gate;return reply();},['bob','sara','unused']),base=await api(t,f);await f.controller.start({...f.config,maxTurns:3});await until(()=>f.stats().requests===1);let response=await fetch(base+'/bob/archive',{method:'POST'});assert.equal(response.status,409);assert.match((await response.json()).error,/active experiment/);assert.equal((await f.storage.loadAgentIdentity('bob')).archived,undefined);assert.equal(f.controller.getStatus(),'running');
 response=await fetch(base+'/unused/archive',{method:'POST'});assert.equal(response.status,200);assert.equal(f.controller.getStatus(),'running');const pause=f.controller.pause();release();await pause;assert.equal((await fetch(base+'/bob/archive',{method:'POST'})).status,409);assert.deepEqual(f.controller.getConfig().agentIds,['bob','sara']);await f.controller.stop();assert.equal((await fetch(base+'/bob/archive',{method:'POST'})).status,200);
});

test('archived IDs cannot start new experiments but remain resolvable in completed historical runs',async t=>{const f=await fixture(t,reply);await f.controller.start({...f.config,maxTurns:1});await until(()=>f.controller.getStatus()==='completed');await f.controller.activePromise;await f.controller.stop();const cfg=await f.logs.loadConfig(f.config.runId),history=await f.logs.getConversationHistory(f.config.runId);await f.controller.archiveAgent('bob');const base=await api(t,f);assert.equal((await fetch(base+'/bob')).status,200);assert.deepEqual((await f.logs.loadConfig(f.config.runId)).agentIds,['bob','sara']);assert.deepEqual(await f.logs.getConversationHistory(f.config.runId),history);
 await assert.rejects(f.controller.start({...f.config,runId:'new-run',maxTurns:1}),/Archived agent bob/);assert.equal(await f.logs.loadConfig('new-run'),null);await f.controller.start(cfg);assert.equal(f.controller.getStatus(),'completed');
});

test('missing agent and persistence errors do not falsely confirm archive',async t=>{const f=await fixture(t,reply),base=await api(t,f);assert.equal((await fetch(base+'/missing/archive',{method:'POST'})).status,404);const original=f.storage.setArchived.bind(f.storage);f.storage.setArchived=async()=>{throw new Error('Disk is unavailable');};const result=await fetch(base+'/bob/archive',{method:'POST'});assert.equal(result.status,409);assert.match((await result.json()).error,/Disk/);assert.equal((await f.storage.listAgents()).includes('bob'),true);f.storage.setArchived=original;});

test('archiving is idempotent and only explicit restore metadata can show the agent again',async t=>{const f=await fixture(t,reply);await f.controller.archiveAgent('bob');await f.controller.archiveAgent('bob');assert.deepEqual(await f.storage.listAgents(),['sara']);await f.storage.setArchived('bob',false);assert.deepEqual((await f.storage.listAgents()).sort(),['bob','sara']);});
