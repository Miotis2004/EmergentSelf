const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');

async function subscribe(base) {
  const abort = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: abort.signal });
  const reader = res.body.getReader();
  const events = [];
  let buffer = '';
  const done = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const type = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (type && data) events.push({ type, data: JSON.parse(data) });
        }
      }
    } catch (error) { if (!abort.signal.aborted) throw error; }
  })();
  return { events, close: async () => { abort.abort(); await done; } };
}
async function until(fn) {
  const deadline = Date.now() + 10000;
  while (!fn()) {
    if (Date.now() > deadline) throw Error('SSE event timeout');
    await new Promise(r => setTimeout(r, 5));
  }
}

test('HTTP endpoints: independent SSE subscribers, inline error data, retry, and reconnect history', async t => {
  const previous = process.cwd();
  const root = await fs.mkdtemp(path.join(tmpdir(), 'emergent-sse-'));
  await fs.mkdir(path.join(root, 'backend'));
  process.chdir(path.join(root, 'backend'));
  const { app, controller } = require('../dist/index');
  const api = http.createServer(app);
  await new Promise(r => api.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${api.address().port}`;
  let requests = 0;
  const prompts = [];
  const model = http.createServer(async (req, res) => {
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'local-model' }] }));
    let raw = ''; for await (const chunk of req) raw += chunk;
    prompts.push(JSON.parse(raw));
    const n = requests++;
    const content = n === 1 ? 'not JSON' : JSON.stringify({ response: `Original text ${n}`, memory_operations: [] });
    res.end(JSON.stringify({ model: 'local-model', choices: [{ finish_reason: 'stop', message: { content } }] }));
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  const clients = [];
  t.after(async () => {
    for (const c of clients) await c.close();
    await controller.stop();
    await Promise.all([new Promise(r => api.close(r)), new Promise(r => model.close(r))]);
    process.chdir(previous);
    await fs.rm(root, { recursive: true, force: true });
  });
  const post = async (url, value = {}) => {
    const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    assert.ok(res.ok, await res.clone().text()); return res.json();
  };
  for (const id of ['bob', 'sara']) await post('/api/agents', { id, name: id, stats: { curiosity: { initial: 5, current: 5 } } });
  const a = await subscribe(base), b = await subscribe(base);
  clients.push(a, b);
  await until(() => a.events.some(e => e.type === 'snapshot') && b.events.some(e => e.type === 'snapshot'));
  await a.close(); // Must not unregister b.
  const llmBase = `http://127.0.0.1:${model.address().port}/v1`;
  const discovered = await (await fetch(`${base}/api/llm/models?baseUrl=${encodeURIComponent(llmBase)}`)).json();
  assert.deepEqual(discovered, [{ id: 'local-model' }]);
  await post('/api/experiment/start', { decisionConfig:{version:1,mode:'unrestricted',availableModes:['idle']},recoveryConfig:{enabled:false},runId: 'sse-run', initialTopic: '  Starting topic  ', agentIds: ['bob','sara'], maxTurns: 3, llmConfig: { baseUrl: llmBase, model: 'local-model' } });
  await until(() => b.events.some(e => e.type === 'status_changed' && e.data.status === 'paused'));
  assert.equal(b.events.filter(e => e.type === 'turn_completed').length, 1);
  const error = b.events.find(e => e.type === 'experiment_error').data;
  assert.match(error.message, /Invalid JSON/);
  const state = await (await fetch(base + '/api/experiment/status')).json();
  assert.equal(state.activeAgentId, null);
  assert.equal(state.currentTurnIndex, 1);
  await post('/api/experiment/resume');
  await until(() => b.events.some(e => e.type === 'status_changed' && e.data.status === 'completed'));
  assert.deepEqual(b.events.filter(e => e.type === 'turn_completed').map(e => e.data.turnRecord.turnIndex), [0,1,2]);
  const c = await subscribe(base); clients.push(c);
  await until(() => c.events.some(e => e.type === 'snapshot'));
  const snapshot = c.events.find(e => e.type === 'snapshot').data;
  assert.equal(snapshot.turns.length, 3);
  assert.equal(snapshot.events.filter(e => e.type === 'memory_update').length, 3);
  assert.equal(snapshot.events.filter(e => e.type === 'experiment_error').length, 1);
  assert.equal(snapshot.config.llmConfig.model, 'local-model');
  const memory = await (await fetch(`${base}/api/experiment/runs/sse-run/agents/bob/memory?turn=2&compareTo=-1`)).json();
  assert.equal(memory.state.schemaVersion, 2);
  assert.equal(memory.turnIndex, 2);
  assert.equal(memory.baselineTurn, -1);
  assert.equal(memory.timeline.length, 2);
  assert.deepEqual(memory.diff.added, []);
  assert.equal((await fetch(`${base}/api/experiment/runs/sse-run/agents/outsider/memory`)).status, 400);
  assert.equal((await fetch(`${base}/api/experiment/runs/sse-run/agents/bob/memory?turn=bad`)).status, 400);
  assert.equal((await fetch(`${base}/api/experiment/runs/legacy/agents/bob/memory`)).status, 404);
  assert.equal(snapshot.config.initialTopic, 'Starting topic');
  assert.deepEqual(snapshot.config.agentIds, ['bob','sara']);
  assert.equal(prompts[0].messages[1].content, 'Starting topic');
  for (const prompt of prompts.slice(1)) assert.ok(!prompt.messages.some(message => message.content === 'Starting topic'));
  const callResearch=async(path,body)=>{
    const response=await fetch(base+'/api/research'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    assert.ok(response.ok,await response.clone().text());return response.json();
  };
  assert.ok((await callResearch('/defaults')).systemPrompt.includes('{attributes}'));
  await callResearch('/templates',{templateId:'http-template',configuration:{decisionConfig:{version:1,mode:'unrestricted',availableModes:['idle']},runId:'draft',agentIds:['bob','sara'],maxTurns:1,llmConfig:{baseUrl:llmBase,model:'local-model',modelVersion:'unverified'}}});
  const manifest=await callResearch('/batches',{batchId:'http-batch',templateId:'http-template',repeats:1,conditions:['enabled','history'],randomizationSeed:1});
  for(const trial of manifest.trials){await callResearch('/batches/http-batch/start',{runId:trial.runId});await until(()=>controller.getStatus()==='completed');}
  const comparison=await callResearch(`/compare?left=${manifest.trials[0].runId}&right=${manifest.trials[1].runId}`);
  assert.ok(comparison.differences.some(d=>d.path==='memoryConfig.mode'));
  const exported=await callResearch(`/runs/${manifest.trials[0].runId}/export`);
  assert.equal(exported.schemaVersion,3);assert.equal(exported.turns.length,1);assert.ok(exported.integrityHash);
  const duplicate=await fetch(base+'/api/research/batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({batchId:'http-batch',templateId:'http-template',repeats:1,conditions:['enabled'],randomizationSeed:1})});
  assert.equal(duplicate.status,409);
  await post('/api/experiment/start',{decisionConfig:{version:1,mode:'unrestricted',availableModes:['idle']},runId:'direct-protocol',agentIds:['bob','sara'],maxTurns:1,memoryConfig:{mode:'history'},llmConfig:{baseUrl:llmBase,model:'local-model',modelVersion:'unverified'},protocol:{condition:'history',systemPrompt:'Direct fixed prompt {attributes}',turnPrompt:'Direct turn {name}'}});
  await until(()=>controller.getStatus()==='completed');
  const directExport=await callResearch('/runs/direct-protocol/export');
  assert.equal(directExport.config.protocol.condition,'history');
  assert.ok(directExport.turns[0].prompt.system.startsWith('Direct fixed prompt'));


});
