const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { JsonStorage } = require('../dist/storage/JsonStorage');
const { JsonlStorage } = require('../dist/storage/JsonlStorage');
const { LlmAdapter } = require('../dist/llm/LlmAdapter');
const { ExperimentController } = require('../dist/experiments/ExperimentController');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (!predicate()) { if (Date.now() > deadline) throw Error('Timed out waiting for controller'); await sleep(5); }
}
async function fixture(t, reply, agentIds = ['bob', 'sara']) {
  const root = await mkdtemp(path.join(tmpdir(), 'emergent-test-'));
  const storage = new JsonStorage(path.join(root, 'agents'));
  const logs = new JsonlStorage(path.join(root, 'research'));
  for (const id of agentIds) {
    await storage.saveAgentIdentity(id, { id, name: id, stats: { curiosity: { initial: 2, current: 2 } }, memories: [], beliefs: [] });
  }
  let requests = 0, concurrent = 0, maximum = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'real-loaded-id' }] })); return; }
    let raw = ''; for await (const part of req) raw += part;
    concurrent++; maximum = Math.max(maximum, concurrent);
    const n = requests++;
    const content = await reply(n, JSON.parse(raw));
    concurrent--;
    if(content&&typeof content==='object'){res.statusCode=content.status??503;res.end(JSON.stringify(content.body??{error:'temporarily unavailable'}));return;}
    res.end(JSON.stringify({ model: 'real-loaded-id', choices: [{ finish_reason: 'stop', message: { content } }] }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const controllers = [];
  const createController = () => {
    const controller = new ExperimentController(storage, logs, new LlmAdapter());
    controllers.push(controller);
    return controller;
  };
  const controller = createController();
  t.after(async () => { for (const c of controllers) await c.stop(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); });
  const config = { decisionConfig:{version:1,mode:'unrestricted',availableModes:['plan','observe','act','idle','change_location','communicate','reflect']}, recoveryConfig:{enabled:false}, runId: 'test-run', agentIds: ['bob', 'sara'], maxTurns: 100, llmConfig: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: '' } };
  return { root, controller, createController, storage, logs, config, modelServer:server, stats: () => ({ requests, maximum }) };
}

module.exports = { fixture, until, sleep };
