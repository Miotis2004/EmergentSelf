const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryManager } = require('../dist/agents/MemoryManager');
const { fixture, until, sleep } = require('./helpers.cjs');

test('100 alternating turns with schema validation, exact text, audit events and one inference at a time', async t => {
  const f = await fixture(t, async n => JSON.stringify({ response: `Original turn ${n}\n  untouched.`, memory_operations: [{ action: 'add', type: 'memory', content: `Observed ${n}`, reason: 'test proposal' }] }));
  const first = [], second = [];
  const off = f.controller.onEvent((type, data) => first.push({ type, data }));
  f.controller.onEvent((type, data) => second.push({ type, data }));
  // A failed subscriber must not interrupt experiments or other subscribers.
  f.controller.onEvent(() => { throw Error('disconnected'); });
  await f.controller.start(f.config);
  await until(() => f.controller.getStatus() === 'completed');
  const history = await f.logs.getConversationHistory('test-run');
  assert.equal(history.length, 100);
  for (let n = 0; n < 100; n++) {
    assert.equal(history[n].turnIndex, n);
    assert.equal(history[n].agentId, n % 2 ? 'sara' : 'bob');
    assert.equal(history[n].response, `Original turn ${n}\n  untouched.`);
    assert.equal(history[n].auditTrail[0].status, 'success');
  }
  assert.equal(f.stats().maximum, 1);
  assert.equal(first.filter(e => e.type === 'turn_completed').length, 100);
  assert.equal(second.filter(e => e.type === 'turn_completed').length, 100);
  off(); const before = first.length;
  await f.controller.reset();
  assert.equal(first.length, before);
  assert.equal(second.at(-1).type, 'snapshot');
  const saved = await f.logs.loadConfig('test-run');
  assert.equal(saved.llmConfig.model, 'real-loaded-id');
  assert.equal(saved.llmConfig.outputMode, 'json_schema');
  assert.equal(saved.llmConfig.maxTokens, 2048);
});

test('invalid response pauses, clears thinking, logs diagnostics and Resume retries only the failed turn', async t => {
  const f = await fixture(t, async n => n === 1 ? 'bad JSON' : JSON.stringify({ response: `reply ${n}` }));
  f.config.maxTurns = 3;
  await f.controller.start(f.config);
  await until(() => f.controller.getStatus() === 'paused');
  assert.equal(f.controller.getState().activeAgentId, null);
  assert.equal(f.controller.getTurnIndex(), 1);
  assert.match(f.controller.getState().error.message, /Invalid JSON/);
  assert.equal((await f.logs.getConversationHistory('test-run')).length, 1);
  const errors = (await f.logs.getEventHistory('test-run')).filter(e => e.type === 'experiment_error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].turnIndex, 1);
  assert.equal(errors[0].diagnostics.httpStatus, 200);
  await Promise.all([f.controller.resume(), f.controller.resume(), f.controller.resume()]);
  await until(() => f.controller.getStatus() === 'completed');
  const turns = await f.logs.getConversationHistory('test-run');
  assert.deepEqual(turns.map(t => t.turnIndex), [0, 1, 2]);
  assert.deepEqual(turns.map(t => t.response), ['reply 0', 'reply 2', 'reply 3']);
  assert.equal(f.stats().maximum, 1);
  await f.controller.stop();
  await assert.rejects(f.controller.start({ ...f.config, llmConfig: { ...f.config.llmConfig, outputMode: 'json_only' } }), /different metadata/);
});

test('Pause/Resume races and reset wait for in-flight inference and preserve completed turns', async t => {
  let release;
  const gate = new Promise(r => release = r);
  const f = await fixture(t, async n => { if (n === 0) await gate; return JSON.stringify({ response: `turn ${n}` }); });
  f.config.maxTurns = 4;
  await f.controller.start(f.config);
  await until(() => f.stats().requests === 1);
  const pause = f.controller.pause();
  const resume = f.controller.resume();
  const duplicateResume = f.controller.resume();
  await sleep(30);
  assert.equal(f.stats().requests, 1);
  release();
  await Promise.all([pause, resume, duplicateResume]);
  await until(() => f.controller.getStatus() === 'completed');
  assert.equal(f.stats().maximum, 1);
  assert.deepEqual((await f.logs.getConversationHistory('test-run')).map(t => t.turnIndex), [0, 1, 2, 3]);
  await f.controller.reset();
  assert.equal(f.controller.getState().activeAgentId, null);
  assert.equal(f.controller.getStatus(), 'idle');
});

test('rejects invalid stat operations and targets while preserving immutable initial values', async t => {
  const f = await fixture(t, async () => '{}');
  const manager = new MemoryManager(f.storage);
  const op = (target_id, content, action = 'update') => ({ action, type: 'stat', target_id, content, reason: 'test' });
  const audit = await manager.applyOperations('bob', [op('curiosity', 11), op('curiosity', -1), op('curiosity', '9'), op('__proto__', 4), op('missing', 5), op('curiosity', 8, 'add'), op('curiosity', 7)]);
  assert.deepEqual(audit.map(a => a.status), ['failed','failed','failed','failed','failed','failed','success']);
  assert.deepEqual((await f.storage.loadAgentIdentity('bob')).stats.curiosity, { initial: 2, current: 7 });
  await assert.rejects(manager.applyOperations('bob', [{ action: 'oops' }]), /schema/);
});

test('Reset drains an active turn before accepting a new start; metadata survives restart', async t => {
  let release;
  const gate = new Promise(r => release = r);
  const f = await fixture(t, async n => { if (n === 0) await gate; return JSON.stringify({ response: `retained ${n}` }); });
  f.config.maxTurns = 2;
  const starts = await Promise.allSettled([f.controller.start(f.config), f.controller.start(f.config)]);
  assert.deepEqual(starts.map(s => s.status), ['fulfilled', 'rejected']);
  await until(() => f.stats().requests === 1);
  const reset = f.controller.reset();
  await sleep(20);
  assert.notEqual(f.controller.getConfig(), null);
  release();
  await reset;
  assert.equal(f.controller.getStatus(), 'idle');
  assert.equal((await f.logs.getConversationHistory('test-run')).length, 1);
  const snapshots = [];
  f.controller.onEvent((type, data) => { if (type === 'snapshot') snapshots.push(data); });
  // Property ordering does not change semantic metadata identity.
  await f.controller.start({ llmConfig: f.config.llmConfig, maxTurns: 2, agentIds: ['bob','sara'], runId: 'test-run' });
  await until(() => f.controller.getStatus() === 'completed');
  assert.equal(snapshots[0].turns.length, 1);
  assert.deepEqual((await f.logs.getConversationHistory('test-run')).map(t => t.turnIndex), [0,1]);
  assert.equal(f.stats().maximum, 1);
});
