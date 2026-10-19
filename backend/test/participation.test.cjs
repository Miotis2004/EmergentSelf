const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture, until } = require('./helpers.cjs');
const { resolveLlmConfig } = require('../dist/llm/LlmAdapter');

const validTurn = () => JSON.stringify({ response: 'Original model words.', memory_operations: [
  { action: 'add', type: 'memory', content: 'A new observation', reason: 'Observed during the turn' },
  { action: 'update', type: 'stat', target_id: 'curiosity', content: 7, reason: 'A proposed change' }
] });
async function bytes(dir) {
  const files = {};
  async function visit(current) {
    for (const item of await fs.readdir(current, { withFileTypes: true })) {
      const file = path.join(current, item.name);
      if (item.isDirectory()) await visit(file);
      else files[path.relative(dir, file)] = await fs.readFile(file, 'utf8');
    }
  }
  await visit(dir); return files;
}

test('two selected agents exclude other agents from turns and all state/memory writes', async t => {
  const f = await fixture(t, validTurn, ['bob','sara','unchecked','also-unchecked']);
  await f.storage.saveAgentMemory('unchecked', [{ id: 'keep', content: 'Existing private memory' }]);
  await f.storage.saveAgentBeliefs('unchecked', [{ id: 'belief', content: 'Unchanged belief' }]);
  const before = await bytes(path.join(f.root, 'agents/agents'));
  f.config.maxTurns = 6;
  await f.controller.start(f.config);
  await until(() => f.controller.getStatus() === 'completed');
  const turns = await f.logs.getConversationHistory(f.config.runId);
  assert.deepEqual(turns.map(turn => turn.agentId), ['bob','sara','bob','sara','bob','sara']);
  const after = await bytes(path.join(f.root, 'agents/agents'));
  assert.ok(Object.keys(before).some(file => file.startsWith('unchecked/')));
  for (const file of Object.keys(before).filter(file => file.startsWith('unchecked/') || file.startsWith('also-unchecked/'))) {
    assert.equal(after[file], before[file]);
  }
  assert.deepEqual(Object.keys(after).filter(file => file.startsWith('also-unchecked/')), ['also-unchecked/identity.json']);
  assert.equal((await f.storage.loadAgentMemory('bob')).length, 3);
  assert.deepEqual((await f.logs.loadConfig(f.config.runId)).agentIds, ['bob','sara']);
});

test('three participants retain supplied order and sequential inference; caller changes cannot alter active settings', async t => {
  const f = await fixture(t, validTurn, ['bob','sara','alex','unchecked']);
  f.config.agentIds = ['sara','alex','bob']; f.config.maxTurns = 9;
  const start = f.controller.start(f.config);
  f.config.agentIds.splice(0, 3, 'unchecked','sara');
  f.config.initialTopic = 'Must never enter the active run';
  await start;
  const exposed = f.controller.getConfig(); exposed.agentIds[0] = 'unchecked';
  await until(() => f.controller.getStatus() === 'completed');
  assert.deepEqual((await f.logs.getConversationHistory('test-run')).map(t => t.agentId), ['sara','alex','bob','sara','alex','bob','sara','alex','bob']);
  assert.deepEqual(f.controller.getConfig().agentIds, ['sara','alex','bob']);
  assert.equal(f.controller.getConfig().initialTopic, '');
  assert.equal(f.stats().maximum, 1);
});

test('rejects too few, duplicate, missing and unsafe participant IDs without research writes', async t => {
  const f = await fixture(t, validTurn);
  for (const ids of [[],['bob'],['bob','bob'],['bob','unknown'],['bob','../sara'],['bob',3]]) {
    await assert.rejects(f.controller.start({ ...f.config, agentIds: ids }), /Invalid|missing/);
    assert.equal(await f.logs.loadConfig('test-run'), null);
  }
  assert.equal(f.stats().requests, 0);
  assert.equal(f.controller.getStatus(), 'idle');
});

test('trimmed topic is a user stimulus on turn zero only; neutral system prompts stay unchanged', async t => {
  const requests = [];
  const f = await fixture(t, (n, payload) => { requests.push(payload); return validTurn(); });
  f.config.maxTurns = 3; f.config.initialTopic = ' \nWhat makes someone trustworthy?\n ';
  await f.controller.start(f.config);
  await until(() => f.controller.getStatus() === 'completed');
  const topic = 'What makes someone trustworthy?';
  assert.equal((await f.logs.loadConfig('test-run')).initialTopic, topic);
  assert.deepEqual(requests[0].messages.slice(1, -1), [
    { role: 'user', content: topic }
  ]);
  for (const request of requests) {
    assert.ok(!request.messages[0].content.includes(topic));
    assert.ok(request.messages[0].content.startsWith('You are an agent with the following identity:'));
  }
  for (const request of requests.slice(1)) {
    assert.equal(request.messages.length, 3);
    assert.ok(!request.messages.some(message => message.content.includes(topic)));
  }
});

test('empty, whitespace-only and absent topics keep the original open-ended messages', async t => {
  const requests = [];
  const f = await fixture(t, (n, payload) => { requests.push(payload); return validTurn(); });
  for (const [i, initialTopic] of [undefined, '', ' \n\t '].entries()) {
    await f.controller.start({ ...f.config, runId: `empty-${i}`, maxTurns: 1, initialTopic });
    await until(() => f.controller.getStatus() === 'completed');
    assert.equal(requests[i].messages.length, 3);
    assert.deepEqual(requests[i].messages[1], { role: 'user', content: 'It is your turn to speak, bob.' });
    assert.equal((await f.logs.loadConfig(`empty-${i}`)).initialTopic, '');
    await f.controller.stop();
  }
});

test('rejects invalid topics before creating configuration; permits the trimmed 8000-character boundary', async t => {
  const f = await fixture(t, validTurn);
  for (const initialTopic of [null, 7, {}, 'x'.repeat(8001)]) {
    await assert.rejects(f.controller.start({ ...f.config, initialTopic }), /Conversation topic/);
    assert.equal(await f.logs.loadConfig('test-run'), null);
  }
  await f.controller.start({ ...f.config, maxTurns: 1, initialTopic: ` ${'x'.repeat(8000)} ` });
  await until(() => f.controller.getStatus() === 'completed');
  assert.equal(f.controller.getConfig().initialTopic.length, 8000);
});

test('pause, resume and a fresh controller preserve participants, topic, original config bytes and append-only history', async t => {
  const requests = [];
  let first = true;
  const f = await fixture(t, (n, payload) => {
    requests.push(payload);
    if (first) { first = false; return 'invalid JSON'; }
    return validTurn();
  }, ['bob','sara','alex','unchecked']);
  f.config.agentIds = ['sara','alex','bob']; f.config.maxTurns = 4; f.config.initialTopic = 'What makes someone trustworthy?';
  await f.controller.start(f.config);
  await until(() => f.controller.getStatus() === 'paused');
  const configFile = path.join(f.root, 'research/experiments/test-run/config.json');
  const originalConfig = await fs.readFile(configFile, 'utf8');
  await assert.rejects(f.controller.start({ ...f.config, agentIds: ['bob','sara'] }), /current experiment/);
  let paused;
  const off = f.controller.onEvent((type) => {
    if (type === 'turn_completed' && !paused) paused = f.controller.pause();
  });
  await f.controller.resume();
  await until(() => !!paused); await paused; off();
  assert.equal(f.controller.getStatus(), 'paused');
  assert.equal(f.controller.getTurnIndex(), 1);
  assert.equal(f.controller.getConfig().initialTopic, f.config.initialTopic);
  await f.controller.stop();
  const before = await bytes(path.join(f.root, 'research'));
  const restarted = f.createController();
  await assert.rejects(restarted.start({ ...f.config, initialTopic: 'A replacement topic' }), /different metadata/);
  await assert.rejects(restarted.start({ ...f.config, agentIds: ['alex','sara','bob'] }), /different metadata/);
  assert.deepEqual(await bytes(path.join(f.root, 'research')), before);
  await restarted.start(f.config);
  await until(() => restarted.getStatus() === 'completed');
  const after = await bytes(path.join(f.root, 'research'));
  assert.equal(await fs.readFile(configFile, 'utf8'), originalConfig);
  for (const file of Object.keys(before)) assert.ok(after[file].startsWith(before[file]), `${file} was not append-only`);
  assert.deepEqual((await f.logs.getConversationHistory('test-run')).map(t => t.agentId), ['sara','alex','bob','sara']);
  // The failed turn-zero attempt and retry receive the topic; resumed later turns do not.
  assert.ok(requests[0].messages.some(m => m.content === f.config.initialTopic));
  assert.ok(requests[1].messages.some(m => m.content === f.config.initialTopic));
  for (const request of requests.slice(2)) assert.ok(!request.messages.some(m => m.content === f.config.initialTopic));
  assert.equal(f.stats().maximum, 1);
});

test('legacy missing-topic config and completed research files are viewed without rewriting any bytes', async t => {
  const f = await fixture(t, validTurn);
  const oldConfig = { ...f.config, maxTurns: 1, llmConfig: resolveLlmConfig({ ...f.config.llmConfig, model: 'real-loaded-id' }) };
  await f.logs.saveConfig('test-run', oldConfig);
  await f.logs.appendConversationTurn('test-run', { turnIndex: 0, agentId: 'bob', response: 'Existing experimental text' });
  await f.logs.appendEvent('test-run', { type: 'memory_update', turnIndex: 0, operations: [] });
  const before = await bytes(f.root);
  await f.controller.start({ ...oldConfig, initialTopic: '' });
  assert.equal(f.controller.getStatus(), 'completed');
  const snapshot = await f.controller.getSnapshot();
  assert.equal(snapshot.config.initialTopic, '');
  assert.deepEqual(snapshot.config.agentIds, ['bob','sara']);
  assert.equal(snapshot.turns[0].response, 'Existing experimental text');
  assert.deepEqual(await bytes(f.root), before);
  assert.equal(f.stats().requests, 0);
  await assert.rejects(f.logs.saveConfig('test-run', { ...oldConfig, initialTopic: 'overwrite' }), /EEXIST/);
  assert.deepEqual(await bytes(f.root), before);
});

test('orphaned logs cannot be adopted or overwritten by a new experiment', async t => {
  const f = await fixture(t, validTurn);
  await f.logs.appendConversationTurn('test-run', { turnIndex: 0, response: 'Preserve me' });
  const before = await bytes(f.root);
  await assert.rejects(f.controller.start(f.config), /logs without configuration/);
  assert.deepEqual(await bytes(f.root), before);
});
