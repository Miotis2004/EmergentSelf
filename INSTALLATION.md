# Installation Guide: Emergent Self

This document outlines how to set up and run the Emergent Self Phase I application. The application consists of an Angular frontend and a Node.js/TypeScript backend.

## Prerequisites

- **Node.js**: The project requires an LTS version of Node.js.
  - Ensure you are using `v22.22.1` or later.
  - You can use [nvm](https://github.com/nvm-sh/nvm) (or [nvm-windows](https://github.com/coreybutler/nvm-windows)) to manage your Node versions. Run `nvm use` in the project root if you have `nvm` installed.
- **npm**: Comes bundled with Node.js.
- **Local LLM Server**: You need a running llama.cpp-compatible server that provides an OpenAI-compatible API.

## Application Structure

- `frontend/`: Angular dashboard application.
- `backend/`: Node.js + Express + TypeScript API and experiment controller.
- `model_memories/`: Storage directory for agent states (identities, memories).
- `researcher/`: Storage directory for experimental configurations and append-only logs.

## Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the backend development server:
   ```bash
   npm run dev
   ```
   The backend will typically start on `http://localhost:3000`.

## Frontend Setup

1. Open a new terminal and navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Angular development server:
   ```bash
   npm start
   ```
   The frontend will be accessible at `http://localhost:4200`.

## Connecting to the Local LLM

The backend is configured to communicate with an OpenAI-compatible API, defaulting to `http://127.0.0.1:8080`.

1. Ensure your local LLM server (e.g., `llama.cpp`'s server) is running.
   - *Example `llama.cpp` command:*
     ```bash
     ./llama-server -m path/to/your/model.gguf --port 8080 --host 127.0.0.1 -c 4096
     ```
2. Verify the server is reachable:
   - You can test the health endpoint: `curl http://127.0.0.1:8080/health`
   - Or check available models: `curl http://127.0.0.1:8080/v1/models`

You can change the backend LLM configuration (URL, models) within the frontend dashboard once the application is running.

## Running an Experiment

1. Open the Angular dashboard at `http://localhost:4200`.
2. Use the **Agent Management** section to create at least two agents. Assign them numerical stats (e.g., curiosity: 5, sociability: 7).
3. Navigate to the **Experiment Controls**.
4. Set the maximum turns and click **Start**.
5. Observe the live conversation and inspect the active memory updates.
6. Check the `model_memories/` and `researcher/` directories in your project root to see the generated JSON files and JSONL logs.

## Troubleshooting

- **Connection refused (port 8080)**: Ensure your local model server is running and accessible on `127.0.0.1:8080`.
- **CORS errors**: The backend should handle CORS, but ensure your frontend is running on `http://localhost:4200` and the backend on the expected port (e.g., `3000`).
- **Memory not updating**: Check the backend console logs. Ensure the selected model supports structured output (JSON schema) and successfully returns the requested format.

## Structured output and Phase I diagnostics

The dashboard discovers loaded model IDs from the backend's `/api/llm/models`
endpoint (which queries the selected server's `/v1/models`). Select a model before
starting. The exact selected identifier, temperature, token budget and output mode
are saved in each run's `config.json`. Run IDs cannot be reused with different
settings; reset and choose a new run ID when changing them. Resume retains the
recorded settings and retries the failed turn, keeping completed turns intact.

Backend environment defaults (set in the shell or ignored `backend/.env`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `LLM_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible API base URL |
| `LLM_MAX_TOKENS` | `2048` | Positive integer completion token limit; dashboard can override per run |
| `LLM_OUTPUT_MODE` | `json_schema` | `json_schema` or explicit `json_only` compatibility mode |
| `LLM_DEBUG_CONTENT` | unset | Set to `true` only for deliberate debugging of response content |

JSON Schema mode sends an inference projection of the agent-turn schema to the
server and independently validates every returned object with the full application
schema. The projection removes upper string/array bounds (`maxLength`, `maxItems`)
to avoid llama.cpp bounded-repetition expansion; these limits remain enforced by
the backend and stated in the prompt. JSON-only mode sends
`response_format: {"type":"json_object"}`; the
same independent schema validation still applies. There is no automatic mode
switch, JSON repair, Markdown stripping, dialogue rewriting or invented response.
If a server rejects a mode, configure a supported one for a new run.

Every request in both modes includes a dedicated system message containing the
applicable response schema and transport-only JSON instructions, separate from the
original agent prompt and conversation. Required fields must be present, including
`memory_operations: []` when no changes are proposed; missing fields and malformed
operations are rejected without defaults. Social/task schema fields apply only
when their capabilities are enabled. Literal echoes of the reserved transport
marker or complete schema into dialogue or memory proposals are rejected.
The input character budget includes this formatting message.

Successful and failed inference audit records retain the original prompt, actual
request, raw model content (when returned), diagnostics, and validation outcome
with the contract version and schema hash. Formatting compliance still depends
on the local model; invalid output pauses the run rather than being repaired.
Stat updates must target an existing stat, use `update`, and contain a finite
number in the dashboard's 0–10 range. Initial stat values never change.

Backend diagnostics and error events record HTTP status, requested/reported model,
finish reason, content presence/length, a capped excerpt and token usage when
provided. By default the excerpt exposes only punctuation with text redacted.
`LLM_DEBUG_CONTENT=true` includes up to 200 characters of raw model output, which
can contain sensitive information; leave it disabled for normal research runs.
Complete prompts and conversations are not printed to the console. Research
conversation/state/audit files intentionally retain the experimental record.
`finish_reason: "length"` is always treated as truncation, even if its JSON parses.

Inference or validation errors appear inline in the dashboard and in the audit
panel, clear the thinking indicator and pause the run. Resume retries the failed
turn. Pause completes any in-flight turn before Resume can launch another loop.
Multiple dashboards can subscribe simultaneously; reconnecting restores saved
conversation and audit history. Backend process restart does not automatically
start a run: submit the same configuration/Run ID to continue saved turns.

Run regression checks with `cd backend && npm test`. These use controlled local
HTTP responses, including a 100-turn run and failure/retry and Pause/Resume races;
they do not establish compatibility with your actual model.

For the real local-model acceptance check, start your llama.cpp server, then run:

```bash
cd backend
# Uses discovery automatically when exactly one model is loaded.
# Set LLM_TEST_MODEL to an exact discovered ID if multiple models are loaded.
LLM_BASE_URL=http://127.0.0.1:8080/v1 npm run test:local-model
```

This creates isolated Bob/Sara states with numeric attributes, runs 100 real turns
using the unchanged application identity prompts, and preserves the resulting
conversation, metadata and audit files in the printed temporary directory. It
stops with a failure on invalid inference output and never substitutes dialogue.

## Participants and conversation topics

Each available agent has an **Include in Next Experiment** checkbox. Agents
initially default to unchecked. Check the agents who should participate; at least
two selected agents are required. The dashboard submits checked IDs in ascending
ID order, which becomes the fixed round-robin turn order. More than two agents
are supported. Only participating agents receive turns or memory/stat changes.

**Starting Demeanor** in Agent Setup is optional. Choose Helpful and Cooperative,
Solitary and Reserved, Analytical and Scientific, Ritualistic and Tradition-Oriented,
Skeptical and Questioning, Assertive and Competitive, or Custom. Custom descriptions
are trimmed and must contain 1–1,000 characters. Leaving the selector unspecified
preserves the original behavior. Curiosity and sociability remain independent.

Demeanor is immutable creation metadata in the canonical identity, separate from
learned self-descriptions and current attributes. Create a new agent to choose a
different initial demeanor; saving an existing identity or working state cannot
add, remove, or replace it. Existing agents and historical data are not migrated.

Both standard and Phase III protocol prompts include this initial context only
for agents that have it, without interpreting template placeholders inside the
description. It is an initial tendency rather than a permanent constraint;
researcher-assigned roles and task instructions take precedence. It is separate
from conversation topics, memory retrieval, and the JSON transport contract.

Run baselines and frozen starting snapshots retain the demeanor used at run
start. Clones, branches, restored working states, and research exports preserve
it alongside the rest of the identity. The Memory & self-model inspector displays
initial demeanor and initial/current attributes next to learned self-descriptions,
so comparisons use saved run state rather than today's agent list. No automatic
personality classification, adjustment, or development events are added.

**Conversation Topic** is optional multiline text, trimmed before saving and
limited to 1,000 characters. A nonempty topic is the user-message stimulus for
turn zero only. It is not inserted into the identity system prompt or repeatedly
reintroduced on later turns. Agents may move to other subjects naturally. Empty
or missing topics retain the original open-ended first-turn message.

Participants and topic are saved with the immutable run configuration and shown
when that run is loaded. Controls remain locked for running, paused, stopped and
completed runs. Resume uses the original configuration; to prepare another run,
Reset and choose a new Run ID. Existing runs without `initialTopic` are treated as
having an empty topic, without rewriting their configuration or research logs.
Apply this enhancement locally after any ongoing stability experiment finishes;
there is no automatic restart or migration of an active run.

Regression checks:

```bash
cd backend
npm test
cd ../frontend
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
```

The frontend tests require Chrome/Chromium (set `CHROME_BIN` if necessary).
Backend tests use isolated temporary storage and controlled inference responses,
including participant isolation, multi-agent order, topic delivery, legacy data
compatibility, and pause/resume/restart preservation.

## Phase II: memory and self-model evolution

The dashboard's **Memory condition** configures each new run. **Structured editable
memory** separates episodic observations, beliefs/opinions, self-description, and
relationships. **No memory** withholds all private working entries and shared
transcript history, presents original initial stats, and ignores every proposed
state change. It preserves existing working files for later comparisons. Neither
condition assigns personality traits or changes model weights.

Each entry has a stable ID, confidence (0–1, default 0.5), optional importance
(0–1), creation/update timestamps, initial/latest source events (run, global turn,
event ID), and an active/retired/superseded status. Relationships identify another
participant. Model replies retain the original `response` and `memory_operations`
shape. `memory` remains an alias for the new `episodic` type. Examples:

```json
{
  "response": "The model's original conversational text.",
  "memory_operations": [
    {"action":"add","type":"belief","content":"A provisional opinion","reason":"Evidence in this exchange","confidence":0.6,"importance":0.7},
    {"action":"add","type":"self_description","content":"An agent-authored self-description","reason":"Reflection on the exchange","confidence":0.5},
    {"action":"add","type":"relationship","relationship_agent_id":"sara","content":"An opinion about Sara","reason":"Observed interaction","confidence":0.6}
  ]
}
```

`update` revises an active `target_id`, retaining its original source and recording
the new source. `contradict` supersedes an active `target_id` with a new alternative
linked to that entry. `consolidate` combines two or more active `target_ids` of the
same category (and relationship subject) into a model-authored summary. `retire`
deactivates a `target_id`. These operations require `content` and `reason`; retirement
retains the original content. Superseded and retired entries remain in state and
history. Every accepted/rejected operation has a source-linked before/after audit.
Invalid targets, confidence/importance, stat changes, subjects, and limits are
rejected; another agent's private entries cannot be targeted.

Every enabled-memory inference includes an operation-reference guide in both the
standard and research-protocol prompt paths. A newly formulated belief can use
`add` without a target: a position expressed in conversation does not imply that
a stored entry already exists. Revisions must use exact active IDs from the
retrieved context; target IDs must never be invented. Stat updates use the exact
stat name instead of a memory-entry ID.

Active retrieved entries and extractive excerpts are grouped by category with
complete IDs. Category headings count toward the existing retrieval/digest
character budgets; ranking and source contents are unchanged. Research templates
continue to control where `{memory}` and `{digest}` appear.

The shared response schema uses complete `anyOf` object alternatives for local
constrained decoders: `update`, `retire`, and `contradict` require `target_id`,
and `consolidate` requires at least two distinct `target_ids`. Independent
validation remains mandatory in both JSON Schema and JSON-only modes. A missing
reference rejects the response before state changes and pauses the experiment;
the error event retains the original raw response, parsed proposal, and reason.
Existing but inactive targets, nonexistent targets, and category mismatches are
reported separately in the per-operation audit for structurally valid proposals.
Failed updates are never converted to additions, and model content is not repaired.
The guide and response schema count toward recorded inference input budgets.

No migration or rewrite of agent states, frozen snapshots, or historical logs is
performed. New prompts, schema hashes, proposals, and audit outcomes are recorded
with new inference attempts using the existing append-only research log.

Enabled-memory prompts also include a **Conversation Participants** directory built
from the saved run's participant IDs and run-scoped identities. Unselected agents
are omitted, and the current agent is marked `(you)`. Historical probes use saved
historical identities instead of current shared-agent names. Relationship `add`
operations must include an exact `relationship_agent_id` from that directory;
unknown subjects and self-references are rejected without name matching. Revisions
retain the original subject when that field is omitted and reject subject changes.
The schema enforces the addition field using the existing complete-object `anyOf`
approach; no new decoder keywords are introduced.

Retrieved entries now use one JSON record per line under category headings:

```json
{"metadata":{"id":"exact-stored-id","type":"belief","confidence":0.6,"status":"active"},"content":"Only the agent-authored statement.","excerpt":false}
```

Relationship metadata additionally includes `relationship_agent_id`. The metadata,
quoted content, and excerpt flag are separate; only content belongs in a proposed
memory's `content` field. Full IDs remain available for revisions. Display metadata
and JSON escaping count toward existing budgets; short budgets can fit fewer
records, and no record or identifier is cut in half to fit. Stored content and
retrieval ranking are unchanged.

Contamination detection is **warning-only**. It recognizes content starting with
a UUID/type/confidence display header or a complete structured memory record.
Warnings use code `memory_content_record_header` with a zero-based operation index,
format, message, and original content. They appear in the operation audit and
inference validation diagnostics, including schema-rejected attempts. The audit
panel displays these warnings alongside the original proposal. They do not strip
headers, repair references, reject otherwise valid content, or rewrite history.
A legitimate quotation may trigger a warning; other contamination patterns may go
undetected. Existing polluted memories are retained rather than cleaned up.

Retrieval is deterministic and configurable in the dashboard, recorded in
`config.json` as `memoryConfig`, and repeated in each turn's retrieval metadata:

| Field | Default | Allowed range / values |
| --- | --- | --- |
| `mode` | `enabled` | `enabled`, `none` |
| `maxActiveEntries` | 200 | 1–1000 |
| `maxOperations` | 20 | 1–50 |
| `maxEntryChars` | 2000 | 1–8000 |
| `retrievalEntries` | 24 | 0–100 |
| `retrievalChars` | 12000 | 0–32000 |
| `entryChars` | 1000 | 1–8000 |
| `summaryChars` | 2000 | 0–8000 |
| `transcriptTurns` | 10 | 0–100 |
| `transcriptChars` | 8000 | 0–32000 |
| `retrievalRule` | `importance` | `importance`, `recent` |

Importance retrieval ranks by importance (unspecified = 0.5), confidence, update
time, then ID. Recent retrieval ranks by update time then ID. Only active entries
are retrieved. Overflow can contribute short verbatim excerpts to a separately
labeled **extractive digest** with source entry IDs. This deterministic summary
uses no additional inference and never overwrites entries. Agent-authored
consolidations are distinct, explicit operations in the audit. Zero digest budget
disables the extractive summary. Memory and transcript budgets are character
limits, not tokenizer guarantees; choose them to fit your local model's context
window plus the completion budget. Retained research files are not size-limited
by retrieval settings.

Mutable Phase II state lives in `model_memories/agents/<id>/state.json` with
`schemaVersion: 2`; the complete identity and entries are replaced atomically in
one file. Phase I identity/memory/belief files are imported on read without
rewriting them. Unknown legacy sources/timestamps remain null; imported confidence
is explicitly defaulted to 0.5. Original legacy files remain intact when a new
canonical state is created. The API serves canonical state after that point.

Each run gets an immutable `memory-baseline.json` and append-only turn records
containing before/after working state, exact rendered prompt, raw/parsed successful
model output, operation audit, selected/digest IDs, omissions, and budgets. These
research files contain private experimental content; console diagnostics remain
redacted by default. A turn is committed to `conversation.jsonl` before updating
working state and appending its memory event. Resume/start repairs pending state
and event projections from that exact committed record before further inference,
so a failed projection does not repeat model calls or duplicate memory additions.
A writer lock covers the research store, including paused runs; a second worker
cannot mutate it. Stop releases it after pending projections are repaired. Only
locks whose owning PID is confirmed dead are automatically reclaimed. This is
application-level recovery, not a guarantee against disk corruption or power loss.

Use **Memory & self-model** in the audit panel to select an agent, inspect its
state after a committed global turn, compare with another turn, and browse its
operation timeline. Turn `-1` means the initial state for a new run. You can enter
another saved Run ID. The equivalent read-only API is:

```text
GET /api/experiment/runs/<runId>/agents/<agentId>/memory?turn=8&compareTo=2
```

The response includes state, timeline, differences, and the available historical
range. Legacy runs resumed under Phase II get a baseline at the last pre-Phase-II
turn; earlier states cannot be reconstructed reliably and return a clear error.
Completed legacy runs are not migrated merely by viewing/starting them. Their
historical endpoint reports that Phase II history was not recorded.

Run `cd backend && npm test` for memory evolution, source attribution, retrieval,
no-memory isolation, historical differences, consolidation retention, writer
ownership, and journal-recovery regressions. Angular tests also cover configuration
locking and the memory history explorer. Actual local-model behavior still needs
the researcher-run `npm run test:local-model` check.

## Phase III: controlled trials and reproducibility

Open **Experimental controls & reproducibility** in the dashboard. The normal
conversation controls remain available for Phase I/II runs. Phase III templates
and batches are a separate, explicit workflow:

1. Select participants, topic, maximum turns, model ID, output mode, and memory
   budgets using the existing controls.
2. Enter a new template ID and record the model weight version/hash. The literal
   value `unverified` records unknown provenance explicitly; the application
   cannot verify local model weights from an OpenAI-compatible model ID alone.
3. Choose temperature, top-p, declared context size, optional sampling seed, and
   attribute condition. Review the fixed system/turn prompts and input limit.
   Freeze the template. This also captures an immutable starting-state snapshot.
   Optionally choose a saved historical snapshot as the template's starting point.
4. Select the saved template, a new batch ID, repeats per condition, conditions,
   and randomization seed. Prepare the batch. Its immutable manifest contains
   every complete planned configuration and participant order. At most 100 trials
   can be prepared in a batch. No inference starts during preparation.
5. Start each selected trial explicitly. Pause/resume/stop still use the main
   controls. A completed trial can be followed by another manifest trial without
   resetting or modifying the original trial. Load a saved batch to continue later.

Templates and manifests use exclusive creation: existing IDs cannot be edited or
replaced. Create a new ID for revisions. The controller verifies model discovery,
configuration identity, starting-snapshot hash and participant membership before
execution. Existing Phase I/II data is neither rewritten nor automatically migrated.

Conditions are named and fixed in each trial's protocol and memory configuration:

| Condition | Private working memory | Shared transcript | Apply state proposals |
| --- | --- | --- | --- |
| `none` — No memory | Withheld | Withheld | No |
| `history` — Conversation history only | Withheld | Bounded, using recorded budgets | No |
| `enabled` — Structured editable memory | Bounded retrieval/digest | Bounded, using recorded budgets | Yes |

No-memory/history-only conditions present original initial numeric stats. All
conditions share the template's model/version declaration, sampling, output mode,
prompt templates, starting snapshot, completion budget, and context limits. The
condition changes only the context/state policy. Differences remain visible in
configuration comparison. A randomization seed shuffles the balanced condition/
repeat assignments with a versioned LCG/Fisher–Yates procedure. Optional participant
randomization is matched by repeat across conditions; the final order is stored in
the manifest and run configuration. Randomization seeds are separate from inference
seeds. Sampling settings, including an optional inference seed, stay fixed across
repetitions. A seed is sent only when `seedSupported: true` is explicitly declared;
unsupported or invalid seed configurations are rejected rather than silently changed.
A server may still ignore a seed or produce nondeterministic output; fixed seeds
are not a claim of deterministic inference.

Every Phase III trial has its own `working-state/agents/<id>/state.json` under its
research run directory. Logical agent IDs/names stay the same across repeated
trials, avoiding clone-name changes in prompts. The frozen starting snapshot is
copied once, then that trial's state evolves independently. The global agents and
other trials' state are not modified. Restart/recovery projects committed turns
back into the correct trial store. Memory entry/event IDs and timestamps are
runtime metadata, not deterministic outputs of the randomization seed.

Attribute conditions are explicit factors, never hidden personality instructions:

- `numeric`: present original named numeric labels, without interpreting them.
- `arbitrary`: sort stat keys and substitute q1, q2, …; record the label mapping in
  turn retrieval metadata for analysis. Arbitrary labels are not proof of semantic
  neutrality to pretrained models.
- `role`: omit the numeric block and present the researcher's per-agent role text.
  Every participant must have an explicit description. Other modes reject role text.

Fixed prompts support `{id}`, `{name}`, `{attributes}`, `{memory}`, `{digest}`, and
`{transcript}`. Substitution is a single literal pass; entry/role text cannot expand
additional placeholders or execute code. The optional starting topic remains the
first-turn user stimulus. Each turn records the rendered prompt and exact adapter
request (including JSON-only formatting instructions, response schema, sampling
settings, and seed), raw/parsed reply, diagnostics, state changes, and configuration
hash. Model/server defaults not exposed in the API should be documented in your
model-version declaration or researcher notes.

`protocol.inputCharLimit` caps actual request-message characters, including any
compatibility instruction. It defaults to 24000 and is held fixed across conditions.
Over-budget requests fail visibly; the application does not silently shrink one
condition's context or switch models/modes. `contextWindowTokens` is a researcher-
declared model setting, not an instruction that reconfigures llama.cpp. Character
limits are not exact token counts. Configure the server context and character/
completion budgets together for your tokenizer.

For historical analysis, enter a run and global turn in the research panel. Capture
an immutable snapshot, or clone one source agent into a new globally available
agent ID. A clone keeps original entry source references and records snapshot/run/
turn/agent lineage in its state and a separate researcher intervention. It never
overwrites an existing agent. This is an independent state copy, not automatic
execution of a new experiment.

Standardized probes are immutable definitions containing 1–20 literal prompts.
Separate turns with a blank line in the dashboard. Run a probe against an agent's
state at a recorded main-run turn. Probes use the saved model, prompts, attribute
condition and budgets, but a separate probe-only conversation. They do not import
the main transcript or apply proposed memory/stat changes. Probe results, failures,
actual requests and source-state hashes go to `probes.jsonl`, not the conversation
or memory projection. They identify the main source turn, probe session and probe
turn. Pause/stop first: probes share the scheduler queue and research-store writer
lock, so no probe and experiment inference can overlap. Probe context overflow
fails explicitly instead of truncating or attributing an older reply to a new turn.

Researcher names/reasons are required for notes, probes, snapshots and clones.
These actions append to `interventions.jsonl` independently of agent memory events.
Explicit Phase III start/restart/pause/resume/stop/reset controls also append there;
controls from the unauthenticated local API identify their actor as `unspecified`
rather than inventing a researcher identity. No memory transplantation, rewards,
or other unrecorded state interventions are introduced in Phase III.

Compare two started runs to see every differing configuration path, including
model/sampling, prompts, budgets, conditions, participant order and starting-state
hash. The interface flags legacy runs without recorded Phase III prompts. Download
an idle/paused/completed run to obtain a versioned JSON analysis bundle containing
configuration, baseline, complete turns, memory events, interventions, probes and
definitions, starting snapshot, template, batch manifest, and canonical SHA-256
checksums. Checksums support consistency checks; they are not digital signatures.
Export requires pausing to obtain a consistent committed boundary. Research exports
contain private prompts and memories and should be handled as experimental data.

API routes (JSON bodies; IDs use letters, numbers, hyphens or underscores):

| Method/path under `/api/research` | Purpose / body |
| --- | --- |
| `GET /defaults`, `GET /catalog` | Prompt defaults and saved identifiers |
| `POST /templates` | `{templateId, configuration}`; full experiment settings plus optional protocol |
| `POST /batches` | `{batchId, templateId, repeats, conditions, randomizationSeed, randomizeParticipants}` |
| `GET /batches/:batchId` | Frozen manifest |
| `POST /batches/:batchId/start` | `{runId}`; run must belong to the manifest |
| `GET /compare?left=A&right=B` | Exact configuration differences |
| `POST /snapshots` | `{snapshotId, runId, turnIndex, actor, reason}` |
| `POST /clones` | `{snapshotId, sourceAgentId, targetAgentId, actor, reason}` |
| `POST /probe-definitions` | `{probeId, prompts}` |
| `POST /runs/:runId/probes` | `{probeId, agentId, turnIndex, actor, reason}` |
| `POST /runs/:runId/interventions` | `{actor, reason}`; researcher note |
| `GET /runs/:runId/export` | Structured analysis download |

Example protocol fields inside a template's `configuration` (other fields follow
the existing experiment API):

```json
{
  "llmConfig": {
    "baseUrl": "http://127.0.0.1:8080/v1", "model": "exact-loaded-id",
    "modelVersion": "researcher-recorded-weight-hash", "temperature": 0.7,
    "topP": 1, "maxTokens": 2048, "contextWindowTokens": 8192,
    "seed": 42, "seedSupported": true, "outputMode": "json_schema"
  },
  "memoryConfig": { "mode": "enabled" },
  "protocol": { "version": 1, "attributeMode": "numeric", "inputCharLimit": 24000 }
}
```

Run `cd backend && npm test` and `cd frontend && npm test -- --watch=false
--browsers=ChromeHeadless` for automated trial isolation, conditions, randomization,
probes, snapshots/clones, configuration comparison/export, seed/budget validation,
HTTP integration and dashboard checks. These tests use controlled responses;
actual-model compatibility and experimental findings still require local runs.

Advanced callers may also supply `protocol` to the existing experiment start API.
Such runs require an explicit model version/hash (or `unverified`). Its default
`stateScope: "shared"` retains the Phase II global-memory workflow; the controller
records the baseline's `initialStateHash`, so comparisons expose differing starting
memory instead of implying equal conditions. Snapshot-backed protocols require
`stateScope: "trial"`; dashboard templates always choose isolated trial state.

## Phase IV behavioral analysis

No additional services or dependencies are required. Run the backend and Angular dashboard as above, pause or complete an experiment, then open **Behavioral measures & longitudinal analysis**. The separate `/review` page serves metadata-blinded human evaluation. [PHASE_IV.md](PHASE_IV.md) documents benchmarks, memory tests, scoring rubrics, API endpoints and offline JSON/CSV analysis.

## Phase V social interaction and feedback

No additional services or dependencies are required. Use **Social interaction, tasks & feedback** to configure the next run. Freeze a feedback-enabled template and include matched feedback-off arms for controlled batches. [PHASE_V.md](PHASE_V.md) describes exact payoff rules, feedback delivery, recovery, API fields and analysis.

## Phase VI branches and identity continuity

No additional dependencies or services are required. Capture a historical snapshot from a fixed-protocol run, then use **Identity continuity, branches & interventions** to create, inspect, prepare and start independent runs. [PHASE_VI.md](PHASE_VI.md) documents reversible operations, model variants, paired probes, API fields and analysis.

## Phase VII synthesis and publication artifacts

No additional dependencies or services are required. A full checkout (including `examples/phase-vii`) supports code/archive provenance. Use **Research synthesis & publication readiness** after preparing trial batches/branches. [PHASE_VII.md](PHASE_VII.md) documents prospective registration, local-model replication, private/aggregate packages and offline reconstruction. `npm run example:publication --prefix backend -- --check` validates the anonymous synthetic example without inference.

## Location, action and operational state

New runs can enable **Location & activity**, define up to 30 named destinations,
and choose own-state-only or explicit recorded co-location observations. Saved run
configuration stays locked. Silent action and continuation turns are supported;
completed statuses remain agent-reported and unverified. Older runs omit this
feature and keep their original contract. See [OPERATIONS.md](OPERATIONS.md) for
response schemas, atomic validation, state-scope and snapshot compatibility, audit
provenance, branch interventions, and the recommended local garden experiment.

## llama.cpp schema initialization check

Stop active experiments, then run this sequential six-combination check locally:

```bash
cd backend
LLM_BASE_URL=http://127.0.0.1:8080/v1 LLM_TEST_MODEL=your-loaded-model npm run test:local-schema
```

It uses the exact generated JSON Schema projection, saves request/schema/HTTP
artifacts in a temporary directory, and checks sampler initialization using one
completion token. A truncated one-token reply is expected; HTTP/schema acceptance
is separate from successful application response validation. Unavailable servers
produce an explicit UNVERIFIED result and nonzero exit status. See
[LLAMA_SCHEMA_COMPATIBILITY.md](LLAMA_SCHEMA_COMPATIBILITY.md) for the exact schema
change, upstream parser measurements, audit hashes and remaining live validation.

## Verified task history and soft agent removal

The dashboard now provides a separate Task History inspector with agent/run/status filters and source-linked resource evidence. Setup includes bounded verified-history context settings; historical achievements never carry physical resources or equipment state into a new world. See [Task history](docs/TASK_HISTORY.md) for evidence semantics, snapshot isolation and the index repair command.

Use an agent's trashcan action in Available Agents to open its REMOVE/CANCEL confirmation. Removal archives selection visibility after successful backend confirmation. Stop an active participant's experiment first. Identity lookup, memory, relationships, task history and historical experiment participation are preserved; no agent data is deleted.
