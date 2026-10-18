# llama.cpp grammar initialization and schema projection

## Exact change

`responseSchema()` remains the authoritative, independently compiled AJV validation
schema. `inferenceResponseSchema()` derives a fresh projection from it, recursively
removing only `maxLength` and `maxItems`. The adapter sends this projection through
`response_format.type = json_schema`; all object alternatives, types, required
fields, additional-property prohibitions, enums, numeric bounds, array minima and
unique-item constraints remain unchanged. JSON Schema mode is never replaced with
JSON-only mode, and no fallback or JSON repair is introduced.

The system transport message still contains the full validation schema and its
limits. Returned responses are always checked against that full schema, followed
by the existing configured memory limits, relationship checks and operational
transition validation. No backend limits or experiment configuration are reduced.
Both generation and validation accept every strictly valid response. The generation
schema permits over-limit strings/arrays; the backend rejects them without rewriting.
Existing completion-token limits remain unchanged and still bound inference.

The risky emitted rules included `char{0,8000}` for memory content in four memory
alternatives, `char{1,2000}` for operational reasons, `char{1,1000}` for activity
descriptions, and bounded arrays of 50 memory operations, 20 consolidation targets
and 8 operational operations. llama.cpp repetition guards depend on converter and
parser version and count expanded rules, not merely JSON-schema size. Removing
upper repetition bounds avoids these large finite expansions rather than guessing
new limits that could diverge from the research configuration. ADD, UPDATE, RETIRE,
CONTRADICT and CONSOLIDATE and all speech/operational response combinations remain.

## Verification performed

- 176 backend tests pass, including six response-schema combinations, strict
  over-length/over-count rejection, target and relationship requirements,
  configured memory limits, operational validation, actual adapter payloads,
  untouched raw proposals, and inference/validation schema hashes.
- Backend and frontend builds pass.
- No live llama.cpp server was available at `127.0.0.1:8080`. The live check failed
  model discovery with ECONNREFUSED and explicitly reported UNVERIFIED. Ornith and
  the 12-turn garden experiment have **not** been verified in this environment.
- Separately, actual upstream C++ JSON-schema conversion and grammar parsing were
  tested model-free at llama.cpp commit
  `797de63b2fa7396dcc8caca76834c699ac84e1c3`. This is independent of AJV and does not
  test a loaded model, sampler initialization through HTTP, or the researcher's
  server build. The harness compiled the upstream converter/parser directly; it
  loaded no vocabulary, and its unused tokenizer link stub throws if called.
  Required string helpers were copied unchanged from upstream common.cpp.

The upstream parser accepted the projected grammar in all six combinations:

| Combination | Original parsed rules | Projected parsed rules |
| --- | ---: | ---: |
| Normal | 354 | 230 |
| Social | 362 | 238 |
| Task-enabled social | 371 | 247 |
| Operational | 5,505 | 263 |
| Social + operational | 5,513 | 271 |
| Task-enabled social + operational | 5,522 | 280 |

Importantly, this upstream revision also accepted the original schema: its parser
clamps sufficiently large upper repetitions to unbounded repetition. The reported
HTTP failure was therefore **not reproduced against the researcher's build**.
The table demonstrates elimination of the expensive expansions, not proof of that
server's acceptance. For operational-only grammar, removing maxLength alone reduced
parsed rules to 385; removing maxItems alone left 5,383. Removing both produced 263.
Thus bounded strings were the dominant expansion source in this measurement, with
bounded arrays adding further rules. Backend validation remains necessary even when
an upstream parser accepts a schema but relaxes its upper bounds internally.

## Audit and live verification

`lastValidation.schemaHash` retains its historical meaning as the full validation
schema hash. `validationSchemaHash` states that meaning explicitly. JSON Schema
attempts additionally record `inferenceSchemaHash` and the fixed projection profile
`inferenceSchemaVersion: llama-unbounded-v1`. Actual requests, strict prompt contract,
raw output, parsed proposals and validation failures remain in the normal audit.
Historical records and frozen configurations are not rewritten.

After stopping active experiments, run:

```bash
cd backend
LLM_BASE_URL=http://127.0.0.1:8080/v1 LLM_TEST_MODEL=actual-loaded-id npm run test:local-schema
```

The script submits six sequential minimal requests using the exact generated
schemas. One token is sufficient to exercise sampler/grammar initialization; a
finish_reason of length is expected and does not count as successful structured
response validation. HTTP acceptance, a completion envelope, and absence of grammar
errors are checked, and all requests/HTTP bodies/schemas plus a report are saved in
the printed temporary directory. A mock server or AJV pass is not live compatibility
proof. Record the actual llama.cpp version/build with the local results.

Then repeat the 12-turn garden run with Ornith, Structured Editable Memory,
operational turns, the scenario's saved locations, and JSON Schema mode. Verify
inference begins, no grammar HTTP 400 occurs, all successful turns pass full backend
validation, nonverbal/no-op turns are preserved, and invalid operations still pause
or retain their existing audited rejection semantics. Review actual model behavior
separately from grammar initialization.
