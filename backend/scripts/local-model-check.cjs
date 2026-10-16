// Uses real inference, with isolated research data. No generated dialogue is substituted.
const { mkdtemp } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { JsonStorage } = require('../dist/storage/JsonStorage');
const { JsonlStorage } = require('../dist/storage/JsonlStorage');
const { LlmAdapter, resolveLlmConfig } = require('../dist/llm/LlmAdapter');
const { ExperimentController } = require('../dist/experiments/ExperimentController');
(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'emergent-local-model-'));
  console.log(`Research artifacts: ${root}`);
  const storage = new JsonStorage(path.join(root, 'model_memories'));
  const logs = new JsonlStorage(path.join(root, 'researcher'));
  for (const [id, name] of [['bob', 'Bob'], ['sara', 'Sara']]) {
    await storage.saveAgentIdentity(id, { id, name, stats: { curiosity: { initial: 5, current: 5 }, sociability: { initial: 5, current: 5 } }, memories: [], beliefs: [] });
  }
  const llmConfig = resolveLlmConfig({ model: process.env.LLM_TEST_MODEL || '' });
  const adapter = new LlmAdapter(llmConfig);
  let active = 0, maximum = 0;
  const generate = adapter.generateTurn.bind(adapter);
  adapter.generateTurn = async (...args) => {
    active++; maximum = Math.max(maximum, active);
    try { return await generate(...args); } finally { active--; }
  };
  const controller = new ExperimentController(storage, logs, adapter);
  const done = new Promise((resolve, reject) => controller.onEvent((type, data) => {
    if (type === 'experiment_error') reject(new Error(data.message));
    if (type === 'status_changed' && data.status === 'completed') resolve();
  }));
  // Attach a rejection handler before starting network operations.
  done.catch(() => {});
  await controller.start({ runId: 'local-100-turn-check', agentIds: ['bob', 'sara'], maxTurns: 100, llmConfig });
  await done;
  const history = await logs.getConversationHistory('local-100-turn-check');
  if (history.length !== 100 || maximum !== 1 || history.some((turn, i) => turn.turnIndex !== i)) throw Error('Invalid turn count/order or concurrent inference');
  console.log('PASS: Bob and Sara completed 100 schema-validated turns; maximum concurrent inference requests: 1. Original text and audit records are retained in the research artifacts.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
