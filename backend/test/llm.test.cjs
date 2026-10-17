const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { LlmAdapter, LlmError, resolveLlmConfig } = require('../dist/llm/LlmAdapter');

async function server(t, handler) {
  const s = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const result = handler(raw ? JSON.parse(raw) : null, req);
    res.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
    res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
  });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => s.close(r)));
  return `http://127.0.0.1:${s.address().port}/v1`;
}
const envelope = (content, finish_reason = 'stop') => ({ model: 'loaded-model', choices: [{ message: { content }, finish_reason }], usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 } });

test('preserves exact dialogue, requires explicit operations, records safe diagnostics and uses 2048 tokens', async t => {
  const original = 'Hello, Sara.\n  Unchanged words and whitespace. 私';
  const baseUrl = await server(t, payload => {
    assert.equal(payload.max_tokens, 2048);
    assert.equal(payload.response_format.type, 'json_schema');
    assert.equal(payload.messages[0].content, 'unchanged identity');
    return { body: envelope(JSON.stringify({ response: original, memory_operations: [] })) };
  });
  const adapter = new LlmAdapter({ baseUrl, model: 'loaded-model' });
  assert.deepEqual(await adapter.generateTurn('unchanged identity', []), { response: original, memory_operations: [] });
  assert.equal(adapter.lastDiagnostics.httpStatus, 200);
  assert.equal(adapter.lastDiagnostics.model, 'loaded-model');
  assert.equal(adapter.lastDiagnostics.finishReason, 'stop');
  assert.equal(adapter.lastDiagnostics.contentPresent, true);
  assert.equal(adapter.lastDiagnostics.usage.total_tokens, 168);
  assert.ok(!adapter.lastDiagnostics.excerpt.includes('Sara'));
});

test('rejects HTTP, envelope, truncation, JSON and schema failures with diagnostics and no automatic fallback', async t => {
  const cases = [
    [{ body: envelope('{"response":"hello"}') }, /agent-turn schema/],
    [{ body: '<html>private memory content</html>' }, /non-JSON HTTP body/],
    [{ status: 400, body: { error: 'schema unsupported' } }, /HTTP 400.*No automatic fallback/],
    [{ body: {} }, /missing choices/],
    [{ body: { choices: [{ message: {} }] } }, /missing nonempty/],
    [{ body: envelope('{}', 'length') }, /truncated.*length/],
    [{ body: envelope('{}', 'content_filter') }, /did not finish normally/],
    [{ body: envelope('```json\n{"response":"private memory"}\n```') }, /Invalid JSON/],
    [{ body: envelope('{"response":9}') }, /agent-turn schema/],
    [{ body: envelope('{"response":"hello","memory_operations":null}') }, /agent-turn schema/],
    [{ body: envelope('{"response":"hello","memory_operations":[{"action":"bad"}]}') }, /agent-turn schema/],
  ];
  let calls = 0;
  let result;
  const baseUrl = await server(t, () => { calls++; return result; });
  for (const [response, message] of cases) {
    result = response;
    const adapter = new LlmAdapter({ baseUrl, model: 'loaded-model' });
    await assert.rejects(adapter.generateTurn('private memories', []), error => {
      assert.ok(error instanceof LlmError);
      assert.match(error.message, message);
      assert.ok(!JSON.stringify(error.diagnostics).includes('private memory'));
      return true;
    });
  }
  assert.equal(calls, cases.length);
});

test('JSON-only compatibility is explicit; environment defaults and discovery are validated', async t => {
  const oldTokens = process.env.LLM_MAX_TOKENS;
  const oldMode = process.env.LLM_OUTPUT_MODE;
  t.after(() => {
    if (oldTokens === undefined) delete process.env.LLM_MAX_TOKENS; else process.env.LLM_MAX_TOKENS = oldTokens;
    if (oldMode === undefined) delete process.env.LLM_OUTPUT_MODE; else process.env.LLM_OUTPUT_MODE = oldMode;
  });
  process.env.LLM_MAX_TOKENS = '4096'; process.env.LLM_OUTPUT_MODE = 'json_only';
  assert.equal(resolveLlmConfig().maxTokens, 4096);
  assert.throws(() => resolveLlmConfig({ maxTokens: -1 }), /positive integer/);
  assert.throws(() => resolveLlmConfig({ outputMode: 'auto' }), /outputMode/);
  const baseUrl = await server(t, (payload, req) => {
    if (req.url.endsWith('/models')) return { body: { data: [{ id: 'actual-model' }] } };
    assert.equal(payload.response_format.type, 'json_object');
    assert.equal(payload.max_tokens, 4096);
    return { body: envelope('{"response":"verbatim","memory_operations":[]}') };
  });
  const adapter = new LlmAdapter({ baseUrl, model: 'actual-model' });
  assert.deepEqual(await adapter.getModels(), [{ id: 'actual-model' }]);
  assert.equal((await adapter.generateTurn('', [])).response, 'verbatim');
});

test('input budgets include the transport contract without dropping instructions',async t=>{
  let calls=0;
  const baseUrl=await server(t,()=>{calls++;return {body:envelope('{"response":"JSON is our discussion topic.","memory_operations":[]}')};});
  const adapter=new LlmAdapter({baseUrl,model:'loaded-model'});
  const {outputContract}=require('../dist/llm/LlmAdapter');
  const {responseSchema}=require('../dist/llm/agentTurnSchema');
  const size='identity'.length+'hello'.length+outputContract(responseSchema()).length;
  await assert.rejects(adapter.generateTurn('identity',[{role:'user',content:'hello'}],size-1),/input character limit/);
  assert.equal(calls,0);assert.equal(adapter.lastValidation.stage,'request');assert.equal(adapter.lastValidation.status,'failed');
  assert.equal(adapter.lastRequest.messages.at(-1).content,outputContract(responseSchema()));
  assert.equal((await adapter.generateTurn('identity',[{role:'user',content:'hello'}],size)).response,'JSON is our discussion topic.');
  assert.equal(calls,1);
});
