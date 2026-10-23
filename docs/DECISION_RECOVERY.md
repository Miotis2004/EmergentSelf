# Agent decision validation and recovery fixes

## Investigation and root causes

The supplied `team-competition-01` failure sequence is reproduced with deterministic model responses; its original local run files and Ornith server are not available in this workspace. The conclusions below distinguish code defects from unverified model behavior. No existing researcher data or experiment configuration was edited.

The execution rules themselves correctly rejected the supplied combinations. The reliability problem was how those rules were conveyed and checked:

- `interaction/policy.ts` described primary modes briefly, but omitted several supporting activity/status and memory restrictions. The operational guide's one-of-each rule was separated from the world and channel rules. A model could express a reasonable multi-turn intention as an illegal itinerary.
- `operational_operations` allowed eight entries structurally although only one `set_location` and one `set_action` could ever commit. The decoder projection removed every array upper bound. Communication had one generic object variant allowing nonempty recipients on all scopes and empty recipients on private scope. Schema-valid JSON therefore did not imply an executable turn.
- Execution stopped at the first intent error, then operational error, memory error, routing error or world error. For an `observe` itinerary it reported the primary-mode conflict before checking duplicate movements. Fixing that could expose a later activity or audience conflict, spending another corrective attempt each time.
- Retries supplied every previous correction plus its complete rejected candidate. Old diagnostics remained in the request after the model had fixed that particular issue. Historical evidence is necessary, but repeating the entire correction chain is not required for the next inference.
- The shared adapter merged a complete run configuration into its previous settings. An omitted timeout (or other optional sampling field) could therefore inherit a prior run's value. The controller now replaces the complete experiment configuration while the adapter's separate partial-update API remains available.
- The configured timeout default was ten minutes in `resolveLlmConfig`, but the HTTP request used a five-minute fallback when no explicit timeout was persisted. Diagnostics did not expose effective timeout, elapsed adapter time, request size or failure phase. The timeout's frequency and underlying server cause in the supplied run cannot be determined without its logs.

These findings explain the permissive output surface and incremental correction failure pattern; they do not establish Ornith's internal reasoning or prove live-model recovery.

## Changes

### Shared executable-turn policy

`backend/src/interaction/execution.ts` contains the mode compatibility table used by both `validateIntent` and the dynamically generated **Turn Execution Contract**. It preserves the existing mixed-behavior policy:

| Mode | Location | Physical mutations | Inspection/wait | Memory proposals | Activity status |
| --- | --- | --- | --- | --- | --- |
| plan | No | No | Yes | Yes | Any type with status planned; idle with any status |
| observe | No | No | Yes | No | Observing or idle |
| act | Yes | Yes | Yes | Yes | Any supported type/status |
| idle | No | No | Wait only | No | Idle |
| change_location | Explicit transition required | No unrelated physical mutation | Yes | Yes | Any supported type/status |
| communicate | No | No | Yes | Yes | Interacting or idle |
| reflect | No | No | Yes | Yes | Interacting or idle |

Permissions apply only when the underlying capability is enabled. All modes permit silence and optional supporting speech; no plan, recipe, destination, search order or cooperation is mandatory. Changing location plus inspecting its authorized storage can share one `act` or `change_location` turn; collecting/transferring resources requires `act`. At most one location and one activity transition are allowed, in either order. Intending to travel does not change authoritative location. Memory proposals continue through the existing memory-condition and independent validation mechanisms; no planning state machine or automatic memory edits were added.

Every scoped/agent-selected inference, including corrections, restarted pending turns, memory conditions and research probes, receives a final system contract immediately before the schema serialization contract. It derives enabled modes, locations, operation types, channels and own-team membership from saved permissions. Disabled transformations and channels are omitted from configured schemas and advertised operation lists. No other team's membership, private transcript or private memory is added. The original agent prompt remains separately recorded; the actual request records the final execution and serialization messages.

### Schema and independent validation

`llama-small-bounds-v2` keeps only tiny `maxItems` bounds (0–2) in decoder schemas; large bounded strings and arrays remain projected away for llama.cpp compatibility. Independent validation retains all original memory, text-length, resource, task and authorization checks.

- Operational arrays have `maxItems: 2`, matching the total maximum valid batch. One-of-each still requires backend validation: two location changes are rejected even though the total is two. No conditional/tuple/product expansion was added to enforce the full intent matrix in grammar.
- Configured validator cache keys include enabled world-operation capabilities, preventing a schema compiled for a different run with the same participants from rejecting newly enabled transformations.
- Private communication requires at least one unique recipient and uses eligible participant IDs when researcher context is available. Team/local/global communication requires `recipientAgentIds: []`. Only enabled scopes are included in configured generation schemas.
- Silence still requires `response: ""` and `communication: null`; cross-field checks remain authoritative backend checks. There is no invented missing field, rewritten scope, deleted operation or automatic dialogue repair.
- Modern/scoped turns explicitly reject remote inventory inspection, including remote public or explicitly authorized storage. The original legacy world visibility mechanism could expose configured public inventory facts and permit an inspection from afar; it is not treated as permission for physical remote inspection under the new executable contract. Legacy unscoped runs retain their original semantics. Existing committed records are not revalidated or rewritten.

A complete valid silent operational/world response, using the actual transport fields:

```json
{
  "decision": {"mode": "idle", "reason": "No change proposed", "goal": null},
  "response": "",
  "communication": null,
  "operational_operations": [],
  "world_operations": [],
  "memory_operations": []
}
```

For permitted nonempty speech, choose a configured scope explicitly:

```json
{"scope": "private", "recipientAgentIds": ["agent-06"]}
```

```json
{"scope": "team", "recipientAgentIds": []}
```

These are structural examples, not suggested conversational content. Social/task-enabled requests still require their existing social/task fields.

### Aggregated recovery diagnostics

Structured `violations` contain a stable code, path and actionable constraint. The adapter merges schema failures with deterministically identifiable intent, count, destination and communication failures; schema-valid candidates receive the same preflight checks in the controller. Independent validators still check candidate memory, locations, inventory transactions and transformation state before the established canonical commit.

An `observe` candidate with three movements now reports both the mode incompatibility and the three-versus-one transition count in one diagnostic. It can additionally identify duplicate activities, unknown destinations, prohibited memory edits, disabled operations and backend-resolved recipient violations without choosing a replacement mode or destination. State-dependent errors whose interpretation relies on an ambiguous itinerary are not guessed. Sequential world operations still use the authoritative existing validator; this is not a claim to exhaustively explain every possible downstream error in one pass.

Diagnostic codes:

- `INVALID_AGENT_DECISION`: unavailable mode/missing reason; forbidden physical, movement, memory, inspection or activity combination; `change_location` without a transition.
- `CONFLICTING_OPERATIONAL_TRANSITIONS`: more than one location or activity change, including schema-rejected oversized batches. No transition is partially applied.
- `INVALID_COMMUNICATION`: disabled/missing scope, invalid explicit audience, nonempty backend-resolved audience, empty private audience, silence/metadata mismatch, absent own team, unknown local location or conflicting social recipient.
- `INFERENCE_TIMEOUT`: client request/body timeout. It remains technical, receives backoff rather than behavioral correction, and does not spend the corrective budget. Connection failure, HTTP server errors, output truncation and input-budget failure retain their separate classifications; an HTTP error is not automatically labeled a client timeout.

Only the latest complete private correction is sent with the frozen original context. Every prior correction, original raw/parsed proposal, violation list and recovery cursor remains in append-only audit/checkpoints. Nothing is moved to a future turn, coerced into another intent, routed to another audience or committed on behalf of the agent. Angular shows the entire violation list in suspension status and expanded retry audit.

The original release recorded `executionContractVersion: "turn-execution-v1"`, its hash, authoritative and inference schema hashes, raw output and validation outcome. Effective `requestTimeoutMs`, `elapsedMs`, `inputChars`, `maxTokens` and `failureStage` enrich diagnostics without exposing conversation or memory text in default console logs. Adapter elapsed time includes request preparation/journaling and response processing; it is not a measurement of model-generation time alone. The effective omitted timeout is now consistently 600,000 ms; explicit saved values still take precedence, with the existing environment override for new/unspecified configuration. Body timeouts identify `http_body`; response-token usage remains recorded when the server provides it.

To inspect local timeout/violation frequency without printing private content:

```sh
node backend/scripts/recovery-summary.cjs researcher/experiments/team-competition-01/events.jsonl
```

Use the actual researcher directory if customized. The command is read-only and counts distinct recovery/error events, primary codes, per-attempt violation codes and timeout timing/phase evidence; storage/control events are not equivalent to LLM request counts. Old logs without new timing fields report missing evidence rather than invented durations. Failed JSONL parsing fails the report without changing the file. There is no claim about the supplied run's timeout rate until its actual event log is inspected.

## Transactions, privacy and compatibility

There is still one controller execution loop and writer lease. Frozen selection/cursor state, commit candidates, exact commit-hash reconciliation and branch behavior are unchanged. Rejected candidates cannot move agents, consume resources, change memory/activity, deliver speech, advance simulation time or create verified task outcomes. Previously committed independent scheduler checkpoints remain authoritative. A successful correction commits exactly one unchanged model proposal, and only then projects working state.

No experiment configuration fields were added or rewritten. Existing identities, traits, memories, relationship subjects, task history, snapshots, historical schema hashes and past logs remain intact. Operational arrays are tightened only to exclude batches that could not validly commit under the existing one-of-each rule. Current scoped runs get the stronger audience schema and explicit local inspection rule; past records remain readable. Resuming a pending turn attaches the current contract at request time without replacing the frozen original context. This is an auditable prompt/validator implementation change, not evidence that pre/post-update model behavior is scientifically identical.

## Continuing `team-competition-01`

A new run is **not required for data integrity** if canonical logs/baselines are coherent and all failed Turn 0 candidates were uncommitted, as in the supplied description. Back up/export the run first and stop the old backend before deploying the update. Never delete events, edit the immutable config, change participant ordering, clear agent memories or manually reset locations/resources to make a retry succeed.

- If the restored lifecycle is **paused/suspended**, inspect its rejection/commit status and use **Resume**. It retries the same participant and logical turn, with the current contract and a fresh short recovery budget. Completed turns, original audiences and prior failures stay preserved.
- If it is **stopped**, **Resume intentionally does nothing**. **Start** with the same run ID and **exact saved configuration** is the existing continuation path. The regression verifies restart, stopped restoration and starting from `logs.loadConfig(runId)` without changing config/baseline hashes or old event prefixes. For an exact API payload, use the saved `config` returned by `GET /api/experiment/status` after that run is restored, then send that object unchanged to `POST /api/experiment/start`. If a stopped exhausted candidate is rejected again, the run suspends; explicit Resume grants its fresh short corrective budget.
- Do not use Reset to preserve a frozen retry: it intentionally clears pending execution. Do not use Start with reconstructed defaults or a different model/timeout/seed/turn limit; immutable metadata checks should reject those changes under the same ID.
- If commit ordering/hash evidence is ambiguous, or storage is corrupt, repair/inspect it before any continuation. The backend must suspend rather than infer whether a turn committed.

For a clean comparison of revised guidance against the original condition, use a distinct new run ID and preserve the stopped run as evidence. Changing immutable model/configuration settings likewise requires a new run. This methodological choice is separate from safe continuation of an uncommitted logical turn.

## Verification

Results are recorded below after the complete test/build runs. The focused regressions use deterministic mock proposals: they prove validation, feedback, transaction and privacy behavior, not Ornith's ability to choose a successful strategy.

- `npm test --prefix backend`: **354 passed, 0 failed**, including a successful strict TypeScript build. The new decision/recovery file contributes **24 tests**; all 330 prior regressions pass.
- New coverage includes A–J from the request: aggregated observe-itinerary rejection; duplicate activity rejection; team/local recipient failures; private delivery; decision/physical mismatch; separate movement and local inspection; four-input/two-participant verified assembly with exactly one output and provenance; reservation-safe recipe abandonment; one valid correction committed once; private/team/local isolation in normal and corrective requests. Additional cases cover both adapter output modes, table-driven activity/status/memory combinations, small decoder bounds, disabled capabilities, response-body/request timeout evidence, safe stopped restoration, read-only summary counts, cross-run timeout/sampling isolation and capability-aware validator caching.
- Angular: **94 passed**, including the new multi-violation status/audit rendering regression. `npm run build --prefix frontend`: **passed**. Warnings remain for stats optional chains (NG8107), the world JSON editor's coalescing expression (NG8102), the existing 3.95 kB app stylesheet against its 2.05 kB warning budget, and the 525.47 kB initial bundle against its 512 kB warning budget. Hard build budgets pass. Node also reports the existing `punycode` deprecation warning.
- Live schema initialization check attempted with `node backend/scripts/local-schema-check.cjs`: model discovery failed with **ECONNREFUSED** at `http://127.0.0.1:8080/v1/models`. All 18 schema artifacts were written, but **live llama.cpp grammar compilation and live Ornith behavior remain unverified**. AJV and mock adapter passes are not presented as live grammar acceptance.
- `git diff --check`: passed. No database, dependency, personality, numerical attribute, retrieval, scheduler, transformation, reward or team-project state-machine changes were introduced.

The concrete evidence establishes that invalid candidates receive the relevant independent constraints in one correction, generation schemas directly exclude the recurring invalid audience/oversized-array shapes, and legitimate multi-turn workflows remain executable. It does not claim that any local model is guaranteed to comply or complete a project.

Private-reflection clarification uses `turn-execution-v2`; see [decision semantics](DECISIONS_TEAMS_CHANNELS.md#private-reflection-and-optional-speech). A nonempty response still requires communication authorization; corrections now also explain the valid silent-reflection alternative.
