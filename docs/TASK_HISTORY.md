# Verified autobiographical task history and agent archival

Task history indexes what committed world events establish, while retaining separate references to rejected proposals, structured intentions, and unverified reports. It never turns speech into a physical outcome or revises subjective memory automatically. Reusing an identity retains its earlier experience; initializing a new experiment still creates its configured physical world.

## Storage and evidence model

This repository uses filesystem JSON/JSONL persistence, not MongoDB. The implementation extends `JsonStorage` and `JsonlStorage` without adding a database or dependency. MongoDB collection/index migration is therefore not applicable to this checkout.

`backend/src/taskHistory/history.ts` defines and validates version-1 `TaskHistoryRecord` records:

- Stable hash ID; agent ID; originating run; task ID and transformation ID where applicable.
- Task category: transformation, discrete world action, rejected proposal, operational intention, or unverified report.
- Lifecycle: planned, attempted, in_progress, completed, failed, cancelled, interrupted.
- Separate outcome: pending, success, rejected, failure, cancelled, unresolved, reported.
- Verification: authoritative, agent_reported, absent.
- Explicit participation roles and related participants; each agent's own contributions.
- Source/attempt event IDs; original simulation turn and start/finish minutes; known wall timestamps or null.
- Configured input requirements, verified outputs, compact consumption/production/modification/release evidence, and failure/interruption reason.

A planned transformation is authoritative evidence of a committed proposal, not evidence of completed work. An ordinary committed transfer, inspection, or consumption is a discrete completed action. A structured `set_action` description remains an agent-reported intention even when the model selects operational status `completed` or `failed`. Speech is indexed only as an unverified transcript reference; its wording is not duplicated, interpreted as an achievement, or rewritten.

The source of truth remains original conversation commits, world-checkpoint children and diagnostic events in each run. Derived changes append to `researcher/task-history/<runId>.jsonl`, outside immutable run configuration and original logs. Projection batches contain changed records and removed IDs, with a source digest; they are not another world event system. Queries regenerate from canonical evidence and reconcile the index rather than trusting it as authority. Stable record/source IDs suppress duplicate outcomes during replay and retries.

The in-memory source cache keeps only compact task-relevant data and checks file metadata before reuse. Our own acknowledged appends extend it incrementally; externally changed/truncated files require a fresh canonical read. Raw requests, memory contents and inference recovery cursors are excluded from this cache/projection. A projection failure is observable, suspends unsafe continuation and can be repaired without repeating model inference or physical actions.

## Lifecycle and participation

| Evidence | Result |
| --- | --- |
| Committed transformation proposal | planned / pending |
| Explicit join | Verified participant role |
| Explicit resource contribution | Contributor role and that agent's contribution records |
| Committed start | in_progress / pending, actual start minute |
| Authoritative completion | completed / success, actual outputs and finish minute |
| Authoritative failure | failed / failure with source reason |
| Authoritative cancellation | cancelled / cancelled |
| Explicit run Stop or Reset with unfinished work | interrupted / unresolved |
| Run reaches its turn limit with unfinished work | Preserve planned/in_progress, outcome unresolved |
| Pause | Preserve task lifecycle; no fabricated interruption/failure |
| Rejected world proposal | attempted / rejected, verification absent; diagnostic IDs |
| Technical timeout, connection error, malformed non-proposal output | Research diagnostics only; no invented physical task failure |
| Agent speech or operational description | Separate agent_reported evidence |

A task state names its actual participants. Observers and agents merely mentioned in speech receive no completion credit. Contributor/initiator/proposer roles require their corresponding explicit events. Shared resource effects are inspectable by each participant, with the responsible actor/source contribution identified. A branch's inherited resource contributions retain their original IDs rather than manufacturing a new contribution event.

Stop/Reset do not introduce a new resource-release policy: existing transformation state and reservations remain unresolved in the source world. Start/resume or an explicit researcher time advance can later produce authoritative outcomes according to existing rules. History reflects the new evidence, retaining lifecycle-control provenance. An interrupted run is not evidence of incapability. Historical report/intent records remain separate from world validation throughout.

Rejected attempts are grouped by agent/run/logical turn/task or action and link their diagnostic IDs to a later successful retry where identifiable. They never create committed world events or task-failure evidence. The original raw proposal and rejection reason remain in existing research diagnostics. Technical retries are not counted as physical attempts.

## Cross-run context and reproducibility

A new run freezes prior candidate experience in immutable `experiments/<runId>/task-history-baseline.json`, with a hash. Its own committed experiences then become available during later turns. Each participant's prior candidate window is at most 500 recent non-transcript records. The history API itself remains paginated over complete indexed history.

Snapshots freeze source history at their selected turn. Templates and branches carry that frozen history/hash. Older snapshots without history are conservatively reconstructed from their source-turn commits and available prior baseline; future source turns and unrelated later experiments are excluded. Historical probes use the same source-turn boundary. This prevents a branch or replay from learning outcomes that had not happened at its chosen starting point.

Normal and research-protocol inference requests receive a separate bounded evidence section. It explicitly states that a previous run's success does not establish current inventory, location, equipment, or environment. Current authoritative world observations govern physical validation. The model still decides whether to revise its beliefs; neither memory entries nor conversational text are changed by history projection.

Optional immutable `ExperimentConfig.taskHistoryConfig` fields:

| Field | Default | Allowed |
| --- | --- | --- |
| enabled | true | boolean; affects context inclusion, not evidence collection |
| recentCompleted | 6 | 0–100 |
| recentAdverse | 4 | 0–100, for failed/cancelled/interrupted work |
| recentAttempts | 3 | 0–100, for rejected proposals |
| relevant | 4 | 0–100, matching known current recipe IDs |
| maxChars | 6000 | 0–32000, including the history framing text |

Retrieval is deterministic, deduplicates records across buckets, and includes complete JSON records only when they fit. It never appends the complete history. Each actual inference audit stores the effective settings, selected IDs and character count in `retrieval.taskHistory`, along with the existing original prompt, request, raw model output and validation result. Correction retries retain their frozen original turn context. Configure this evidence channel explicitly when designing memory-withholding or memory-off controls: subjective memory and verified history are independent information sources.

The Angular Setup panel exposes these limits and locks them for saved runs. Missing settings in old configurations use the effective defaults without rewriting those files.

## Inspection and queries

The dashboard's **Task History — verified events and unverified reports** panel is separate from Memory & self-model and current operational activity. Enter an agent ID (including an archived identity), optionally filter run/status, and page through records. Expand a record to inspect source events, rejected attempt sources, configured inputs, verified outputs, individual contributions and authoritative resource effects. Unknown times display Unknown; simulation minutes use the existing day-zero clock rendering.

Backend:

```text
GET /api/agents/:id/task-history
GET /api/agents/:id/task-history?runId=run-a&taskId=light&status=completed&limit=50&offset=0
```

Filters are validated; limit is 1–500. Responses include records, total, offset and limit. Individual identities continue resolving by ID after archival. The structured records and source pointers support later completion/rejection/cooperation analysis without adding a new analytics framework or interpreting speech as verified performance.

## Backfill, repair and limitations

Legacy agents require no rewrite. History is rebuilt only from sufficient trustworthy committed world events. Events without IDs/participants or unsupported old narrative-only runs cannot establish verified achievements; missing history/timestamps remain empty/unknown. Non-world transcripts remain in their original research/memory streams rather than receiving fabricated world task histories. Source-turn reconstruction for older snapshots cannot invent prior experiences not recoverable from their source run or baseline.

The projection is idempotent and append-only. Viewing a completed legacy non-world run creates no migration files. Existing configurations, memories, relationships, physical snapshots, historical participant lists and original log bytes are retained.

If a derived index is corrupt or storage was repaired, stop active experiments and run:

```bash
npm run rebuild:task-history --prefix backend -- run-id
```

Omit the run ID for all runs. `RESEARCH_DIR` can select an existing researcher storage directory. The command acquires the shared writer lease, validates canonical JSON, quarantines any old derived index under `task-history/quarantine/`, and regenerates it. It never rewrites original run files or repeats actions. A corrupt canonical research log still requires explicit repair; the command does not guess missing physical events.

File-backed history queries scan run metadata and relevant projections; this is suitable for the existing local application. Large longitudinal studies should profile index growth/query latency before adopting a database-backed implementation. Evidence references preserve the original data needed for such a migration. No live-model learning claim follows from these deterministic tests.

## Soft removal of agents

Each Available Agents entry has an accessible trashcan action labelled with the agent's name and ID. It opens a native modal with the exact text:

> Are you sure you want to delete this agent?

Buttons are **REMOVE** and **CANCEL**. Cancel, Escape, and closing without confirmation make no request. REMOVE disables duplicate requests and hides the entry only after backend success; backend errors remain visible in the dialog. The list refreshes afterward. Archive controls do not modify historical participant lists or the frozen active configuration.

```text
POST /api/agents/:id/archive
```

The controller serializes archive/start commands and uses the shared writer lease. Running **and paused** participants are protected: stop their experiment before removing them. An unselected agent can be archived while another experiment runs. New experiments reject archived IDs even if supplied directly to the API. Existing runs and historical lookups still resolve them by ID.

`AgentState.archived` is optional; missing means false. Persistent selection metadata is stored as `{ "archived": true }` in the existing agent directory's `visibility.json`, overlaid by `loadAgentIdentity`. This keeps the entire original identity/state/memory files byte-for-byte intact and prevents old turn/snapshot projection from accidentally unarchiving an agent. The normal list excludes archived identities; internal ID lookup does not. `listAgents({includeArchived:true})` and `setArchived(id,false)` provide a model/storage foundation for a later Archived Agents/Restore interface. No restore UI is added here.

No agent directory, memory, relationship, task history, audit record or associated document is deleted. There is no MongoDB cascade-delete operation in this filesystem implementation.

## Implementation map and verification

- `backend/src/taskHistory/history.ts`: types, validation, pure event projection, queries and bounded retrieval.
- `JsonlStorage`: append-only derived persistence, source cache, frozen baselines, snapshot boundaries and leased repair.
- `ExperimentController`: inference context, lifecycle evidence, archive safeguards, and committed-checkpoint reconciliation on projection failure.
- `JsonStorage`, agent/experiment API routers, server wiring: persistent archive metadata and history/config endpoints.
- `ResearchService`, `BranchService`: snapshot/template/branch/probe history isolation.
- Angular `task-history` and `agent-archive` components, agent service and app integration: filtering, evidence inspection, configuration and confirmation.
- Backend task-history/archive tests and Angular component/app tests: completion/rejection/claims, reuse, interruption, cooperation, replay, corruption repair, checkpoint acknowledgment, archived persistence, historical identity/data preservation, and accessible UI behavior.

The current main branch already allows 8,000-character conversation topics. Existing topic regression assertions were updated to that established boundary; this upgrade does not change the topic limit or inference timeout.

Validation for this implementation: **292 backend tests passed, 83 Angular tests passed, backend and frontend production builds passed**, and the index-rebuild CLI smoke test indexed one canonical synthetic action successfully. The frontend build retains the existing stylesheet budget/template warnings. Model-facing context was exercised with controlled local mock responses; no live Ornith/llama.cpp behavioral validation was performed.
